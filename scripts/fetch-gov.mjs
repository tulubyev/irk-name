#!/usr/bin/env node
// Обход сайтов госорганов и компаний с российского сервера (многие из них не открываются с зарубежных адресов).
// Только чтение страниц (GET), без входа и без отправки данных. Ничего не устанавливает, нужен Node 18+.
//
//   node scripts/fetch-gov.mjs                      # обойти все сайты из списка SITES и собрать выжимку
//   node scripts/fetch-gov.mjs --only duma.gov.ru   # только один сайт
//   node scripts/fetch-gov.mjs --max 150            # не более 150 страниц на сайт (по умолчанию 250)
//   node scripts/fetch-gov.mjs --seed https://сайт/  # обойти произвольный сайт (проверка скрипта или новый источник)
//   node scripts/fetch-gov.mjs --digest-only        # только пересобрать выжимку из уже скачанного
//
// Результат: gov-out/digest.txt (выдержки вокруг имён из data/gov-names.txt) и gov-out/report.txt (что открылось, а что нет).
// Эти два файла (или архив gov-out/*.txt) пришлите в чат; сами страницы лежат в gov-out/pages/.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'gov-out');
const PAGES = join(OUT, 'pages');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 irk-name-research/1.0 (+https://irk.name)';
const DELAY_MS = 1500; // вежливая пауза между запросами к одному сайту
const TIMEOUT_MS = 20000;
const MAX_DEPTH = 3;

// Сайты и стартовые страницы. Обход идёт по ссылкам с теми же доменами, у которых в адресе или тексте ссылки есть ключевые слова.
const SITES = [
  { host: 'duma.gov.ru', seeds: ['https://duma.gov.ru/', 'https://duma.gov.ru/duma/persons/', 'https://duma.gov.ru/duma/deputies/'] },
  { host: 'council.gov.ru', seeds: ['https://council.gov.ru/', 'https://council.gov.ru/structure/members/', 'https://council.gov.ru/structure/persons/'] },
  { host: 'zsio.ru', seeds: ['https://zsio.ru/', 'https://www.zsio.ru/', 'https://zsio.ru/deputaty/'] },
  { host: 'irkobl.ru', seeds: ['https://irkobl.ru/', 'https://www.irkobl.ru/'] },
  { host: 'admirk.ru', seeds: ['https://admirk.ru/', 'https://www.admirk.ru/'] },
  { host: 'bratsk-city.ru', seeds: ['https://www.bratsk-city.ru/', 'https://bratsk-city.ru/'] },
  { host: 'angarsk-adm.ru', seeds: ['https://www.angarsk-adm.ru/'] },
  { host: 'government.ru', seeds: ['https://government.ru/'] },
  { host: 'kremlin.ru', seeds: ['https://www.kremlin.ru/', 'https://kremlin.ru/'] },
  { host: 'cikrf.ru', seeds: ['http://cikrf.ru/'] },
  { host: 'irkutsk.izbirkom.ru', seeds: ['http://irkutsk.izbirkom.ru/'] },
  { host: 'irkipedia.ru', seeds: ['https://irkipedia.ru/'] },
];
// ссылка интересна, если в адресе или в тексте есть одно из этих слов
const KEYWORDS = /депутат|сенатор|член[ыа]?\s+совета|персон|структур|биограф|мэр|глав[аыу]|минист|правител|администрац|руководств|deput|senat|person|member|structure|biograf|mayor|minist|leader|governor|head/i;

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', '');
const seed = opt('--seed', '');
const maxPages = parseInt(opt('--max', '250'), 10);
const digestOnly = args.includes('--digest-only');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

function decode(buf, contentType, head) {
  let cs = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (!cs) cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  cs = (cs || 'utf-8').toLowerCase();
  try { return new TextDecoder(cs === 'windows-1251' || cs === 'cp1251' ? 'windows-1251' : cs).decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—' };
function toText(html) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h\d|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { try { return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); } catch { return ' '; } }
      return entities[e.toLowerCase()] ?? ' ';
    })
    .replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
function linksOf(html, base) {
  const out = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push({ url: new URL(m[1], base).href, text: toText(m[2]).slice(0, 120) }); } catch {}
  }
  return out;
}

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'ru,en;q=0.5' }, signal: ctl.signal, redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) return { status: res.status, url: res.url };
    if (!/html|xml|text/i.test(ct)) return { status: res.status, url: res.url, skipped: ct };
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder('latin1').decode(buf.slice(0, 2000));
    return { status: res.status, url: res.url, html: decode(buf, ct, head) };
  } catch (e) {
    return { status: 0, url, error: e.cause?.code || e.name || String(e.message || e) };
  } finally { clearTimeout(t); }
}

async function robotsDisallow(origin) {
  const r = await get(origin + '/robots.txt');
  if (!r.html) return [];
  const lines = r.html.split(/\r?\n/);
  let star = false; const dis = [];
  for (const l of lines) {
    const mm = /^\s*user-agent:\s*(.*)$/i.exec(l);
    if (mm) { star = mm[1].trim() === '*'; continue; }
    const d = /^\s*disallow:\s*(\S+)/i.exec(l);
    if (star && d) dis.push(d[1]);
  }
  return dis;
}

async function crawl(site, report) {
  const hosts = new Set([site.host, 'www.' + site.host]);
  const seen = new Set(); const queue = site.seeds.map((u) => ({ url: u, depth: 0 }));
  const disallow = new Map();
  let saved = 0, fails = 0, first = true;
  while (queue.length && saved < maxPages) {
    const { url, depth } = queue.shift();
    const key = url.replace(/#.*$/, '');
    if (seen.has(key)) continue; seen.add(key);
    const u = new URL(key);
    if (!disallow.has(u.origin)) disallow.set(u.origin, await robotsDisallow(u.origin));
    if (disallow.get(u.origin).some((p) => p !== '/' ? u.pathname.startsWith(p) : false)) continue;
    const r = await get(key);
    await sleep(DELAY_MS);
    if (!r.html) {
      fails++;
      if (first || fails <= 3) report.push(`   ${key} → ${r.status || 'нет ответа'} ${r.error || r.skipped || ''}`);
      first = false;
      continue;
    }
    first = false;
    const text = toText(r.html);
    if (text.length > 200) {
      await writeFile(join(PAGES, `${site.host}_${hash(key)}.txt`), `URL: ${key}\n\n${text}\n`);
      saved++;
    }
    if (depth < MAX_DEPTH) {
      for (const l of linksOf(r.html, key)) {
        let lu; try { lu = new URL(l.url); } catch { continue; }
        if (!hosts.has(lu.hostname) || !/^https?:$/.test(lu.protocol)) continue;
        if (/\.(pdf|docx?|xlsx?|jpe?g|png|gif|zip|rar|mp4|mp3)(\?|$)/i.test(lu.pathname)) continue;
        if (KEYWORDS.test(lu.pathname + ' ' + l.text) && !seen.has(l.url)) queue.push({ url: l.url, depth: depth + 1 });
      }
    }
  }
  return { saved, fails };
}

async function buildDigest() {
  const names = (await readFile(join(ROOT, 'data/gov-names.txt'), 'utf8')).split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const files = (await readdir(PAGES).catch(() => [])).filter((f) => f.endsWith('.txt'));
  const pages = [];
  for (const f of files) pages.push(await readFile(join(PAGES, f), 'utf8'));
  const out = [];
  for (const n of names) {
    const parts = n.split(/\s+/);
    const surname = (parts.length > 1 ? parts.find((p) => /^[А-ЯЁ]/.test(p)) : parts[0]).replace(/[^А-Яа-яЁё-]/g, '');
    const stem = surname.length > 5 ? surname.slice(0, -1) : surname; // склонения: Буйнова, Буйнову
    const re = new RegExp(stem + '[а-яё]*', 'gi');
    const hits = [];
    for (const p of pages) {
      const url = /^URL: (.*)$/m.exec(p)?.[1] || '';
      let m; let c = 0;
      while ((m = re.exec(p)) && c < 3) {
        hits.push(`  [${url}] …${p.slice(Math.max(0, m.index - 160), m.index + 260).replace(/\s+/g, ' ')}…`);
        c++; re.lastIndex = m.index + 400;
      }
      if (hits.length >= 6) break;
    }
    out.push(`== ${n}\n${hits.length ? hits.join('\n') : '  (не найдено)'}`);
  }
  await writeFile(join(OUT, 'digest.txt'), out.join('\n\n') + '\n');
  return { names: names.length, pages: pages.length };
}

await mkdir(PAGES, { recursive: true });
const report = [`Запуск: ${new Date().toISOString()}`];
if (!digestOnly) {
  const sites = seed ? [{ host: new URL(seed).hostname.replace(/^www\./, ''), seeds: [seed] }] : SITES.filter((s) => !only || s.host === only);
  for (const site of sites) {
    console.log(`→ ${site.host}`);
    report.push(`\n${site.host}`);
    const { saved, fails } = await crawl(site, report);
    report.push(`   страниц сохранено: ${saved}, ошибок: ${fails}`);
    console.log(`  сохранено ${saved}, ошибок ${fails}`);
  }
}
const d = await buildDigest();
report.push(`\nВыжимка: имён ${d.names}, страниц в поиске ${d.pages}`);
await writeFile(join(OUT, 'report.txt'), report.join('\n') + '\n');
console.log(`Готово. Пришлите файлы gov-out/report.txt и gov-out/digest.txt (страниц обработано: ${d.pages}).`);
