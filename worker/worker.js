// MAESTRO API — Cloudflare Worker. Хранит ключ OpenAI в секрете и принимает запросы только с сайта.
// POST /generate (multipart): image (PNG эскиза поверх картины), workId, title, artist, date, technique,
//                              movement, closeness (0..1), description (до 300 символов),
//                              size (1024x1024 | 1536x1024 | 1024x1536 — сайт уже подогнал эскиз под эти пропорции)
// Ответ: { image: <base64>, mime: 'image/jpeg' }
//
// Настройки (Settings → Variables and Secrets):
//   OPENAI_API_KEY  — секрет, ключ OpenAI (обязательно)
//   ALLOWED_ORIGINS — адрес сайта, например https://login.github.io (несколько — через запятую)
//   MODEL           — модель, по умолчанию gpt-image-1.5
//   QUALITY         — low | medium | high, по умолчанию medium (влияет на цену)
//   LIMIT_PER_IP    — генераций в сутки с одного адреса, по умолчанию 10
//   LIMIT_TOTAL     — генераций в сутки на весь сайт, по умолчанию 200 (защита бюджета)
// Привязка KV с именем LIMITS включает подсчёт лимитов (без неё лимиты не работают).

const MAX_BYTES = 8 * 1024 * 1024;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health') return json({ ok: true, model: env.MODEL || 'gpt-image-1.5', limits: !!env.LIMITS });
    if (url.pathname !== '/generate' || req.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (!okOrigin) return json({ error: 'forbidden_origin' }, 403);
    if (!env.OPENAI_API_KEY) return json({ error: 'server_not_configured' }, 500);

    // лимиты
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const day = new Date().toISOString().slice(0, 10);
    if (env.LIMITS) {
      const perIp = +(env.LIMIT_PER_IP || 10), total = +(env.LIMIT_TOTAL || 200);
      const [a, b] = await Promise.all([env.LIMITS.get(`ip:${ip}:${day}`), env.LIMITS.get(`total:${day}`)]);
      if (+(a || 0) >= perIp || +(b || 0) >= total) return json({ error: 'limit' }, 429);
    }

    let form;
    try { form = await req.formData(); } catch { return json({ error: 'bad_form' }, 400); }
    const image = form.get('image');
    if (!image || typeof image === 'string') return json({ error: 'no_image' }, 400);
    if (image.size > MAX_BYTES) return json({ error: 'too_big' }, 413);

    const f = (k, max = 200) => String(form.get(k) || '').replace(/[\r\n]+/g, ' ').slice(0, max);
    const closeness = Math.min(1, Math.max(0, parseFloat(form.get('closeness')) || 0.7));
    const prompt = buildPrompt({
      title: f('title'), artist: f('artist'), date: f('date', 60), technique: f('technique', 80), movement: f('movement', 80),
      closeness, description: f('description', 300),
    });

    const body = new FormData();
    body.append('model', env.MODEL || 'gpt-image-1.5');
    body.append('image', image, 'sketch.png');
    body.append('prompt', prompt);
    body.append('input_fidelity', closeness >= 0.5 ? 'high' : 'low');
    body.append('quality', env.QUALITY || 'medium');
    const size = ['1024x1024', '1536x1024', '1024x1536'].includes(f('size', 12)) ? f('size', 12) : 'auto';
    body.append('size', size);
    body.append('output_format', 'jpeg');
    body.append('n', '1');
    body.append('user', 'maestro-' + (await hash(ip)).slice(0, 16));

    const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body });
    if (!r.ok) {
      const text = await r.text();
      console.log('openai error', r.status, text.slice(0, 500));
      let code = '';
      try { code = (JSON.parse(text).error || {}).code || ''; } catch {}
      return json({ error: code === 'moderation_blocked' ? 'moderation' : 'upstream', status: r.status }, r.status === 400 ? 400 : 502);
    }
    const data = await r.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) return json({ error: 'empty' }, 502);

    if (env.LIMITS) {
      const opts = { expirationTtl: 60 * 60 * 48 };
      const [a, b] = await Promise.all([env.LIMITS.get(`ip:${ip}:${day}`), env.LIMITS.get(`total:${day}`)]);
      await Promise.all([env.LIMITS.put(`ip:${ip}:${day}`, String(+(a || 0) + 1), opts), env.LIMITS.put(`total:${day}`, String(+(b || 0) + 1), opts)]);
    }
    return json({ image: b64, mime: 'image/jpeg' });
  },
};

function buildPrompt({ title, artist, date, technique, movement, closeness, description }) {
  const work = [title && `"${title}"`, artist && `by ${artist}`, date && `(${date})`].filter(Boolean).join(' ');
  const how = [technique, movement].filter(Boolean).join(', ');
  return [
    `This image is the unfinished painting ${work || ''}${how ? `, ${how}` : ''}, with a rough sketch that a visitor drew on top of it — sometimes beyond its original edges.`,
    `Finish the painting: turn the sketched lines and the shapes they describe into fully painted parts of the artwork, in exactly the same technique, brushwork, palette, lighting and level of detail as the original artist, so it looks as if the artist completed it.`,
    `Keep everything that was already painted (especially faces) unchanged. Paint the bare canvas around the new parts so the whole picture looks finished and coherent.`,
    `Remove every sketch line — no outlines, no text, no signatures, no frames.`,
    closeness >= 0.5
      ? `Stay close to the period and composition of the original; interpret the sketch faithfully.`
      : `You may interpret the sketch freely and creatively while keeping the original style.`,
    description ? `The visitor describes the sketch as: ${description}` : '',
  ].filter(Boolean).join(' ');
}

async function hash(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
