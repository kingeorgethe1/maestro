// Скачивает изображения картин с Wikimedia Commons для тех работ, у которых ещё нет файла paintings/ID.jpg.
// Запускается автоматически в GitHub Actions при публикации. Можно и вручную: node scripts/fetch-images.mjs
// Результат: paintings/ID.jpg, paintings/credits.json (автор файла и лицензия) и paintings/REPORT.md для проверки.
// ВАЖНО: поиск автоматический — проверьте отчёт глазами и замените неверные картинки своими файлами.
import { WORKS } from '../assets/js/catalog.js';
import fs from 'node:fs/promises';

const UA = 'MAESTRO-catalog/1.0 (https://github.com; image fetch for an educational art project)';
const API = 'https://commons.wikimedia.org/w/api.php';
const dir = new URL('../paintings/', import.meta.url);
const exists = (p) => fs.access(new URL(p, dir)).then(() => true, () => false);
const credits = JSON.parse(await fs.readFile(new URL('credits.json', dir), 'utf8').catch(() => '{}'));
const report = [];

for (const w of WORKS) {
  if (await exists(`${w.id}.jpg`)) { report.push(`- ${w.id} ${w.title.en}: уже есть файл`); continue; }
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${w.commons} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '1', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600' });
  try {
    const r = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA } });
    const j = await r.json();
    const page = j.query && Object.values(j.query.pages)[0];
    const info = page && page.imageinfo && page.imageinfo[0];
    if (!info) { report.push(`- ${w.id} ${w.title.en}: НЕ НАЙДЕНО — положите файл вручную`); continue; }
    const img = await fetch(info.thumburl || info.url, { headers: { 'User-Agent': UA } });
    if (!img.ok) throw new Error('download ' + img.status);
    await fs.writeFile(new URL(`${w.id}.jpg`, dir), Buffer.from(await img.arrayBuffer()));
    const meta = info.extmetadata || {};
    const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
    credits[w.id] = { file: page.title, page: info.descriptionurl, license: strip(meta.LicenseShortName && meta.LicenseShortName.value), credit: strip(meta.Credit && meta.Credit.value).slice(0, 200) };
    report.push(`- ${w.id} ${w.title.en}: ${page.title} — ${credits[w.id].license} — ${info.descriptionurl}`);
    await new Promise((r2) => setTimeout(r2, 400)); // вежливо к API
  } catch (e) { report.push(`- ${w.id} ${w.title.en}: ошибка ${e.message}`); }
}
await fs.writeFile(new URL('credits.json', dir), JSON.stringify(credits, null, 2));
await fs.writeFile(new URL('REPORT.md', dir), `# Изображения картин\n\nПроверьте каждую строку: та ли картина и подходит ли лицензия.\n\n${report.join('\n')}\n`);
console.log(report.join('\n'));
