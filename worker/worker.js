// MAESTRO API — Cloudflare Worker. Хранит ключ OpenAI в секрете и принимает запросы только с сайта.
//
// POST /generate (multipart): image (PNG эскиза поверх картины), token (код покупателя из браузера), workId, title,
//                              artist, date, technique, movement, closeness (0..1), description (до 300 символов),
//                              size (1024x1024 | 1536x1024 | 1024x1536 — сайт уже подогнал эскиз под эти пропорции)
//      Ответ: { image: <base64>, mime: 'image/jpeg', balance: { free, credits } }
//      402 { error: 'no_credits' } — бесплатные закончились, купленных нет.
// GET  /balance?token=…    → { free, credits }  сколько осталось бесплатных и купленных генераций
// GET  /packs              → { wallet, packs }  пакеты генераций и кошелёк ЮMoney для формы оплаты
// POST /pay/yoomoney       — HTTP-уведомление ЮMoney об оплате: проверяем подпись и начисляем генерации
//
// Учёт: одному человеку FREE_LIMIT бесплатных генераций за всё время (считаем и по адресу, и по коду браузера —
// берём большее), дальше — только купленные. Купленные привязаны к коду браузера (его можно перенести на другое
// устройство со страницы покупки).
//
// Настройки (wrangler.toml и секреты):
//   OPENAI_API_KEY   — секрет, ключ OpenAI (обязательно)
//   YOOMONEY_SECRET  — секрет для проверки уведомлений ЮMoney (yoomoney.ru/transfer/myservices/http-notification)
//   YOOMONEY_WALLET  — номер кошелька ЮMoney, куда идут оплаты
//   ALLOWED_ORIGINS  — адрес сайта (несколько — через запятую)
//   MODEL, QUALITY   — модель и качество генерации
//   FREE_LIMIT       — бесплатных генераций на человека, по умолчанию 3
//   LIMIT_TOTAL      — бесплатных генераций в сутки на весь сайт, по умолчанию 200 (защита бюджета)
// KV с именем LIMITS обязателен: в нём счётчики и балансы.

const MAX_BYTES = 8 * 1024 * 1024;
const YEAR = 60 * 60 * 24 * 400;
// Пакеты: цена в рублях. Себестоимость генерации ≈ 13 ₽; после комиссии ЮMoney (3%) и налога (4%) каждая
// генерация приносит ≥ 130 ₽, то есть в 10 раз больше себестоимости.
const PACKS = {
  s: { gens: 3, price: 449 },
  m: { gens: 10, price: 1490 },
  l: { gens: 30, price: 4290 },
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    const url = new URL(req.url);
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const KV = env.LIMITS;
    const FREE = +(env.FREE_LIMIT || 3);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health') return json({ ok: true, model: env.MODEL || 'gpt-image-1.5', limits: !!KV, payments: !!(env.YOOMONEY_SECRET && env.YOOMONEY_WALLET) });

    // уведомление ЮMoney приходит с их сервера, не с сайта — Origin не проверяем, проверяем подпись
    if (url.pathname === '/pay/yoomoney' && req.method === 'POST') return yoomoney(req, env);

    if (url.pathname === '/packs' && req.method === 'GET') {
      return json({ wallet: env.YOOMONEY_WALLET || '', packs: Object.entries(PACKS).map(([id, p]) => ({ id, ...p })) });
    }

    if (url.pathname === '/balance' && req.method === 'GET') {
      const token = cleanToken(url.searchParams.get('token'));
      if (!token || !KV) return json({ free: FREE, credits: 0 });
      return json(await balance(KV, ip, token, FREE));
    }

    if (url.pathname !== '/generate' || req.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (!okOrigin) return json({ error: 'forbidden_origin' }, 403);
    if (!env.OPENAI_API_KEY || !KV) return json({ error: 'server_not_configured' }, 500);

    let form;
    try { form = await req.formData(); } catch { return json({ error: 'bad_form' }, 400); }
    const token = cleanToken(form.get('token'));
    if (!token) return json({ error: 'no_token' }, 400);

    // бесплатная или купленная генерация?
    const day = new Date().toISOString().slice(0, 10);
    const bal = await balance(KV, ip, token, FREE);
    let mode = null;
    if (bal.free > 0 && +(await KV.get(`total:${day}`) || 0) < +(env.LIMIT_TOTAL || 200)) mode = 'free';
    else if (bal.credits > 0) mode = 'paid';
    if (!mode) return json({ error: bal.free > 0 ? 'limit' : 'no_credits', balance: bal }, bal.free > 0 ? 429 : 402);

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
    body.append('user', 'maestro-' + (await hash(token)).slice(0, 16));

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
    if (data.usage) console.log('usage', JSON.stringify(data.usage)); // для подсчёта себестоимости: npx wrangler tail

    // списываем только удачную генерацию
    if (mode === 'free') {
      await Promise.all([
        bump(KV, `free:ip:${ip}`, 1, YEAR), bump(KV, `free:t:${token}`, 1, YEAR),
        bump(KV, `total:${day}`, 1, 60 * 60 * 48),
      ]);
    } else {
      await bump(KV, `credits:${token}`, -1);
    }
    return json({ image: b64, mime: 'image/jpeg', balance: await balance(KV, ip, token, FREE) });
  },
};

async function balance(KV, ip, token, FREE) {
  const [a, b, c] = await Promise.all([KV.get(`free:ip:${ip}`), KV.get(`free:t:${token}`), KV.get(`credits:${token}`)]);
  return { free: Math.max(0, FREE - Math.max(+(a || 0), +(b || 0))), credits: Math.max(0, +(c || 0)) };
}
async function bump(KV, key, by, ttl) {
  const v = Math.max(0, +(await KV.get(key) || 0) + by);
  await KV.put(key, String(v), ttl ? { expirationTtl: ttl } : undefined);
  return v;
}
const cleanToken = (t) => (/^[a-z0-9-]{16,64}$/i.test(String(t || '')) ? String(t).toLowerCase() : '');

// ---------- оплата через ЮMoney (кошелёк физлица, форма Quickpay) ----------
// Подпись: HMAC-SHA256 (ключ — секрет из настроек уведомлений) от всех параметров, кроме sign,
// отсортированных по алфавиту и склеенных как key=value через &; значения — в URL-кодировке.
async function yoomoney(req, env) {
  const ok = () => new Response('OK', { status: 200 });
  if (!env.YOOMONEY_SECRET || !env.LIMITS) return new Response('not configured', { status: 500 });
  const raw = (await req.text()).trim();
  const pairs = raw.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; });
  const dec = (s) => decodeURIComponent(s.replace(/\+/g, ' '));
  const params = Object.fromEntries(pairs.map(([k, v]) => [dec(k), dec(v)]));
  const sign = (params.sign || '').toLowerCase();
  const rest = pairs.filter(([k]) => dec(k) !== 'sign').sort((x, y) => (dec(x[0]) < dec(y[0]) ? -1 : 1));
  // как пришло в теле и как перекодировано заново — URL-кодировка у разных клиентов отличается мелочами
  const variants = [rest.map(([k, v]) => `${k}=${v}`).join('&'), rest.map(([k, v]) => `${encodeURIComponent(dec(k))}=${encodeURIComponent(dec(v))}`).join('&')];
  let valid = false;
  for (const s of variants) if ((await hmac(env.YOOMONEY_SECRET, s)) === sign) valid = true;
  if (!valid) { console.log('yoomoney: bad sign', params.operation_id); return new Response('bad sign', { status: 400 }); }
  if (params.test_notification === 'true') return ok();

  const [token, packId] = String(params.label || '').split(':');
  const pack = PACKS[packId];
  if (!cleanToken(token) || !pack) { console.log('yoomoney: unknown label', params.label); return ok(); }
  const paid = parseFloat(params.withdraw_amount || params.amount || '0');
  if (paid + 0.01 < pack.price) { console.log('yoomoney: underpaid', params.operation_id, paid, pack.price); return ok(); }
  const opKey = `op:${params.operation_id}`;
  if (await env.LIMITS.get(opKey)) return ok(); // уже начислено (ЮMoney повторяет уведомления)
  await env.LIMITS.put(opKey, `${token}:${packId}:${paid}`, { expirationTtl: YEAR });
  const total = await bump(env.LIMITS, `credits:${cleanToken(token)}`, pack.gens);
  console.log('yoomoney: credited', params.operation_id, packId, '→', total);
  return ok();
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
