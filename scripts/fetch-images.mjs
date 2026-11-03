// Скачивает изображения картин для тех работ, у которых ещё нет файла paintings/ID.jpg.
// Источники: met — номер объекта Метрополитен-музея (берём primaryImage, только если isPublicDomain);
// иначе commons — поисковый запрос (или массив запросов, пробуются по очереди) на Wikimedia Commons.
// Если у работы есть met, а файл взят не оттуда (см. credits.json → source) — файл перекачивается.
// Запускается автоматически в GitHub Actions при публикации. Можно и вручную: node scripts/fetch-images.mjs
// Результат: paintings/ID.jpg, paintings/credits.json (автор файла и лицензия) и paintings/REPORT.md для проверки.
// ВАЖНО: поиск автоматический — проверьте отчёт глазами и замените неверные картинки своими файлами.
import { WORKS } from '../assets/js/catalog.js';
import fs from 'node:fs/promises';

const UA = 'MAESTRO-catalog/1.0 (https://github.com/kingeorgethe1/maestro; image fetch for an educational art project)';
const API = 'https://commons.wikimedia.org/w/api.php';
const MET = 'https://collectionapi.metmuseum.org/public/collection/v1/objects/';
const dir = new URL('../paintings/', import.meta.url);
const exists = (p) => fs.access(new URL(p, dir)).then(() => true, () => false);
const credits = JSON.parse(await fs.readFile(new URL('credits.json', dir), 'utf8').catch(() => '{}'));
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
const pause = () => new Promise((r) => setTimeout(r, 400)); // вежливо к API
const report = [];

async function download(url, id) {
  const img = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!img.ok) throw new Error('download ' + img.status);
  await fs.writeFile(new URL(`${id}.jpg`, dir), Buffer.from(await img.arrayBuffer()));
}

async function fromMet(w) {
  const j = await (await fetch(MET + w.met, { headers: { 'User-Agent': UA } })).json();
  if (!j.isPublicDomain || !j.primaryImage) return null;
  await download(j.primaryImage, w.id);
  return { source: 'met', file: `${j.title} — ${j.artistDisplayName}`, page: j.objectURL, license: 'Public domain (Met Open Access)', credit: strip(j.creditLine).slice(0, 200) };
}

async function fromCommons(w) {
  const queries = [].concat(w.commons || []);
  for (const query of queries) {
    const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '1', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600' });
    const j = await (await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA } })).json();
    await pause();
    const page = j.query && Object.values(j.query.pages)[0];
    const info = page && page.imageinfo && page.imageinfo[0];
    if (!info) continue;
    await download(info.thumburl || info.url, w.id);
    const meta = info.extmetadata || {};
    return { source: 'commons', query, file: page.title, page: info.descriptionurl, license: strip(meta.LicenseShortName && meta.LicenseShortName.value), credit: strip(meta.Credit && meta.Credit.value).slice(0, 200) };
  }
  return null;
}

for (const w of WORKS) {
  const has = await exists(`${w.id}.jpg`);
  const needMet = w.met && (credits[w.id] || {}).source !== 'met';
  if (has && !needMet) { report.push(`- ${w.id} ${w.title.en}: уже есть файл`); continue; }
  try {
    const c = (w.met && await fromMet(w)) || (!has && await fromCommons(w));
    if (!c) { report.push(`- ${w.id} ${w.title.en}: ${has ? 'уже есть файл (в Met нет открытого изображения)' : 'НЕ НАЙДЕНО — положите файл вручную'}`); continue; }
    credits[w.id] = c;
    report.push(`- ${w.id} ${w.title.en}: [${c.source}] ${c.file} — ${c.license} — ${c.page}`);
    await pause();
  } catch (e) { report.push(`- ${w.id} ${w.title.en}: ошибка ${e.message}`); }
}
await fs.writeFile(new URL('credits.json', dir), JSON.stringify(credits, null, 2));
await fs.writeFile(new URL('REPORT.md', dir), `# Изображения картин\n\nПроверьте каждую строку: та ли картина и подходит ли лицензия.\n\n${report.join('\n')}\n`);
console.log(report.join('\n'));
