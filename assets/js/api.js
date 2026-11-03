// Генерация. Если в config.js задан apiUrl — отправляем эскиз в бэкенд (Cloudflare Worker → OpenAI).
// Иначе — демо-режим: эскиз «подкрашивается» фильтрами прямо в браузере, чтобы был виден весь путь.
import { L } from './i18n.js';
import { token } from './store.js';

export const apiUrl = () => ((window.MAESTRO_CONFIG && window.MAESTRO_CONFIG.apiUrl) || '').replace(/\/+$/, '');
export const isDemo = () => !apiUrl();

const toBlob = (canvas, type = 'image/png', q) => new Promise((ok) => canvas.toBlob(ok, type, q));

// баланс: сколько осталось бесплатных и купленных генераций
export let lastBalance = null;
export async function getBalance() {
  if (isDemo()) return null;
  try { lastBalance = await (await fetch(`${apiUrl()}/balance?token=${encodeURIComponent(token())}`)).json(); } catch {}
  return lastBalance;
}
export async function getPacks() {
  if (isDemo()) return { wallet: '', packs: [] };
  return (await fetch(`${apiUrl()}/packs`)).json();
}

export class ApiError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.composite  картина + рисунок пользователя (с расширенным полем)
 * @param {HTMLCanvasElement} o.painting   только картина на том же поле
 * @param {HTMLCanvasElement} o.layer      только рисунок пользователя
 * @param {object} o.work                  карточка из каталога
 * @param {number} o.closeness             0 — свободно, 1 — близко к оригиналу
 * @param {string} o.description           что нарисовал пользователь
 * @returns {Promise<Blob>}
 */
export async function generate(o) {
  if (isDemo()) return mock(o);
  const { canvas, size, box } = fitForModel(o.composite);
  const fd = new FormData();
  fd.append('image', await toBlob(canvas), 'sketch.png');
  fd.append('size', size);
  fd.append('token', token());
  fd.append('workId', o.work.id);
  fd.append('title', L(o.work.title));
  fd.append('artist', o.work.artist.en);
  fd.append('date', o.work.date);
  fd.append('technique', o.work.techniqueText.en);
  fd.append('movement', o.work.movement.en);
  fd.append('closeness', String(o.closeness));
  fd.append('description', (o.description || '').slice(0, 300));
  const r = await fetch(apiUrl() + '/generate', { method: 'POST', body: fd });
  if (r.status === 402) throw new ApiError('no_credits');
  if (r.status === 429) throw new ApiError('limit');
  if (r.status === 400) { const e = await r.json().catch(() => ({})); if (e.error === 'moderation') throw new ApiError('moderation'); }
  if (!r.ok) throw new ApiError('server', await r.text().catch(() => ''));
  const j = await r.json();
  if (j.balance) lastBalance = j.balance;
  const bin = atob(j.image);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const out = await createImageBitmap(new Blob([bytes], { type: j.mime || 'image/jpeg' }));
  return backToComposite(out, box, o.composite);
}

// Модель рисует только 1536×1024, 1024×1536 или 1024×1024. Эскиз вписываем в ближайший формат по центру
// (поля — цветом холста), а ответ потом обрезаем обратно — так «было» и «стало» совпадают до пикселя.
const SIZES = [[1536, 1024], [1024, 1536], [1024, 1024]];
function fitForModel(src) {
  const ar = src.width / src.height;
  const [W, H] = SIZES.reduce((best, s) => (Math.abs(Math.log(s[0] / s[1] / ar)) < Math.abs(Math.log(best[0] / best[1] / ar)) ? s : best));
  const k = Math.min(W / src.width, H / src.height), w = Math.round(src.width * k), h = Math.round(src.height * k);
  const box = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, W, H };
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#F4F1EA'; x.fillRect(0, 0, W, H);
  x.imageSmoothingQuality = 'high'; x.drawImage(src, box.x, box.y, w, h);
  return { canvas: c, size: `${W}x${H}`, box };
}
function backToComposite(img, box, ref) {
  const sx = img.width / box.W, sy = img.height / box.H; // на случай, если модель вернула другой размер
  const c = document.createElement('canvas'); c.width = ref.width; c.height = ref.height;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(img, box.x * sx, box.y * sy, box.w * sx, box.h * sy, 0, 0, ref.width, ref.height);
  return toBlob(c, 'image/png');
}

// Демо (ИИ не подключён): только имитация «стало» — картина, слегка переписанная фильтром.
// Линии наброска сюда не переносим: на стороне «стало» должна быть только генерация.
async function mock(o) {
  await new Promise((r) => setTimeout(r, 2600));
  const { width: w, height: h } = o.painting;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.filter = 'saturate(1.12) contrast(1.06) sepia(0.12)';
  x.drawImage(o.painting, 0, 0);
  x.filter = 'none';
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  return toBlob(c, 'image/png');
}
