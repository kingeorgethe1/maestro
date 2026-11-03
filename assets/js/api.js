// Генерация. Если в config.js задан apiUrl — отправляем эскиз в бэкенд (Cloudflare Worker → OpenAI).
// Иначе — демо-режим: эскиз «подкрашивается» фильтрами прямо в браузере, чтобы был виден весь путь.
import { L } from './i18n.js';

export const apiUrl = () => ((window.MAESTRO_CONFIG && window.MAESTRO_CONFIG.apiUrl) || '').replace(/\/+$/, '');
export const isDemo = () => !apiUrl();

const toBlob = (canvas, type = 'image/png', q) => new Promise((ok) => canvas.toBlob(ok, type, q));

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
  const fd = new FormData();
  fd.append('image', await toBlob(o.composite), 'sketch.png');
  fd.append('workId', o.work.id);
  fd.append('title', L(o.work.title));
  fd.append('artist', o.work.artist.en);
  fd.append('date', o.work.date);
  fd.append('technique', o.work.techniqueText.en);
  fd.append('movement', o.work.movement.en);
  fd.append('closeness', String(o.closeness));
  fd.append('description', (o.description || '').slice(0, 300));
  const r = await fetch(apiUrl() + '/generate', { method: 'POST', body: fd });
  if (r.status === 429) throw new ApiError('limit');
  if (!r.ok) throw new ApiError('server', await r.text().catch(() => ''));
  const j = await r.json();
  const bin = atob(j.image);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: j.mime || 'image/png' });
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
