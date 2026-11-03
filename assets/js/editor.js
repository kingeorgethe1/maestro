// Редактор: картина снизу, прозрачный слой пользователя сверху.
// Вокруг картины — расширяемое поле (MARGIN), можно рисовать за пределами исходного кадра.
// Координаты рисунка — в пикселях рабочего поля; вид (зум и сдвиг) влияет только на отображение.

import { roughPath } from './rough.js';

const MAX_SIDE = 1600;       // картину приводим к этому размеру по длинной стороне
const MARGIN_K = 0.22;       // поле вокруг картины, доля от длинной стороны
const HISTORY = 30;

export class Editor {
  constructor(host, img, { onChange } = {}) {
    this.host = host; this.onChange = onChange || (() => {});
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    this.pw = Math.round(img.naturalWidth * k); this.ph = Math.round(img.naturalHeight * k);
    this.M = Math.round(Math.max(this.pw, this.ph) * MARGIN_K);
    this.W = this.pw + this.M * 2; this.H = this.ph + this.M * 2;
    this.paint = mk(this.W, this.H); this.paint.getContext('2d').drawImage(img, this.M, this.M, this.pw, this.ph);
    this.user = mk(this.W, this.H); this.ux = this.user.getContext('2d');
    this.view = document.createElement('canvas'); this.view.className = 'ed-canvas'; host.appendChild(this.view);
    this.vx = this.view.getContext('2d');
    this.tool = 'pencil'; this.color = '#3B2E1F'; this.size = 1; this.showLayer = true;
    this.undoStack = []; this.redoStack = [];
    this.zoom = 1; this.ox = 0; this.oy = 0; this.space = false;
    this.preview = null;
    this.bind(); this.resize(); this.fit();
  }

  // ---------- вид ----------
  resize() {
    const r = this.host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view.width = Math.max(1, Math.round(r.width * dpr)); this.view.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr; this.render();
  }
  fit() {
    const vw = this.view.width / this.dpr, vh = this.view.height / this.dpr;
    // по размеру: картина целиком плюс немного поля
    const z = Math.min(vw / (this.pw + this.M * 0.6), vh / (this.ph + this.M * 0.6));
    this.zoom = z; this.ox = vw / 2 - (this.M + this.pw / 2) * z; this.oy = vh / 2 - (this.M + this.ph / 2) * z;
    this.render(); this.onChange();
  }
  zoomBy(f, cx, cy) {
    const vw = this.view.width / this.dpr, vh = this.view.height / this.dpr;
    if (cx == null) { cx = vw / 2; cy = vh / 2; }
    const nz = Math.min(8, Math.max(0.1, this.zoom * f));
    this.ox = cx - (cx - this.ox) * (nz / this.zoom); this.oy = cy - (cy - this.oy) * (nz / this.zoom); this.zoom = nz;
    this.render(); this.onChange();
  }
  toWork(e) {
    const r = this.view.getBoundingClientRect();
    return [(e.clientX - r.left - this.ox) / this.zoom, (e.clientY - r.top - this.oy) / this.zoom];
  }
  render() {
    const x = this.vx, d = this.dpr;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, this.view.width, this.view.height);
    x.setTransform(d * this.zoom, 0, 0, d * this.zoom, d * this.ox, d * this.oy);
    // картина: скруглённые углы 32 px и белая рваная обводка 6 px, как в макете (поле вокруг — фон блока)
    const z = this.zoom, R = 32 / z;
    x.save(); x.beginPath(); x.roundRect(this.M, this.M, this.pw, this.ph, R); x.clip();
    x.drawImage(this.paint, 0, 0); x.restore();
    if (!this.edge || this.edgeZoom !== z) { this.edge = new Path2D(roughPath(this.pw * z, this.ph * z, 32, 6, 7)); this.edgeZoom = z; }
    x.save(); x.translate(this.M, this.M); x.scale(1 / z, 1 / z);
    x.strokeStyle = '#fff'; x.lineWidth = 6; x.lineJoin = 'round'; x.stroke(this.edge); x.restore();
    if (this.showLayer) x.drawImage(this.user, 0, 0);
    if (this.preview) this.preview(x);
  }

  // ---------- рисование ----------
  widthFor() {
    const base = [4, 9, 18][this.size] || 9;
    return this.tool === 'brush' ? base * 2.4 : this.tool === 'eraser' ? base * 3 : base;
  }
  pushUndo() {
    this.undoStack.push(this.ux.getImageData(0, 0, this.W, this.H));
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(this.ux.getImageData(0, 0, this.W, this.H)); this.ux.putImageData(this.undoStack.pop(), 0, 0); this.render(); this.onChange(true); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this.ux.getImageData(0, 0, this.W, this.H)); this.ux.putImageData(this.redoStack.pop(), 0, 0); this.render(); this.onChange(true); }
  clear() { this.pushUndo(); this.ux.clearRect(0, 0, this.W, this.H); this.render(); this.onChange(true); }
  setStyle(c) {
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = this.widthFor(); c.strokeStyle = this.color; c.fillStyle = this.color;
    c.globalCompositeOperation = this.tool === 'eraser' ? 'destination-out' : 'source-over';
    c.globalAlpha = this.tool === 'brush' ? 0.85 : 1;
  }
  pickAt([x, y]) {
    const c = mk(1, 1).getContext('2d');
    c.drawImage(this.paint, -Math.floor(x), -Math.floor(y)); c.drawImage(this.user, -Math.floor(x), -Math.floor(y));
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
    if (a < 10) return null;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  // заливка: область похожего цвета на сведённом изображении, краска ложится в слой пользователя
  fillAt([x, y]) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const comp = mk(this.W, this.H), cx = comp.getContext('2d');
    cx.fillStyle = '#F4F1EA'; cx.fillRect(0, 0, this.W, this.H); cx.drawImage(this.paint, 0, 0); cx.drawImage(this.user, 0, 0);
    const src = cx.getImageData(0, 0, this.W, this.H).data;
    const out = this.ux.getImageData(0, 0, this.W, this.H), o = out.data;
    const i0 = (y * this.W + x) * 4, r0 = src[i0], g0 = src[i0 + 1], b0 = src[i0 + 2];
    const [fr, fg, fb] = hex(this.color), tol = 34 * 34 * 3;
    const seen = new Uint8Array(this.W * this.H), stack = [x, y];
    let painted = 0;
    while (stack.length && painted < 4e6) {
      const py = stack.pop(), px = stack.pop();
      if (px < 0 || py < 0 || px >= this.W || py >= this.H) continue;
      const p = py * this.W + px; if (seen[p]) continue; seen[p] = 1;
      const i = p * 4, dr = src[i] - r0, dg = src[i + 1] - g0, db = src[i + 2] - b0;
      if (dr * dr + dg * dg + db * db > tol) continue;
      o[i] = fr; o[i + 1] = fg; o[i + 2] = fb; o[i + 3] = 255; painted++;
      stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
    }
    this.ux.putImageData(out, 0, 0);
  }

  bind() {
    const v = this.view; let drawing = false, last = null, start = null, panFrom = null, pointers = new Map(), pinch = null;
    v.style.touchAction = 'none';
    v.addEventListener('pointerdown', (e) => {
      v.setPointerCapture(e.pointerId); pointers.set(e.pointerId, e);
      if (pointers.size === 2) { // два пальца — масштаб и сдвиг, рисование отменяем
        if (drawing) { drawing = false; this.undo(); this.redoStack = []; }
        const [a, b] = [...pointers.values()];
        pinch = { d: dist(a, b), z: this.zoom, mid: mid(a, b, v), ox: this.ox, oy: this.oy }; return;
      }
      if (this.space || e.button === 1) { panFrom = [e.clientX, e.clientY, this.ox, this.oy]; return; }
      const p = this.toWork(e);
      if (this.tool === 'picker') { const c = this.pickAt(p); if (c) { this.color = c; this.onChange(false, 'color'); } return; }
      if (this.tool === 'fill') { this.pushUndo(); this.fillAt(p); this.render(); this.onChange(true); return; }
      this.pushUndo(); drawing = true; last = p; start = p;
      if (this.tool !== 'line') { this.setStyle(this.ux); this.ux.beginPath(); this.ux.moveTo(p[0], p[1]); this.ux.lineTo(p[0] + 0.01, p[1]); this.ux.stroke(); this.render(); }
    });
    v.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()], m = mid(a, b, v);
        const nz = Math.min(8, Math.max(0.1, pinch.z * dist(a, b) / pinch.d));
        this.zoom = nz; this.ox = m[0] - (pinch.mid[0] - pinch.ox) * (nz / pinch.z); this.oy = m[1] - (pinch.mid[1] - pinch.oy) * (nz / pinch.z);
        this.render(); return;
      }
      if (panFrom) { this.ox = panFrom[2] + e.clientX - panFrom[0]; this.oy = panFrom[3] + e.clientY - panFrom[1]; this.render(); return; }
      if (!drawing) return;
      const p = this.toWork(e);
      if (this.tool === 'line') {
        this.preview = (x) => { x.save(); this.setStyle(x); x.globalCompositeOperation = 'source-over'; x.beginPath(); x.moveTo(start[0], start[1]); x.lineTo(p[0], p[1]); x.stroke(); x.restore(); };
        this.render(); return;
      }
      // сглаживание: рисуем квадратичную кривую через середины отрезков
      const mx = (last[0] + p[0]) / 2, my = (last[1] + p[1]) / 2;
      this.setStyle(this.ux); this.ux.quadraticCurveTo(last[0], last[1], mx, my); this.ux.stroke(); this.ux.beginPath(); this.ux.moveTo(mx, my);
      last = p; this.render();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; this.onChange(); return; }
      if (panFrom) { panFrom = null; this.onChange(); return; }
      if (!drawing) return; drawing = false;
      if (this.tool === 'line') {
        const p = this.toWork(e); this.preview = null;
        this.setStyle(this.ux); this.ux.beginPath(); this.ux.moveTo(start[0], start[1]); this.ux.lineTo(p[0], p[1]); this.ux.stroke();
      }
      this.ux.globalAlpha = 1; this.ux.globalCompositeOperation = 'source-over';
      this.render(); this.onChange(true);
    };
    v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', (e) => { e.preventDefault(); const r = v.getBoundingClientRect(); this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    this.keydown = (e) => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      if (e.code === 'Space') { this.space = true; v.style.cursor = 'grab'; e.preventDefault(); }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    };
    this.keyup = (e) => { if (e.code === 'Space') { this.space = false; v.style.cursor = ''; } };
    this.onResize = () => this.resize();
    addEventListener('keydown', this.keydown); addEventListener('keyup', this.keyup); addEventListener('resize', this.onResize);
  }
  destroy() { removeEventListener('keydown', this.keydown); removeEventListener('keyup', this.keyup); removeEventListener('resize', this.onResize); }

  // ---------- данные ----------
  isEmpty() {
    const d = this.ux.getImageData(0, 0, this.W, this.H).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 0) return false;
    return true;
  }
  // рамка: картина плюс всё, что нарисовано за её краем (с небольшим запасом)
  bounds() {
    const d = this.ux.getImageData(0, 0, this.W, this.H).data;
    let x0 = this.M, y0 = this.M, x1 = this.M + this.pw, y1 = this.M + this.ph;
    for (let y = 0; y < this.H; y += 2) for (let x = 0; x < this.W; x += 2) {
      if (d[(y * this.W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const pad = 16;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(this.W, x1 + pad); y1 = Math.min(this.H, y1 + pad);
    if (x0 > this.M - pad) x0 = this.M; if (y0 > this.M - pad) y0 = this.M;
    if (x1 < this.M + this.pw + pad) x1 = this.M + this.pw; if (y1 < this.M + this.ph + pad) y1 = this.M + this.ph;
    return [x0, y0, x1 - x0, y1 - y0];
  }
  exportLayers() {
    const [x, y, w, h] = this.bounds();
    const crop = (src, bg) => { const c = mk(w, h), cx = c.getContext('2d'); if (bg) { cx.fillStyle = bg; cx.fillRect(0, 0, w, h); } cx.drawImage(src, -x, -y); return c; };
    const painting = crop(this.paint, '#F4F1EA'), layer = crop(this.user);
    const composite = crop(this.paint, '#F4F1EA'); composite.getContext('2d').drawImage(layer, 0, 0);
    return { composite, painting, layer };
  }
  async layerBlob() { return new Promise((ok) => this.user.toBlob(ok, 'image/png')); }
  async loadLayer(blob) {
    const img = await blobImage(blob);
    this.ux.clearRect(0, 0, this.W, this.H); this.ux.drawImage(img, 0, 0, this.W, this.H); this.render();
  }
}

export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export const blobImage = (blob) => new Promise((ok, err) => { const i = new Image(); i.onload = () => { URL.revokeObjectURL(i.src); ok(i); }; i.onerror = err; i.src = URL.createObjectURL(blob); });
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const mid = (a, b, v) => { const r = v.getBoundingClientRect(); return [(a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top]; };
