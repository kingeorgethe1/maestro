// MAESTRO — одностраничное приложение. Маршруты через #hash, чтобы GitHub Pages не отдавал 404.
//   #/            главная            #/catalog       каталог
//   #/work/ID     карточка работы    #/draw/ID       редактор (ID = upload — своё изображение)
//   #/result      результат последней генерации      #/result/SAVED_ID  сохранённая работа
//   #/my          мои работы         #/favs          избранные картины
import { WORKS, FILTERS } from './catalog.js';
import { t, L, getLang, setLang } from './i18n.js';
import { createMaestro } from './hero.js';
import { Editor, blobImage } from './editor.js';
import { generate, isDemo, ApiError, getBalance, getPacks } from './api.js';
import * as store from './store.js';
import { roughen } from './rough.js';

const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);
const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = (id) => WORKS.find((w) => w.id === id);
const imgSrc = (w) => `paintings/${w.id}.jpg`;

// ---------- общее состояние ----------
const S = {
  filters: { category: new Set(), finish: new Set(), percent: new Set(), technique: new Set(), period: new Set(), artist: '', movement: '' },
  moreOpen: false,
  upload: null,          // своё изображение для редактора (Image)
  last: null,            // последняя генерация: { work, composite, painting, layer, result: Blob, closeness, description }
  cleanup: [],           // что остановить при уходе со страницы
};

// ---------- мелочи интерфейса ----------
let toastTimer;
function toast(msg) {
  let el = $('#toast'); if (!el) { el = h('<div id="toast" class="toast" role="status"></div>'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
// Кнопка и фильтр из «MAESTRO · компоненты»: рваная обводка 6/5 px (L/S) и 5 px снаружи у фильтров
const btn = (label, kind = 'outline', size = 'L', attrs = '') =>
  `<button class="btn ${kind} ${size === 'S' ? 'small' : ''}" data-rough="${size === 'S' ? 5 : 6} var(--ink) var(${kind === 'solid' ? '--ink' : '--paper'}) 30" ${attrs}><span>${esc(label)}</span></button>`;
const chip = (label, on, attrs = '', tag = 'button') =>
  `<${tag} class="chip ${on ? 'on' : ''}" data-rough="5 var(--ink) var(${on ? '--ink' : '--paper'}) 20 outside" ${attrs}><span>${esc(label)}</span></${tag}>`;
// Картина: белая рваная рамка 6 px поверх края, скругление r, наклон rot
function picture(src, alt, rot = 0, r = 32, extra = '') {
  return `<figure class="pic" style="--rot:${rot}deg;--r:${r}px" data-rough="6 #fff none ${r}" data-seed="${esc(alt)}${rot}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onerror="this.closest('.pic').classList.add('noimg')">${extra}<span class="pic-ph">${esc(alt)}</span></figure>`;
}
const ui = (name) => `assets/img/ui/${name}.svg`;
const langBtn = () => `<button class="lang" data-act="lang" aria-label="Language">${getLang() === 'ru' ? '<b>RU</b> / EN' : '<b>EN</b> / RU'}</button>`;
// Шапка: logo · меню · login. back — ссылка «← …» вместо пункта «catalog» (карточка, результат)
function header(active, back = null) {
  const first = back ? `<a href="${back.href}" class="on" ${back.attrs || ''}>${esc(back.label)}</a>` : `<a href="#/catalog" class="${active === 'catalog' ? 'on' : ''}">${t('nav.catalog')}</a>`;
  return `<header class="top ${active === 'catalog' ? 'wide' : ''}">
    <a class="logo" href="#/">maestro</a>
    <nav>${first}<a href="#/favs" class="${active === 'favs' ? 'on' : ''}">${t('nav.favs')}</a><a href="#/my" class="${active === 'my' ? 'on' : ''}">${t('nav.my')}</a><a href="#/buy" class="${active === 'buy' ? 'on' : ''}">${t('nav.buy')}</a></nav>
    <div class="top-right">${langBtn()}${btn(t('nav.login'), 'outline', 'S', 'data-act="soon"')}</div>
  </header>`;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'lang') { setLang(getLang() === 'ru' ? 'en' : 'ru'); route(); }
  if (a.dataset.act === 'soon') toast(t('soon.accounts'));
});

// ---------- главная ----------
async function viewHome() {
  app.innerHTML = `<main class="home">
    <div class="top-right">${langBtn()}${btn(t('nav.login'), 'outline', 'S', 'data-act="soon"')}</div>
    <div class="hero-text">
      <h1>${t('hero.title')}</h1>
      <p class="lead">${t('hero.lead')}</p>
      <div class="actions">${btn(t('hero.choose'), 'solid', 'L', 'data-go="#/catalog"')}${btn(t('hero.how'), 'outline', 'L', 'id="how"')}</div>
    </div>
    <div class="stage"><canvas id="hero-cv" role="img" aria-label="${esc(t('hero.title'))}"></canvas>
      <button class="anim-toggle" id="anim-toggle" aria-label="Pause">❚❚</button></div>
  </main>`;
  bindGo();
  const load = (s) => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = s; });
  const [A, C, band, dist, strokes] = await Promise.all([
    load('assets/img/hero/original.jpg'), load('assets/img/hero/result.jpg'), load('assets/img/hero/band.png'), load('assets/img/hero/dist.png'),
    fetch('assets/img/hero/strokes.json').then((r) => r.json()),
  ]);
  try { await document.fonts.load('500 16px BIPs'); } catch {}
  const cv = $('#hero-cv'); if (!cv) return;
  const m = createMaestro({ assets: { A, C, band, dist }, strokes, makeCanvas: (w, hh) => Object.assign(document.createElement('canvas'), { width: w, height: hh }) });
  const ctx = cv.getContext('2d');
  const resize = () => { const d = Math.min(2, devicePixelRatio || 1); cv.width = Math.round(cv.clientWidth * d); cv.height = Math.round(cv.clientHeight * d); };
  resize(); addEventListener('resize', resize);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tm = reduce ? 22 : 0, playing = !reduce, last = null, raf;
  const tg = $('#anim-toggle'); tg.textContent = playing ? '❚❚' : '▶';
  tg.onclick = () => { playing = !playing; last = null; tg.textContent = playing ? '❚❚' : '▶'; };
  $('#how').onclick = () => { tm = 0; playing = true; last = null; tg.textContent = '❚❚'; };
  const frame = (now) => { if (playing) { if (last != null) tm += Math.min(0.1, (now - last) / 1000); last = now; } m.draw(ctx, tm, cv.width / m.SW); raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
  S.cleanup.push(() => { cancelAnimationFrame(raf); removeEventListener('resize', resize); });
}
function bindGo(root = app) { root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.go; })); }

// ---------- каталог ----------
function matches(w, f, skip) {
  const anyOf = (set, vals) => !set.size || vals.some((v) => set.has(v));
  return (skip === 'category' || anyOf(f.category, [w.category]))
    && (skip === 'finish' || anyOf(f.finish, w.finish))
    && (skip === 'percent' || anyOf(f.percent, w.percent ? [w.percent] : []))
    && (skip === 'technique' || anyOf(f.technique, w.technique))
    && (skip === 'period' || anyOf(f.period, [w.period]))
    && (skip === 'artist' || !f.artist || w.artist.en === f.artist)
    && (skip === 'movement' || !f.movement || w.movement.en === f.movement);
}
function viewCatalog() {
  const f = S.filters;
  const list = WORKS.filter((w) => matches(w, f));
  const count = (group, val) => WORKS.filter((w) => matches(w, f, group) && (
    group === 'category' ? w.category === val : group === 'finish' ? w.finish.includes(val) : group === 'percent' ? w.percent === val :
    group === 'technique' ? w.technique.includes(val) : w.period === val)).length;
  const row = (group, labelKey) => `<div class="frow"><span class="flabel">${t(labelKey)}</span><div class="chips">
      ${chip(t('f.all'), !f[group].size, `data-f="${group}" data-v="*"`)}
      ${FILTERS[group].map((v) => { const n = count(group, v); return chip(t(group + '.' + v), f[group].has(v), `data-f="${group}" data-v="${v}" ${n || f[group].has(v) ? '' : 'disabled'}`); }).join('')}
    </div></div>`;
  const uniq = (fn) => [...new Set(WORKS.map(fn))].sort();
  // выпадающий список в стиле фильтров: кнопка с рваной обводкой и всплывающий список
  const select = (key, labelKey, values) => {
    const name = (v) => (key === 'artist' ? L(WORKS.find((w) => w.artist.en === v).artist) : L(WORKS.find((w) => w.movement.en === v).movement));
    return `<div class="frow"><span class="flabel">${t(labelKey)}</span><div class="dd" data-dd="${key}">
      ${chip(`${f[key] ? name(f[key]) : t('f.any')} ▾`, !!f[key], 'aria-haspopup="listbox"')}
      <div class="dd-list" data-rough="4 var(--ink) var(--paper) 20" hidden><div class="dd-scroll" role="listbox">
        ${['', ...values.sort((a, b) => name(a).localeCompare(name(b)))].map((v) => `<button class="dd-opt ${f[key] === v ? 'on' : ''}" role="option" data-s="${key}" data-v="${esc(v)}">${esc(v ? name(v) : t('f.any'))}</button>`).join('')}
      </div></div></div></div>`;
  };
  app.innerHTML = `${header('catalog')}
  <main class="page">
    <div class="intro"><h1 class="h1">${t('cat.title')}</h1><p class="lead">${t('cat.lead')}</p></div>
    <section class="filters">
      ${row('category', 'f.category')}${row('finish', 'f.finish')}
      <div class="frow more-row"><button class="link" id="more" aria-expanded="${S.moreOpen}">${S.moreOpen ? t('f.less') + ' ▴' : t('f.more') + ' ▾'}</button>
        <span class="small muted">${t('f.moreHint')}</span>
        <span class="small muted">· ${t('f.count', list.length)}</span>
        ${list.length !== WORKS.length ? `<button class="link" id="reset">${t('f.reset')}</button>` : ''}</div>
      <div class="more" ${S.moreOpen ? '' : 'hidden'}>${row('technique', 'f.technique')}${row('period', 'f.period')}
        ${select('artist', 'f.artist', uniq((w) => w.artist.en))}${select('movement', 'f.movement', uniq((w) => w.movement.en))}
        ${row('percent', 'f.percent')}</div>
    </section>
    ${list.length ? `<section class="grid">${list.map((w, i) => workCard(w, i)).join('')}</section>`
    : `<div class="empty"><p>${t('cat.empty')}</p>${btn(t('f.reset'), 'outline', 'S', 'id="reset2"')}</div>`}
  </main>`;
  app.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    const g = b.dataset.f, v = b.dataset.v;
    if (v === '*') f[g].clear(); else f[g].has(v) ? f[g].delete(v) : f[g].add(v);
    viewCatalog();
  }));
  app.querySelectorAll('.dd').forEach((dd) => {
    const list = dd.querySelector('.dd-list');
    dd.querySelector('.chip').addEventListener('click', (e) => {
      e.stopPropagation(); const open = list.hidden;
      app.querySelectorAll('.dd-list').forEach((l) => { l.hidden = true; }); list.hidden = !open; if (open) roughen(list.parentElement);
    });
  });
  app.querySelectorAll('.dd-opt').forEach((o) => o.addEventListener('click', () => { f[o.dataset.s] = o.dataset.v; viewCatalog(); }));
  const closeDd = (e) => { if (!e.target.closest('.dd')) app.querySelectorAll('.dd-list').forEach((l) => { l.hidden = true; }); };
  document.addEventListener('click', closeDd); S.cleanup.push(() => document.removeEventListener('click', closeDd));
  $('#more').onclick = () => { S.moreOpen = !S.moreOpen; viewCatalog(); };
  const reset = () => { for (const k of ['category', 'finish', 'percent', 'technique', 'period']) f[k].clear(); f.artist = f.movement = ''; viewCatalog(); };
  const r1 = $('#reset'), r2 = $('#reset2'); if (r1) r1.onclick = reset; if (r2) r2.onclick = reset;
}

// карточка картины в сетке (каталог, избранное)
function workCard(w, i, extra = '') {
  return `<div class="card"><a class="card-link" href="#/work/${w.id}">
      <div class="frame">${picture(imgSrc(w), L(w.title), [1.6, -1.2, 0.8, -1.4, 1.2, -0.9][i % 6])}</div>
      <h3 class="h3">${esc(L(w.title))}</h3>
      <p class="m16 muted">${esc(L(w.artist))}${w.date ? ' · ' + esc(w.date) : ''}</p>
      <p class="finish-line"><span class="muted">${t('card.finishShort')}</span>${w.finish.map((x) => `<span>${esc(t('finish.' + x).toLowerCase())}</span>`).join('')}</p>
    </a>${extra}</div>`;
}

// ---------- избранное ----------
function viewFavs() {
  const list = store.favs().map(byId).filter(Boolean);
  app.innerHTML = `${header('favs')}
  <main class="page">
    <div class="intro tight"><h1 class="h1">${t('fav.title')}</h1><p class="lead muted">${t('fav.lead')}</p></div>
    ${list.length ? `<section class="grid">${list.map((w, i) => workCard(w, i, `<p class="links"><a class="link" href="#/draw/${w.id}">${t('work.start')}</a><button class="link muted" data-unfav="${w.id}">${t('fav.remove')}</button></p>`)).join('')}</section>`
    : `<div class="empty"><p class="body18">${t('fav.empty')}</p>${btn(t('my.choose'), 'solid', 'L', 'data-go="#/catalog"')}</div>`}
  </main>`;
  bindGo();
  app.querySelectorAll('[data-unfav]').forEach((b) => b.onclick = () => { store.toggleFav(b.dataset.unfav); viewFavs(); });
}

// ---------- покупка генераций ----------
async function viewBuy() {
  const paidBack = location.hash.includes('paid');
  app.innerHTML = `${header('buy')}
  <main class="page buy">
    <div class="intro tight"><h1 class="h1">${t('buy.title')}</h1><p class="lead muted">${t('buy.lead')}</p></div>
    <p class="balance m16" id="bal">…</p>
    <section class="packs" id="packs"></section>
    <p class="small muted pay-note">${t('buy.note')}</p>
    <section class="code-box">
      <h3 class="h3">${t('buy.codeTitle')}</h3>
      <p class="body18">${t('buy.codeText')}</p>
      <div class="code-row"><code id="code">${esc(store.token())}</code><button class="link" id="copy-code">${t('buy.copy')}</button></div>
      <div class="code-row"><span class="field small-field" data-rough="3 var(--ink) var(--paper) 16"><input id="code-in" placeholder="${esc(t('buy.codePh'))}" autocomplete="off"></span>${btn(t('buy.restore'), 'outline', 'S', 'id="restore"')}</div>
    </section>
  </main>`;
  const showBal = (b) => { $('#bal').textContent = b ? t('buy.balance', b.free, b.credits) : t('buy.offline'); };
  showBal(await getBalance());
  const { wallet, packs } = await getPacks().catch(() => ({ wallet: '', packs: [] }));
  const ru = (n) => n.toLocaleString('ru-RU');
  $('#packs').innerHTML = packs.length ? packs.map((p) => `
    <form class="pack" data-rough="4 var(--ink) var(--paper) 28" method="POST" action="https://yoomoney.ru/quickpay/confirm">
      <span class="pack-n">${p.gens}</span><span class="m16">${t('buy.gens', p.gens)}</span>
      <span class="pack-price">${ru(p.price)} ₽</span><span class="small muted">${t('buy.per', ru(Math.round(p.price / p.gens)))}</span>
      <input type="hidden" name="receiver" value="${esc(wallet)}"><input type="hidden" name="quickpay-form" value="button">
      <input type="hidden" name="sum" value="${p.price}"><input type="hidden" name="label" value="${esc(store.token())}:${p.id}">
      <input type="hidden" name="paymentType" value="AC"><input type="hidden" name="successURL" value="${esc(location.origin + location.pathname + '#/buy/paid')}">
      ${wallet ? btn(t('buy.pay'), 'solid', 'S', 'type="submit"') : `<span class="small muted">${t('buy.soon')}</span>`}
    </form>`).join('') : `<p class="body18">${t('buy.offline')}</p>`;
  $('#copy-code').onclick = async () => { try { await navigator.clipboard.writeText(store.token()); toast(t('buy.copied')); } catch {} };
  $('#restore').onclick = async () => {
    const v = $('#code-in').value.trim();
    if (!/^[a-z0-9-]{16,64}$/i.test(v)) { toast(t('buy.badCode')); return; }
    store.setToken(v); $('#code').textContent = store.token(); showBal(await getBalance()); toast(t('buy.restored'));
  };
  // вернулись после оплаты: уведомление ЮMoney приходит за секунды — обновляем баланс, пока не придёт
  if (paidBack) {
    toast(t('buy.waiting'));
    const before = (await getBalance()) || { credits: 0 };
    for (let i = 0; i < 20 && location.hash.startsWith('#/buy'); i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const b = await getBalance(); showBal(b);
      if (b && b.credits > before.credits) { toast(t('buy.thanks')); break; }
    }
  }
}

// ---------- карточка работы ----------
function viewWork(id) {
  const w = byId(id); if (!w) { location.hash = '#/catalog'; return; }
  const fav = store.favs().includes(w.id);
  const tags = [t('category.' + w.category), ...w.finish.map((x) => t('finish.' + x)), ...w.technique.map((x) => t('technique.' + x)), t('period.' + w.period), w.percent ? `${t('percent.' + w.percent)} ${t('work.unfinished')}` : null].filter(Boolean);
  const rows = [['work.artist', L(w.artist)], ['work.date', w.date], ['work.technique', L(w.techniqueText)], ['work.museum', L(w.museum)]].filter(([, v]) => v);
  app.innerHTML = `${header('catalog', { href: '#/catalog', label: '← ' + t('nav.catalog') })}
  <main class="page work">
    <div class="work-pic">${picture(imgSrc(w), L(w.title), 1.6, 44)}</div>
    <div class="work-info">
      <h1 class="work-title">${esc(L(w.title))}</h1>
      <dl class="meta">${rows.map(([k, v]) => `<dt>${t(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <p class="body18">${esc(L(w.desc))}</p>
      <div class="to-finish"><h3 class="h3">${t('work.toFinish')}</h3><p class="body18">${esc(L(w.toFinish))}</p></div>
      <div class="chips">${tags.map((x) => chip(x, false, '', 'span').replace('class="chip ', 'class="chip static ')).join('')}</div>
      <div class="actions">${btn(t('work.start'), 'solid', 'L', `data-go="#/draw/${w.id}"`)}${btn(t(fav ? 'work.saved' : 'work.save'), 'outline', 'S', 'id="fav"')}</div>
    </div>
  </main>`;
  bindGo();
  // сердечко — SVG с толстой линией (символ ♡ слишком тонкий); в избранном — закрашено
  const favLabel = (on) => { $('#fav span').innerHTML = `<svg class="heart" viewBox="0 0 24 22" width="20" height="18"><path d="M12 20s-8.5-5.2-8.5-11.2A4.8 4.8 0 0112 6a4.8 4.8 0 018.5 2.8C20.5 14.8 12 20 12 20z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/></svg>${esc(t(on ? 'work.saved' : 'work.save'))}`; };
  favLabel(fav);
  $('#fav').onclick = () => favLabel(store.toggleFav(w.id));
}

// ---------- редактор ----------
// Палитра из макета редактора: коричневый, золотой, тёмно-коричневый, чёрный + свой цвет
const PALETTE = [['#655438', 'brown'], ['#FEDA0C', 'gold'], ['#3B2E1F', 'dark-brown'], ['#000000', 'ink']];
const TOOLS = ['pencil', 'brush', 'eraser', 'line', 'fill', 'picker'];

async function viewDraw(id) {
  const w = id === 'upload' ? uploadWork() : byId(id);
  if (!w || (id === 'upload' && !S.upload)) { location.hash = '#/catalog'; return; }
  app.innerHTML = `<div class="editor">
    <header class="ed-top">
      <a class="link" href="#/catalog">← ${t('nav.catalog')}</a>
      <div class="ed-title" title="${esc(L(w.title))}"><span class="h3 ed-name">${esc(L(w.title))}</span><span class="m16 muted">${esc(L(w.artist))}${w.date ? ' · ' + esc(w.date) : ''}</span></div>
      <div class="ed-history">
        <button class="icon" id="undo" title="${t('ed.undo')}" aria-label="${t('ed.undo')}"><img src="${ui('undo')}" alt=""></button>
        <button class="icon" id="redo" title="${t('ed.redo')}" aria-label="${t('ed.redo')}"><img src="${ui('redo')}" alt=""></button>
        <button class="icon" id="eye" title="${t('ed.toggle')}" aria-label="${t('ed.toggle')}"><img src="${ui('eye')}" alt=""></button>
        ${btn(t('ed.clear'), 'outline', 'S', 'id="clear"')}
      </div>
    </header>
    <aside class="tools" data-rough="4 var(--ink) var(--paper) 28">
      ${TOOLS.map((k) => `<button class="tool ${k === 'pencil' ? 'on' : ''}" data-tool="${k}" title="${t('tool.' + k)}" aria-label="${t('tool.' + k)}"><img src="${ui(k)}" alt=""></button>`).join('')}
      <div class="sizes">${[[6, 22], [10, 16], [16, 22]].map(([d, hh], i) => `<button class="size ${i === 1 ? 'on' : ''}" style="height:${hh}px" data-size="${i}" aria-label="size ${i + 1}"><i style="width:${d}px;height:${d}px"></i></button>`).join('')}</div>
    </aside>
    ${w.toFinish ? `<div class="tip-row"><div class="tip" id="tip"><span>${t('ed.tip')} ${esc(L(w.toFinish))}</span><button class="icon" id="tip-x" aria-label="close">✕</button></div></div>` : ''}
    <div class="ed-host" id="host"><div class="gen-overlay" id="gen" hidden><div class="band"></div><div class="band b2"></div><div class="band b3"></div></div>
      <div class="zoom"><button class="icon" id="zout" aria-label="zoom out">−</button><span id="zval" title="${t('ed.fit')}">100%</span><button class="icon" id="zin" aria-label="zoom in">+</button></div></div>
    <div class="palette">${PALETTE.map(([c, n]) => `<button class="dot" data-color="${c}" data-name="${n}" aria-label="${c}"><img src="${ui('dot-' + n)}" alt=""></button>`).join('')}
      <button class="dot custom" id="more-colors" title="${t('ed.more')}" aria-label="${t('ed.more')}"><img src="${ui('dot-rainbow')}" alt=""><i class="cur"></i></button>
      <button class="pick" data-tool="picker"><img src="${ui('picker')}" alt="">${t('ed.pick')}</button>
      <div class="cpop" id="cpop" data-rough="4 var(--ink) var(--paper) 28" hidden>
        <canvas class="spectrum" id="spectrum" width="520" height="360" aria-label="${t('ed.more')}"></canvas>
        <div class="cpop-row"><span class="cpop-now" id="cpop-now"></span><span class="small muted">${t('ed.recent')}</span></div>
        <div class="swatches" id="swatches"></div>
      </div></div>
    <aside class="ai" data-rough="4 var(--ink) var(--paper) 28">
      <h2 class="h2">${t('ai.title')}</h2>
      <label class="switch"><input type="checkbox" id="style" checked><i></i><span>${t('ai.style')}</span></label>
      <p class="small muted">${t('ai.styleHint')}</p>
      <label class="slider"><span>${t('ai.close')}</span>
        <span class="range" style="--v:70%"><span class="track"></span><span class="fill"></span><span class="knob"></span><input type="range" id="close" min="0" max="100" value="70"></span>
        <span class="ends"><span>${t('ai.free')}</span><span>${t('ai.closeEnd')}</span></span></label>
      <label class="desc"><span>${t('ai.describe')}</span><span class="field" data-rough="3 var(--ink) var(--paper) 16"><textarea id="desc" maxlength="300" placeholder="${esc(t('ai.placeholder'))}"></textarea></span></label>
      <div class="grow"></div>
      ${btn(t('ai.go'), 'solid', 'L', 'id="go"')}
      <p class="credits" id="credits"></p>
    </aside>
  </div>`;

  const img = id === 'upload' ? S.upload : await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = imgSrc(w); });
  if (!img) { toast('Image not found: paintings/' + w.id + '.jpg'); return; }
  const host = $('#host');
  let saveTimer;
  let ed = null; // onChange вызывается уже из конструктора (fit()), до присваивания
  ed = new Editor(host, img, {
    onChange: (changed, what) => {
      if (!ed) return;
      $('#zval').textContent = Math.round(ed.zoom * 100) + '%';
      if (what === 'color') applyColor(ed.color); // пипетка: взятый цвет сразу в перо
      if (changed && id !== 'upload') { clearTimeout(saveTimer); saveTimer = setTimeout(async () => store.saveDraft({ workId: w.id, layer: await ed.layerBlob(), updated: Date.now() }), 1200); }
    },
  });
  $('#zval').textContent = Math.round(ed.zoom * 100) + '%';
  host.appendChild($('#gen')); host.appendChild($('.zoom'));
  ed.color = PALETTE[0][0];
  S.cleanup.push(() => ed.destroy());
  // черновик: продолжаем с того места, где остановились
  if (id !== 'upload') { const d = await store.getDraft(w.id).catch(() => null); if (d && d.layer) await ed.loadLayer(d.layer); }
  if (S.last && S.last.continueLayer && S.last.work.id === w.id) { await ed.loadLayer(S.last.continueLayer); S.last.continueLayer = null; }

  // выбранный кружок крупнее (47.5 px), как в макете
  const selectColor = (c) => {
    let any = false;
    app.querySelectorAll('.dot[data-color]').forEach((d) => {
      const on = d.dataset.color.toLowerCase() === c.toLowerCase(); any = any || on; d.classList.toggle('on', on);
      d.querySelector('img').src = ui('dot-' + d.dataset.name + (on && d.dataset.name === 'brown' ? '-on' : ''));
    });
    const cust = $('#more-colors'); cust.classList.toggle('on', !any); cust.querySelector('.cur').style.background = any ? '' : c;
  };
  selectColor(ed.color);
  const setTool = (k) => {
    ed.tool = k; app.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x.dataset.tool === k));
    $('.pick').classList.toggle('on', k === 'picker');
  };
  // выбранный цвет: в перо (если был ластик или пипетка)
  const applyColor = (c) => {
    ed.color = c; selectColor(c); drawSwatches();
    if (ed.tool === 'eraser' || ed.tool === 'picker') setTool('pencil');
  };

  // расширенная палитра: квадрат со всеми цветами и часто используемые цвета под ним
  const pop = $('#cpop'), spec = $('#spectrum'), sx = spec.getContext('2d');
  { const W = spec.width, H = spec.height, g = sx.createLinearGradient(0, 0, W, 0);
    ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'].forEach((c, i) => g.addColorStop(i / 6, c));
    sx.fillStyle = g; sx.fillRect(0, 0, W, H);
    const v = sx.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, '#fff'); v.addColorStop(0.08, 'rgba(255,255,255,1)'); v.addColorStop(0.5, 'rgba(255,255,255,0)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(0.92, 'rgba(0,0,0,1)'); v.addColorStop(1, '#000');
    sx.fillStyle = v; sx.fillRect(0, 0, W, H); }
  const hex = (r, g, b) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  const pickSpec = (e) => {
    const r = spec.getBoundingClientRect();
    const x = Math.max(0, Math.min(spec.width - 1, ((e.clientX - r.left) / r.width) * spec.width)), y = Math.max(0, Math.min(spec.height - 1, ((e.clientY - r.top) / r.height) * spec.height));
    const [R, G, B] = sx.getImageData(x, y, 1, 1).data; const c = hex(R, G, B);
    $('#cpop-now').style.background = c; applyColor(c);
  };
  let specDown = false;
  spec.onpointerdown = (e) => { specDown = true; spec.setPointerCapture(e.pointerId); pickSpec(e); };
  spec.onpointermove = (e) => { if (specDown) pickSpec(e); };
  spec.onpointerup = () => { specDown = false; };
  function drawSwatches() {
    $('#swatches').innerHTML = BASIC_COLORS.map((c) => `<button class="swatch ${c.toLowerCase() === ed.color.toLowerCase() ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  }
  $('#swatches').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { $('#cpop-now').style.background = b.dataset.c; applyColor(b.dataset.c); } };
  $('#more-colors').onclick = (e) => {
    e.stopPropagation(); pop.hidden = !pop.hidden;
    if (!pop.hidden) { $('#cpop-now').style.background = ed.color; drawSwatches(); roughen(pop.parentElement); }
  };
  const closePop = (e) => { if (!pop.hidden && !e.target.closest('#cpop, #more-colors')) pop.hidden = true; };
  document.addEventListener('pointerdown', closePop); S.cleanup.push(() => document.removeEventListener('pointerdown', closePop));
  app.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    setTool(b.dataset.tool);
    if (ed.tool === 'fill') toast(t('soon.fill'));
    if (ed.tool === 'picker') toast(t('ed.pickHint'));
  }));
  app.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => { ed.size = +b.dataset.size; app.querySelectorAll('.size').forEach((x) => x.classList.toggle('on', x === b)); }));
  app.querySelectorAll('.dot[data-color]').forEach((b) => b.addEventListener('click', () => applyColor(b.dataset.color)));
  $('#undo').onclick = () => ed.undo(); $('#redo').onclick = () => ed.redo();
  $('#eye').onclick = () => { ed.showLayer = !ed.showLayer; $('#eye').classList.toggle('off', !ed.showLayer); ed.render(); };
  $('#clear').onclick = () => { if (confirm(t('ed.clearConfirm'))) ed.clear(); };
  $('#zin').onclick = () => ed.zoomBy(1.25); $('#zout').onclick = () => ed.zoomBy(0.8); $('#zval').onclick = () => ed.fit();
  const closeIn = $('#close'); closeIn.oninput = () => closeIn.parentElement.style.setProperty('--v', closeIn.value + '%');
  const tipX = $('#tip-x'); if (tipX) tipX.onclick = () => $('#tip').remove();
  const styleBox = $('#style'), goBtn = $('#go');
  const syncGo = () => { goBtn.querySelector('span').textContent = styleBox.checked ? t('ai.go') : t('ai.noStyle'); $('.slider').classList.toggle('dim', !styleBox.checked); };
  styleBox.onchange = syncGo; syncGo();
  // сколько генераций осталось — под кнопкой
  const showCredits = (b) => {
    const el = $('#credits'); if (!el || !b) return;
    el.innerHTML = b.free > 0 ? esc(t('cr.free', b.free)) : b.credits > 0 ? esc(t('cr.paid', b.credits)) : `${esc(t('cr.none'))} <a class="link" href="#/buy">${t('cr.buy')}</a>`;
  };
  getBalance().then(showCredits);

  goBtn.onclick = async () => {
    if (ed.isEmpty()) { toast(t('ai.empty')); return; }
    const { composite, painting, layer } = ed.exportLayers();
    const closeness = +$('#close').value / 100, description = $('#desc').value.trim();
    const base = { work: w, composite, painting, layer, closeness, description, layerFull: await ed.layerBlob() };
    if (!styleBox.checked) { // без стиля мастера — сохраняем рисунок как есть
      S.last = { ...base, result: await new Promise((ok) => composite.toBlob(ok, 'image/png')), styled: false };
      location.hash = '#/result'; return;
    }
    goBtn.disabled = true;
    if (isDemo()) toast(t('ai.demo'));
    try {
      const result = await runGeneration(host, ed, () => generate(base));
      S.last = { ...base, result, styled: true };
      getBalance();
      location.hash = '#/result';
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_credits') { toast(t('cr.none')); location.hash = '#/buy'; return; }
      toast(err instanceof ApiError && err.code === 'limit' ? t('ai.limit') : err instanceof ApiError && err.code === 'moderation' ? t('ai.moderation') : t('ai.error'));
      console.error(err);
    } finally { goBtn.disabled = false; }
  };
}
// основные цвета под большим квадратом палитры — всегда один и тот же набор
const BASIC_COLORS = ['#FFFFFF', '#BDBDBD', '#6B6B6B', '#000000', '#E53935', '#FB8C00', '#FEDA0C', '#43A047', '#1E88E5', '#3949AB', '#8E24AA', '#6D4C41'];
function uploadWork() {
  return { id: 'upload', title: { en: 'My image', ru: 'Моё изображение' }, artist: { en: '', ru: '' }, date: '', techniqueText: { en: 'unknown', ru: '' }, movement: { en: '', ru: '' }, finish: [], toFinish: null, upload: true };
}

// Генерация поверх холста: приглушение на 35%, три прохода света, «generating…» с точками,
// затем быстрое проявление результата и «completed ✓» (как в анимации главной).
async function runGeneration(host, ed, job) {
  const ov = $('#gen'); ov.hidden = false; ov.className = 'gen-overlay run';
  ed.view.classList.add('dim');
  const pill = h(`<div class="status-pill"><span>${t('ai.generating')}</span><i>.</i><i>.</i><i>.</i></div>`); host.appendChild(pill);
  const minTime = new Promise((r) => setTimeout(r, 3800));      // три прохода полосы света
  let result;
  try { [result] = await Promise.all([job(), minTime]); }
  catch (e) { ov.hidden = true; ed.view.classList.remove('dim'); pill.remove(); throw e; }
  pill.classList.add('out'); ov.classList.add('stop');
  await new Promise((r) => setTimeout(r, 300));
  pill.remove();
  // результат ложится поверх картины на месте экспортированной области
  const [x, y, bw, bh] = ed.bounds();
  const layerEl = h('<img class="gen-result" alt="">');
  Object.assign(layerEl.style, { left: ed.ox + x * ed.zoom + 'px', top: ed.oy + y * ed.zoom + 'px', width: bw * ed.zoom + 'px', height: bh * ed.zoom + 'px' });
  layerEl.src = URL.createObjectURL(result);
  host.appendChild(layerEl); void layerEl.offsetWidth; layerEl.classList.add('in');
  await new Promise((r2) => setTimeout(r2, 450));
  const done = h(`<div class="status-pill done"><span>${t('ai.completed')}</span><svg viewBox="0 0 14 12" width="13" height="11"><path d="M1.5 6.5l3.6 3.5L12.5 2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`);
  host.appendChild(done);
  await new Promise((r2) => setTimeout(r2, 1300));
  ov.hidden = true; ed.view.classList.remove('dim');
  return result;
}

// ---------- результат ----------
async function viewResult(savedId) {
  let d = S.last;
  if (savedId) {
    const sv = await store.getWork(savedId).catch(() => null);
    if (!sv) { location.hash = '#/my'; return; }
    d = { work: byId(sv.workId) || uploadWork(), result: sv.result, compositeBlob: sv.composite, paintingBlob: sv.painting, saved: sv, layerFull: sv.layer };
  }
  if (!d) { location.hash = '#/catalog'; return; }
  const url = (b) => URL.createObjectURL(b);
  const toBlob = (c) => new Promise((ok) => c.toBlob(ok, 'image/png'));
  // PNG кодируем параллельно и один раз: при повторном открытии берём готовые
  const [compositeBlob, paintingBlob] = await Promise.all([d.compositeBlob || toBlob(d.composite), d.paintingBlob || toBlob(d.painting)]);
  d.compositeBlob = compositeBlob; d.paintingBlob = paintingBlob;
  const w = d.work;
  app.innerHTML = `${header('', { href: '#/draw/' + w.id, label: t('res.backCanvas'), attrs: 'id="back-canvas"' })}
  <main class="page result">
    <div class="res-head"><h1 class="res-title">${t('res.title')}</h1>
      <label class="switch"><input type="checkbox" id="sketch" checked><i></i><span>${t('res.sketchToggle')}</span></label></div>
    <div class="compare" id="cmp" style="--pos:50%" data-rough="6 #fff none 32">
      <img class="after" src="${url(d.result)}" alt="${esc(t('res.after'))}">
      <div class="before"><img src="${url(paintingBlob)}" alt="${esc(t('res.before'))}"><img class="sketch" src="${url(compositeBlob)}" alt=""></div>
      <span class="tag tag-l">${t('res.before')}</span><span class="tag tag-r">${t('res.after')}</span>
      <div class="handle"><span class="knob" data-rough="4 var(--ink) var(--paper) 24">‹ ›</span></div>
      <input type="range" min="0" max="100" value="50" step="0.1" aria-label="${esc(t('res.before'))} / ${esc(t('res.after'))}">
    </div>
    <div class="res-bar actions">${btn(t('res.download'), 'solid', 'S', 'id="dl"')}${d.saved ? '' : btn(t('res.save'), 'outline', 'S', 'id="save"')}</div>
  </main>`;
  const cmp = $('#cmp'), range = $('#cmp input'), after = $('#cmp .after');
  range.oninput = () => cmp.style.setProperty('--pos', range.value + '%');
  $('#sketch').onchange = (e) => cmp.classList.toggle('no-sketch', !e.target.checked);
  // картина почти на весь экран: вписываем в свободное место под заголовком, оставляя панель снизу
  const fit = () => {
    const ar = (after.naturalWidth || 4) / (after.naturalHeight || 3), main = $('.result');
    if (!main) return;
    const availW = main.clientWidth - parseFloat(getComputedStyle(main).paddingLeft) * 2;
    const availH = Math.max(260, innerHeight - cmp.getBoundingClientRect().top - $('.res-bar').offsetHeight - 56);
    const wpx = Math.min(availW, availH * ar);
    cmp.style.width = wpx + 'px'; cmp.style.height = wpx / ar + 'px';
    $('.res-head').style.width = wpx + 'px'; // заголовок и тумблер — по краям кадра с картиной
    roughen(main); // обводка кадра — под новый размер
  };
  after.complete ? fit() : after.addEventListener('load', fit); addEventListener('resize', fit);
  S.cleanup.push(() => removeEventListener('resize', fit));
  $('#dl').onclick = () => { const a = document.createElement('a'); a.href = url(d.result); a.download = `maestro-${w.id}-${Date.now()}.png`; a.click(); };
  $('#back-canvas').onclick = (e) => { if (d.layerFull && w.id !== 'upload') { e.preventDefault(); S.last = { ...(S.last || {}), work: w, continueLayer: d.layerFull }; location.hash = '#/draw/' + w.id; } };
  // сохранение сразу показываем как готовое, запись в базу идёт в фоне
  const save = $('#save');
  // «сохранено» с жирной галочкой — той же толщины, что сердечко на карточке
  const savedLabel = () => { save.disabled = true; save.classList.add('done'); save.querySelector('span').innerHTML = `<svg class="heart" viewBox="0 0 24 22" width="20" height="18"><path d="M4 11.5l5 5L20 5.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>${esc(t('res.savedBtn'))}`; };
  if (save && d.savedId) savedLabel();
  if (save && !d.savedId) save.onclick = async () => {
    const id = 'w' + Date.now();
    savedLabel(); toast(t('res.savedOk'));
    d.savedId = id;
    try { await store.saveWork({ id, workId: w.id, created: Date.now(), result: d.result, composite: compositeBlob, painting: paintingBlob, layer: d.layerFull }); }
    catch (err) { console.error(err); d.savedId = null; save.disabled = false; save.classList.remove('done'); save.querySelector('span').textContent = t('res.save'); toast(t('ai.error')); }
  };
}

// ---------- мои работы ----------
async function viewMy() {
  const [works, drafts] = await Promise.all([store.listWorks().catch(() => []), store.listDrafts().catch(() => [])]);
  const url = (b) => URL.createObjectURL(b);
  // «today, 14:32» / «yesterday, 21:10», дальше — дата
  const fmt = (ms) => {
    const loc = getLang() === 'ru' ? 'ru-RU' : 'en-GB', d = new Date(ms), day = (x) => new Date(x).setHours(0, 0, 0, 0);
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }), diff = Math.round((day(Date.now()) - day(ms)) / 864e5);
    return diff === 0 ? `${t('my.today')}, ${time}` : diff === 1 ? `${t('my.yesterday')}, ${time}` : d.toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const items = [
    ...works.map((s) => ({ kind: 'work', s, w: byId(s.workId) || uploadWork(), when: s.created, img: url(s.result) })),
    ...drafts.filter((d) => byId(d.workId)).map((d) => ({ kind: 'draft', s: d, w: byId(d.workId), when: d.updated, img: imgSrc(byId(d.workId)) })),
  ];
  app.innerHTML = `${header('my')}
  <main class="page my">
    <div class="intro tight"><h1 class="h1">${t('my.title')}</h1><p class="lead muted">${t('my.lead')}</p></div>
    ${items.length ? `<section class="grid">${items.map((it, i) => `
      <div class="card">
        <div class="frame">${picture(it.img, L(it.w.title), [1.4, -1.1, 0.7][i % 3], 30)}</div>
        <h3 class="h3">${esc(L(it.w.title))}</h3>
        <p class="m16 muted">${it.kind === 'draft' ? t('my.draft') : fmt(it.when)}</p>
        <p class="links">${it.kind === 'work'
          ? `<a class="link" href="#/result/${it.s.id}">${t('my.open')}</a><button class="link" data-dl="${it.s.id}">${t('my.download')}</button>${it.w.id !== 'upload' ? `<button class="link" data-cont="${it.s.id}">${t('my.continue')}</button>` : ''}<button class="link muted" data-del="${it.s.id}">${t('my.delete')}</button>`
          : `<a class="link" href="#/draw/${it.w.id}">${t('my.continue')}</a><button class="link muted" data-deldraft="${it.w.id}">${t('my.delete')}</button>`}</p>
      </div>`).join('')}</section>`
    : `<div class="empty"><p class="body18">${t('my.empty')}</p>${btn(t('my.choose'), 'solid', 'L', 'data-go="#/catalog"')}</div>`}
  </main>`;
  bindGo();
  app.querySelectorAll('[data-dl]').forEach((b) => b.onclick = async () => { const s = await store.getWork(b.dataset.dl); const a = document.createElement('a'); a.href = url(s.result); a.download = `maestro-${s.workId}.png`; a.click(); });
  app.querySelectorAll('[data-cont]').forEach((b) => b.onclick = async () => { const s = await store.getWork(b.dataset.cont); S.last = { work: byId(s.workId), continueLayer: s.layer }; location.hash = '#/draw/' + s.workId; });
  app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (confirm(t('my.deleteConfirm'))) { await store.deleteWork(b.dataset.del); viewMy(); } });
  app.querySelectorAll('[data-deldraft]').forEach((b) => b.onclick = async () => { if (confirm(t('my.deleteConfirm'))) { await store.deleteDraft(b.dataset.deldraft); viewMy(); } });
}

// ---------- маршрутизатор ----------
async function route() {
  S.cleanup.splice(0).forEach((fn) => { try { fn(); } catch {} });
  document.documentElement.lang = getLang();
  const [, page, arg] = (location.hash || '#/').split('/');
  window.scrollTo(0, 0);
  if (!page) return viewHome();
  if (page === 'catalog') return viewCatalog();
  if (page === 'work') return viewWork(arg);
  if (page === 'draw') return viewDraw(arg);
  if (page === 'result') return viewResult(arg);
  if (page === 'my') return viewMy();
  if (page === 'favs') return viewFavs();
  if (page === 'buy') return viewBuy();
  location.hash = '#/';
}
// рваные обводки у всего, что появилось на странице
new MutationObserver(() => roughen(app)).observe(app, { childList: true, subtree: true });
document.fonts && document.fonts.ready.then(() => roughen(app));
addEventListener('hashchange', route);
route();
