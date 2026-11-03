// Анимация главной страницы (перенесена из прототипа без изменений логики).
// MAESTRO: анимированный блок главной страницы (по макету Figma «главная страница маэстро»).
// Один код для браузера и для записи видео в Node.
// Координаты сцены — в единицах макета Figma (1 ед. = 1 px макета 1440 px).
function createMaestro(opts) {
  const { assets, strokes, makeCanvas } = opts;
  // assets: { A, C, band, dist } — картины 1456×1098, спрайт полосы света, карта расстояний

  // ---- Сцена: область макета вокруг картины, с запасом под карандаши ----
  const SW = 644, SH = 626;                      // размер сцены в ед. макета (x 790…1434, y 232…858)
  const PIC = { cx: 321.94, cy: 325.64, w: 529, h: 398, r: 40, rot: 2.97 * Math.PI / 180 }; // картина
  const IW = 1456, IH = 1098, S = PIC.w / IW;    // пиксели картины → ед. макета
  const DOTS = [[272, 557], [322, 557], [372, 557]];             // палитра под картиной
  const DOT_R = 19;
  const PALETTE = ['#655438', '#FEDA0C', '#3B2E1F'];             // цвета кружков из макета
  const DOT_OF = [0, 1, 2, 2];                                   // кепка, цепь, торс, кисти
  const LINE_W = [10, 10, 10, 10];                              // как в Figma: 5 px на кадре 728 = 10 px картины                              // толщина линий, px картины
  // откуда появляются карандаши (кончик), чуть за пределами картины
  const CORNERS = [[612, 70], [28, 96], [22, 590], [600, 604]];
  // где кончик касается краски (двое тёмных макают в один кружок с разных сторон)
  const DIPS = [[272, 553], [322, 553], [364, 551], [378, 561]];

  // ---- Тайминг, секунды ----
  // Карандаши выходят по очереди: тёмно-коричневый (торс), светло-коричневый (кепка),
  // второй тёмно-коричневый (кисти), золотой (цепь). У каждого свой сценарий со сдвигом.
  const ORDER = [1, 3, 0, 2];                 // очередь появления для групп [кепка, цепь, торс, кисти]
  const P0 = 1.7, STAG = 1.0;                  // первый карандаш и шаг между карандашами
  const PH = { appear: [0, 0.8], toPalette: [1.0, 2.3], dip: [2.3, 3.2], toStart: [3.2, 4.3], draw: [4.3, 10.3], out: [10.3, 11.0] };
  const T = {
    dots: 0.4, dotStep: 0.25, dotDur: 0.55,    // кружки палитры
    dotsOut: [15.0, 15.8],                     // палитра уходит, как только все линии дорисованы
    glow: [[15.9, 17.1], [17.2, 18.4], [18.5, 19.7]], // полоса света проходит трижды за то же время
    dim: [[15.6, 16.0], [20.2, 20.3]],         // эскиз и исходник приглушаются на 35% на время генерации
    pill: [15.75, 19.85],                      // «generating...» — уходит до появления итога
    fade: [19.85, 20.25],                      // итог проявляется быстро
    done: [20.15, 23.45],                      // «completed» с галочкой
    check: [20.3, 20.6],                       // галочка рисуется
    back: [23.6, 24.6],
    loop: 24.8,
  };
  const pStart = gi => P0 + ORDER[gi] * STAG;
  const ph = (t, gi, key) => { const o = pStart(gi); return [o + PH[key][0], o + PH[key][1]]; };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOutSine = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
  const backOut = t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const prog = (t, [a, b]) => clamp((t - a) / (b - a));
  const mixHex = (a, b, k) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, k));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  };
  // точка картины → точка сцены (с учётом поворота и масштаба)
  const cosR = Math.cos(PIC.rot), sinR = Math.sin(PIC.rot);
  const toStage = ([x, y]) => {
    const u = (x - IW / 2) * S, v = (y - IH / 2) * S;
    return [PIC.cx + u * cosR - v * sinR, PIC.cy + u * sinR + v * cosR];
  };

  // ---- Штрихи: длины и расписание «рисую / переношу» ----
  const strokeEase = k => 0.6 * k + 0.4 * easeInOutSine(k); // разгон и мягкое торможение внутри штриха
  const groups = strokes.map(list => {
    const polys = list.map(pts => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum, len: cum[cum.length - 1] };
    });
    const segs = []; let pos = null;
    polys.forEach((p, i) => {
      if (pos) segs.push({ type: 'hop', from: pos, to: p.pts[0], w: Math.hypot(p.pts[0][0] - pos[0], p.pts[0][1] - pos[1]) / 2 + 45 });
      segs.push({ type: 'draw', poly: i, w: p.len });
      pos = p.pts[p.pts.length - 1];
    });
    const total = segs.reduce((s, x) => s + x.w, 0);
    let acc = 0; segs.forEach(s => { s.a = acc / total; acc += s.w; s.b = acc / total; });
    return { polys, segs, start: polys[0].pts[0] };
  });
  function pointAt(poly, d) {
    const { pts, cum } = poly;
    if (d <= 0) return pts[0];
    if (d >= poly.len) return pts[pts.length - 1];
    let i = 1; while (cum[i] < d) i++;
    const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)];
  }
  function groupState(g, p) {
    const drawn = g.polys.map(() => 0); let tip = g.start, lifted = 0;
    for (const s of g.segs) {
      if (p >= s.b) { if (s.type === 'draw') drawn[s.poly] = g.polys[s.poly].len; tip = s.type === 'draw' ? g.polys[s.poly].pts.at(-1) : s.to; continue; }
      if (p < s.a) break;
      const k = (p - s.a) / (s.b - s.a);
      if (s.type === 'draw') { drawn[s.poly] = g.polys[s.poly].len * strokeEase(k); tip = pointAt(g.polys[s.poly], drawn[s.poly]); }
      else { const e = easeInOutSine(k); tip = [lerp(s.from[0], s.to[0], e), lerp(s.from[1], s.to[1], e)]; lifted = Math.sin(Math.PI * k); }
      break;
    }
    return { drawn, tip, lifted };
  }

  // ---- Рваный край картины (как кисть-обводка в макете) ----
  const edge = (() => {
    const { w, h, r } = PIC, pts = [];
    const hw = w / 2, hh = h / 2;
    // обход скруглённого прямоугольника
    const segs = [];
    const arc = (cx, cy, a0) => { for (let i = 0; i <= 12; i++) { const a = a0 + (i / 12) * Math.PI / 2; segs.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
    arc(hw - r, -hh + r, -Math.PI / 2); arc(hw - r, hh - r, 0); arc(-hw + r, hh - r, Math.PI / 2); arc(-hw + r, -hh + r, Math.PI);
    segs.push(segs[0]);
    let acc = 0;
    for (let i = 1; i < segs.length; i++) {
      const [x0, y0] = segs[i - 1], [x1, y1] = segs[i], L = Math.hypot(x1 - x0, y1 - y0);
      const nx = (y1 - y0) / (L || 1), ny = -(x1 - x0) / (L || 1);
      for (let d = 0; d < L; d += 1.6) {
        const u = acc + d, x = lerp(x0, x1, d / L), y = lerp(y0, y1, d / L);
        const n = 1.1 * Math.sin(u * 0.21 + 1.3) + 0.8 * Math.sin(u * 0.53 + 0.4) + 0.5 * Math.sin(u * 1.37 + 2.2) + 0.35 * Math.sin(u * 2.9);
        pts.push([x - nx * n, y - ny * n]);
      }
      acc += L;
    }
    return pts;
  })();
  const edgePath = c => { c.beginPath(); edge.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); };

  // Кружок палитры с неровным краем
  const blob = (seed) => {
    const pts = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const n = 0.45 * Math.sin(a * 7 + seed) + 0.3 * Math.sin(a * 13 + seed * 2) + 0.25 * Math.sin(a * 23 + seed * 3);
      pts.push([Math.cos(a) * (DOT_R + 1.2 + n), Math.sin(a) * (DOT_R + 1.2 + n)]);
    }
    return pts;
  };
  const BLOBS = [blob(1), blob(2.7), blob(4.1)];

  // ---- Холст самой картины (в её пикселях) ----
  const pc = makeCanvas(IW, IH), pctx = pc.getContext('2d');
  // карта расстояний от линий: по ней итог «прорастает» из эскиза
  const DW = assets.dist.width, DH = assets.dist.height;
  const dmapC = makeCanvas(DW, DH), dctx = dmapC.getContext('2d');
  dctx.drawImage(assets.dist, 0, 0);
  const dist = dctx.getImageData(0, 0, DW, DH).data;
  const maskC = makeCanvas(DW, DH), mctx = maskC.getContext('2d'), maskID = mctx.createImageData(DW, DH);
  const rimC = makeCanvas(DW, DH), rctx = rimC.getContext('2d'), rimID = rctx.createImageData(DW, DH);
  const revealC = makeCanvas(IW, IH), rcx = revealC.getContext('2d');
  function buildMasks(thr, soft) {
    const m = maskID.data, r = rimID.data;
    for (let i = 0; i < dist.length; i += 4) {
      const d = dist[i];
      m[i] = m[i + 1] = m[i + 2] = 0; m[i + 3] = clamp((thr - d) / soft) * 255;
      const rim = clamp(1 - Math.abs(thr - d - soft * 0.6) / (soft * 1.1));
      r[i] = r[i + 1] = r[i + 2] = 255; r[i + 3] = rim * rim * 255;
    }
    mctx.putImageData(maskID, 0, 0); rctx.putImageData(rimID, 0, 0);
  }

  function paintPicture(t, states) {
    const c = pctx;
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.drawImage(assets.A, 0, 0, IW, IH);
    // эскиз: линия появляется ровно там, где прошёл кончик карандаша
    const backK = ease(prog(t, T.back));
    if (t >= T.back[0]) return;               // на возврате под итогом лежит чистый исходник
    c.lineCap = 'round'; c.lineJoin = 'round';
    groups.forEach((g, gi) => {
      c.strokeStyle = PALETTE[DOT_OF[gi]];
      g.polys.forEach((poly, i) => {
        const d = states[gi].drawn[i];
        if (d <= 0) return;
        // кисть с лёгким «дыханием» толщины, как у динамической кисти в Figma
        const P = poly.pts, CU = poly.cum;
        let k = 1;
        while (k < P.length && CU[k - 1] < d) {
          const k1 = Math.min(P.length - 1, k + 3);
          const wv = 1 + 0.09 * Math.sin(CU[k] * 0.045 + gi * 1.7 + i) + 0.05 * Math.sin(CU[k] * 0.16 + i * 2.3);
          c.lineWidth = LINE_W[gi] * wv;
          c.beginPath(); c.moveTo(P[k - 1][0], P[k - 1][1]);
          let end = false;
          for (let q = k; q <= k1; q++) {
            if (CU[q] > d) { const tp = pointAt(poly, d); c.lineTo(tp[0], tp[1]); end = true; break; }
            c.lineTo(P[q][0], P[q][1]);
          }
          c.stroke();
          if (end) break;
          k = k1 + 1;
        }
      });
    });
  }

  // ---- Карандаш-иконка (кончик в 0,0, корпус вдоль +x) ----
  const PW = 15, PL = 132, PE = 100, PS = 0.85 * S; // PS — масштаб иконки в ед. макета
  function pencilPath(c) {
    const r = 7;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(PW, -PW);
    c.lineTo(PL - r, -PW); c.quadraticCurveTo(PL, -PW, PL, -PW + r);
    c.lineTo(PL, PW - r); c.quadraticCurveTo(PL, PW, PL - r, PW);
    c.lineTo(PW, PW); c.closePath();
  }
  function pencil(c, k, x, y, fill, scale, alpha, lift) {
    if (alpha <= 0.002 || scale <= 0) return;
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y - lift * 2.2); c.rotate(-Math.PI / 4); c.scale(PS * scale, PS * scale);
    c.lineJoin = 'round';
    // белый ореол и еле заметная тень (тень задаётся в пикселях экрана)
    c.save();
    c.shadowColor = `rgba(0,0,0,${0.2 + lift * 0.05})`;
    c.shadowBlur = (2.8 + lift * 2.5) * k;
    c.shadowOffsetX = (0.6 + lift * 1.4) * k; c.shadowOffsetY = (1.6 + lift * 2.8) * k;
    pencilPath(c); c.lineWidth = 13; c.strokeStyle = '#fff'; c.stroke(); c.fillStyle = '#fff'; c.fill();
    c.restore();
    pencilPath(c); c.fillStyle = fill; c.fill();
    c.save(); pencilPath(c); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(PE, -PW, PL - PE, PW * 2);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(0, -PW, PE, PW * 0.8);
    c.restore();
    pencilPath(c); c.lineWidth = 5.5; c.strokeStyle = '#111'; c.stroke();
    c.beginPath(); c.moveTo(PE, -PW); c.lineTo(PE, PW); c.stroke();
    c.restore();
  }
  // плавный перелёт по дуге
  const arcMove = (a, b, k, bend = 0.18) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
    const cx = mx - dy * bend, cy = my + dx * bend, u = 1 - k;
    return [u * u * a[0] + 2 * u * k * cx + k * k * b[0], u * u * a[1] + 2 * u * k * cy + k * k * b[1]];
  };

  // ---- Плашка «generating...» (Frame 8 из макета: 105×25, радиус 7, чёрный 25%, поворот 4,13°) ----
  const PILL = { x: 1063.8 - 790, y: 698 - 232, w: 105, h: 25, r: 7, rot: Math.asin(0.07196) };
  function pillBox(c, a) {
    c.globalAlpha = a;
    c.translate(PILL.x, PILL.y); c.rotate(PILL.rot);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.roundRect(0, 0, PILL.w, PILL.h, PILL.r); c.fill();
    c.font = '500 16px "BIPs", "Grandstander", sans-serif';
    c.textBaseline = 'middle'; c.fillStyle = '#fff';
  }
  function pill(c, t) {
    // «generating...»: точки загораются по очереди — «.», «..», «...», и снова
    let a = clamp(Math.min((t - T.pill[0]) / 0.35, (T.pill[1] - t) / 0.3));
    if (a > 0) {
      c.save(); pillBox(c, a);
      const word = 'generating', dot = '.';
      const ww = c.measureText(word).width, dw = c.measureText(dot).width;
      const total = ww + dw * 3, fit = Math.min(1, 90 / total); // ширина надписи в макете — 90 px
      c.translate(PILL.w / 2, 0); c.scale(fit, 1); c.translate(-total / 2, 0);
      const y0 = PILL.h / 2 + 0.5;
      c.fillText(word, 0, y0);
      const step = Math.floor((t - T.pill[0]) / 0.42) % 3;
      for (let i = 0; i < 3; i++) { c.globalAlpha = a * (i <= step ? 1 : 0.25); c.fillText(dot, ww + dw * i, y0); }
      c.restore();
    }
    // «completed» с быстро рисующейся галочкой
    a = clamp(Math.min((t - T.done[0]) / 0.3, (T.done[1] - t) / 0.35));
    if (a > 0) {
      c.save(); pillBox(c, a);
      const word = 'completed', ww = c.measureText(word).width, gap = 5, cw = 11;
      const total = ww + gap + cw, fit = Math.min(1, 90 / total);
      c.translate(PILL.w / 2, 0); c.scale(fit, 1); c.translate(-total / 2, 0);
      const y0 = PILL.h / 2 + 0.5;
      c.fillText(word, 0, y0);
      const k = easeOut(prog(t, T.check));
      if (k > 0) {
        const x = ww + gap, P = [[x, y0], [x + 3.8, y0 + 4], [x + cw, y0 - 5]];
        const l1 = Math.hypot(3.8, 4), l2 = Math.hypot(cw - 3.8, 9), d = k * (l1 + l2);
        c.strokeStyle = '#fff'; c.lineWidth = 2.2; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(P[0][0], P[0][1]);
        if (d <= l1) c.lineTo(P[0][0] + (P[1][0] - P[0][0]) * d / l1, P[0][1] + (P[1][1] - P[0][1]) * d / l1);
        else { c.lineTo(P[1][0], P[1][1]); const e = (d - l1) / l2; c.lineTo(P[1][0] + (P[2][0] - P[1][0]) * e, P[1][1] + (P[2][1] - P[1][1]) * e); }
        c.stroke();
      }
      c.restore();
    }
  }

  // ---- Шаги для подписи на странице ----
  function info(t) {
    t = ((t % T.loop) + T.loop) % T.loop;
    return { step: t < ph(t, 2, 'draw')[0] ? 0 : t < T.glow[0][0] ? 1 : t < T.back[0] ? 2 : 0 };
  }

  // ---- Кадр. k — пикселей экрана на единицу макета ----
  function draw(ctx, tRaw, k) {
    const t = ((tRaw % T.loop) + T.loop) % T.loop;
    const dps = groups.map((g, gi) => prog(t, ph(t, gi, 'draw')));
    const states = groups.map((g, gi) => groupState(g, dps[gi]));
    paintPicture(t, states);

    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, SW, SH);

    // 1. Картина с рваным краем и белой обводкой
    ctx.save();
    ctx.translate(PIC.cx, PIC.cy); ctx.rotate(PIC.rot);
    ctx.save(); edgePath(ctx); ctx.clip();
    // на время генерации эскиз и исходник приглушены на 35%
    const dimK = easeInOutSine(prog(t, T.dim[0])) * (1 - easeInOutSine(prog(t, T.dim[1])));
    ctx.globalAlpha = 1 - 0.35 * dimK;
    ctx.drawImage(pc, -PIC.w / 2, -IH * S / 2, PIC.w, IH * S);
    // итог — новый слой, быстро набирает непрозрачность от 0 до 100%
    const f = easeInOutSine(prog(t, T.fade)) * (1 - ease(prog(t, T.back)));
    ctx.globalAlpha = f;
    if (f > 0) ctx.drawImage(assets.C, -PIC.w / 2, -IH * S / 2, PIC.w, IH * S);
    ctx.globalAlpha = 1;
    ctx.restore();
    edgePath(ctx); ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();

    // 2. Палитра: кружки по очереди плавно вырастают из нуля и проявляются
    DOTS.forEach(([x, y], i) => {
      const a = prog(t, [T.dots + i * T.dotStep, T.dots + i * T.dotStep + T.dotDur]);
      // уходят по очереди: уменьшаются и тают
      const out = prog(t, [T.dotsOut[0] + i * 0.12, T.dotsOut[1] - 0.24 + i * 0.12]);
      let sc = backOut(a) * (1 - easeOut(out));
      // кружок чуть приседает, когда в него макают карандаш
      groups.forEach((g, gi) => {
        if (DOT_OF[gi] !== i) return;
        const dk = prog(t, ph(t, gi, 'dip'));
        if (dk > 0 && dk < 1) sc *= 1 - 0.06 * Math.sin(Math.PI * clamp((dk - 0.1) / 0.6));
      });
      const al = easeOut(clamp(a * 1.3)) * (1 - out);
      if (sc <= 0 || al <= 0) return;
      ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.scale(sc, sc);
      ctx.beginPath(); BLOBS[i].forEach(([px, py], j) => j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
      ctx.fillStyle = PALETTE[i]; ctx.fill();
      ctx.restore();
    });

    // 3. Полоса света проходит по картине (как в макете: белая, размытая, наклон 15°)
    T.glow.forEach(seg => {
      const g = prog(t, seg);
      if (g <= 0 || g >= 1) return;
      const e = easeInOutSine(g);
      const x = lerp(-190, SW + 190, e);
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.sin(Math.PI * g) * 1.6);
      ctx.translate(x, PIC.cy); ctx.rotate(15.36 * Math.PI / 180);
      ctx.drawImage(assets.band, -158, -382, 316, 764);
      ctx.restore();
    });

    pill(ctx, t);

    // 4. Карандаши: по очереди проявляются белыми у углов → летят к палитре → макают и окрашиваются → рисуют → тают
    const drawOrder = groups.map((g, gi) => gi).sort((a, b) => ORDER[a] - ORDER[b]);
    drawOrder.forEach(gi => {
      const g = groups[gi], st = states[gi], col = PALETTE[DOT_OF[gi]], dp = dps[gi];
      const [a0] = ph(t, gi, 'appear'), [, o1] = ph(t, gi, 'out');
      if (t < a0 || t >= o1) return;
      const appear = easeInOutSine(prog(t, ph(t, gi, 'appear')));
      const vanish = easeInOutSine(prog(t, ph(t, gi, 'out')));
      const start = toStage(g.start);
      const kP = prog(t, ph(t, gi, 'toPalette')), kD = prog(t, ph(t, gi, 'dip')), kS = prog(t, ph(t, gi, 'toStart'));
      let p = CORNERS[gi], lift = 0.7, colorK = 0;
      if (kS >= 1) { p = toStage(st.tip); lift = dp < 1 ? st.lifted * 0.8 : 0.6 * vanish; colorK = 1; }
      else if (kS > 0) { const e = easeInOutSine(kS); p = arcMove(DIPS[gi], start, e, gi % 2 ? 0.15 : -0.15); lift = 0.7 * (1 - e) + 0.35 * Math.sin(Math.PI * e); colorK = 1; }
      else if (kD > 0) {
        p = DIPS[gi];
        lift = 0.7 * (1 - Math.sin(Math.PI * clamp(kD / 0.85)));   // мягко опускается в краску и поднимается
        colorK = easeInOutSine(clamp((kD - 0.15) / 0.6));
      }
      else if (kP > 0) { const e = easeInOutSine(kP); p = arcMove(CORNERS[gi], DIPS[gi], e, gi % 2 ? -0.2 : 0.2); lift = 0.7 + 0.3 * Math.sin(Math.PI * e); }
      const fill = mixHex('#ffffff', col, colorK);
      pencil(ctx, k, p[0], p[1], fill, lerp(0.88, 1, appear) * (1 - 0.12 * vanish), appear * (1 - vanish), lift);
    });
    ctx.restore();
  }

  return { draw, info, SW, SH, duration: T.loop };
}
export { createMaestro };
