// «Рваная» обводка — повторяет Dynamic stroke из Figma (frequency 0.75, wiggle 0.3, smoothen 0.5).
// Контур скруглённого прямоугольника, смещённый поперёк линии плавной случайной волной
// (два слоя волн: ≈1.2 и ≈0.55 толщины, амплитуда ≈ 0.24 и 0.12 толщины) — так выглядит обводка в макете.
//
// Разметка: <… data-rough="толщина цвет-обводки цвет-заливки радиус выравнивание">
//   выравнивание: center (кнопки, панели, картины) или outside (фильтры) — как strokeAlign в Figma.
//   Заливка none — для картин: белая обводка ложится поверх края изображения.
const NS = 'http://www.w3.org/2000/svg';

function rng(seed) { // детерминированный генератор, чтобы контур не «дрожал» при перерисовке
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
}
const hash = (str) => { let x = 2166136261; for (const c of str) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x; };

// точки скруглённого прямоугольника через равные промежутки, с нормалями наружу
function perimeter(w, h, r, step) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const segs = [
    ['l', r, 0, w - r, 0, 0, -1], ['a', w - r, r, -Math.PI / 2, 0],
    ['l', w, r, w, h - r, 1, 0], ['a', w - r, h - r, 0, Math.PI / 2],
    ['l', w - r, h, r, h, 0, 1], ['a', r, h - r, Math.PI / 2, Math.PI],
    ['l', 0, h - r, 0, r, -1, 0], ['a', r, r, Math.PI, Math.PI * 1.5],
  ];
  const len = (s) => (s[0] === 'l' ? Math.hypot(s[3] - s[1], s[4] - s[2]) : r * Math.PI / 2);
  const total = segs.reduce((a, s) => a + len(s), 0);
  const n = Math.max(12, Math.round(total / step));
  const pts = [];
  let si = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    let d = (i / n) * total;
    while (si < segs.length - 1 && d > acc + len(segs[si])) { acc += len(segs[si]); si++; }
    const s = segs[si], t = len(s) ? (d - acc) / len(s) : 0;
    if (s[0] === 'l') pts.push([s[1] + (s[3] - s[1]) * t, s[2] + (s[4] - s[2]) * t, s[5], s[6]]);
    else { const a = s[3] + (s[4] - s[3]) * t; pts.push([s[1] + r * Math.cos(a), s[2] + r * Math.sin(a), Math.cos(a), Math.sin(a)]); }
  }
  return pts;
}

// shift > 0 — контур сдвинут наружу на shift (для обводки «снаружи»)
export function roughPath(w, h, r, sw, seed, shift = 0) {
  const rand = rng(seed);
  const pts = perimeter(w + 2 * shift, h + 2 * shift, r + shift, 1.5);
  // два слоя плавных «волн»: крупные (≈1.2 толщины) и мелкие (≈0.55 толщины), косинусная интерполяция
  const n = pts.length;
  const octave = (len, amp) => {
    const k = Math.max(3, Math.round((n * 1.5) / len)), ctrl = Array.from({ length: k }, () => (rand() * 2 - 1) * amp);
    return (i) => { const f = (i / n) * k, i0 = Math.floor(f) % k, c = (1 - Math.cos((f - Math.floor(f)) * Math.PI)) / 2; return ctrl[i0] * (1 - c) + ctrl[(i0 + 1) % k] * c; };
  };
  const big = octave(sw * 1.2, sw * 0.24), small = octave(sw * 0.55, sw * 0.12);
  const off = pts.map((_, i) => big(i) + small(i));
  return 'M' + pts.map(([x, y, nx, ny], i) => `${(x - shift + nx * off[i]).toFixed(2)} ${(y - shift + ny * off[i]).toFixed(2)}`).join('L') + 'Z';
}

function draw(el) {
  const [sw = 6, stroke = 'var(--ink)', fill = 'var(--paper)', radius = 30, align = 'center'] = el.dataset.rough.split(' ');
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  const key = `${w}x${h}`;
  if (el._roughKey === key) return;
  el._roughKey = key;
  const s = +sw, pad = s * 2 + 4, grow = align === 'outside' ? s / 2 : 0;
  let svg = el.querySelector(':scope > svg.rough');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'rough'); svg.setAttribute('aria-hidden', 'true');
    svg.appendChild(document.createElementNS(NS, 'path'));
    el.prepend(svg);
  }
  Object.assign(svg.style, { left: -pad + 'px', top: -pad + 'px', width: w + pad * 2 + 'px', height: h + pad * 2 + 'px' });
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`);
  const p = svg.firstChild;
  p.setAttribute('d', roughPath(w, h, +radius, s, hash(el.dataset.seed || el.textContent || key) ^ w, grow));
  p.setAttribute('fill', fill === 'none' ? 'none' : fill);
  p.setAttribute('stroke', stroke);
  p.setAttribute('stroke-width', s);
  p.setAttribute('stroke-linejoin', 'round');
}

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => entries.forEach((e) => draw(e.target))) : null;

// найти все элементы с data-rough внутри root и нарисовать им обводку (и перерисовывать при изменении размера)
export function roughen(root = document) {
  root.querySelectorAll('[data-rough]').forEach((el) => { el._roughKey = null; draw(el); if (ro) ro.observe(el); });
}
