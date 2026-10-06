#!/usr/bin/env node
// Уведомление Яндекса (протокол IndexNow) об изменившихся страницах: новые страницы попадают в индекс быстрее.
// Отправляются только публичные адреса сайта. Ключ — публичный файл public/<ключ>.txt (так требует протокол).
//
//   node scripts/indexnow.mjs --from <sha> --to <sha>   # страницы персон, изменённые между коммитами (вызывает deploy.sh)
//   node scripts/indexnow.mjs --all                     # все адреса из карты сайта (первый запуск)
//   node scripts/indexnow.mjs --dry-run ...             # только показать, что будет отправлено
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HOST = 'irk.name';
export const SITE = `https://${HOST}`;
export const ENDPOINTS = ['https://yandex.com/indexnow'];

/** Ключ — единственный публичный файл вида <32 hex>.txt в public/. */
export function findKey(dir = join(ROOT, 'public')) {
  const f = readdirSync(dir).filter((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (f.length !== 1) throw new Error(`Нужен ровно один файл ключа IndexNow в public/ (найдено: ${f.length})`);
  return f[0].slice(0, -4);
}

/** Изменённые файлы git → адреса страниц. Записи персон → /persona/<slug>/, заодно главная и «Все имена». */
export function urlsFromChanges(files) {
  const urls = new Set();
  for (const f of files) {
    const m = f.match(/^src\/content\/persons\/([a-z0-9-]+)\.md$/);
    if (m) urls.add(`${SITE}/persona/${m[1]}/`);
  }
  if (urls.size) urls.add(`${SITE}/`);
  return [...urls];
}

export function urlsFromSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(SITE));
}

export async function submit(urlList, key, { fetchImpl = fetch, endpoints = ENDPOINTS, log = console.log } = {}) {
  let ok = 0;
  for (const endpoint of endpoints) {
    for (let i = 0; i < urlList.length; i += 9000) {
      const body = { host: HOST, key, keyLocation: `${SITE}/${key}.txt`, urlList: urlList.slice(i, i + 9000) };
      try {
        const res = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
        log(`${endpoint}: HTTP ${res.status} (${body.urlList.length} URL)`);
        if (res.status === 200 || res.status === 202) ok++;
      } catch (e) {
        log(`${endpoint}: ${e.message}`);
      }
    }
  }
  return ok;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const key = findKey();
  let urls;
  if (args.includes('--all')) {
    const idx = await (await fetch(`${SITE}/sitemap-index.xml`)).text();
    urls = [];
    for (const sm of urlsFromSitemap(idx)) urls.push(...urlsFromSitemap(await (await fetch(sm)).text()));
  } else if (opt('--from') && opt('--to')) {
    const files = execFileSync('git', ['diff', '--name-only', opt('--from'), opt('--to')], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    urls = urlsFromChanges(files);
  } else {
    console.error('Укажите --all или --from <sha> --to <sha>');
    process.exit(2);
  }
  if (!urls.length) return console.log('indexnow: нечего отправлять');
  if (args.includes('--dry-run')) return console.log(urls.join('\n') + `\n(${urls.length} URL, dry-run)`);
  const ok = await submit(urls, key);
  console.log(ok ? `indexnow: отправлено ${urls.length} URL` : 'indexnow: не удалось отправить (не критично)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`indexnow: ${e.message}`); process.exit(1); });
}
