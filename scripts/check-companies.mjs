#!/usr/bin/env node
// Проверка компаний по официальному ЕГРЮЛ (egrul.nalog.ru): полное название, ИНН, ОГРН, руководитель, дата регистрации,
// статус и (по флагу --founders) сведения об учредителях из выписки. Запускается на сервере или компьютере с российским адресом.
// Только чтение публичных данных. Капчу не обходит: если сервис просит капчу, скрипт останавливается.
//
//   node scripts/check-companies.mjs                  # все строки из data/companies.txt
//   node scripts/check-companies.mjs --inn 3808170320 # одна компания по ИНН
//   node scripts/check-companies.mjs --founders       # ещё и учредители (нужен pdftotext: apt install poppler-utils)
//   node scripts/check-companies.mjs --region 38      # регион для поиска по названию (по умолчанию 38 — Иркутская область; 0 — без региона)
//
// Результат: gov-out/companies.txt (читаемый отчёт) и gov-out/companies.json. Пришлите companies.txt в чат.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'gov-out');
const BASE = 'https://egrul.nalog.ru';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAUSE_MS = 2500;

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const wantFounders = args.includes('--founders');
const region = opt('--region', '38');
const oneInn = opt('--inn', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- чистые функции (покрыты тестом) ----------

/** Строки data/companies.txt: «Название | ИНН | Для кого». */
export function parseList(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [name = '', inn = '', who = ''] = l.split('|').map((s) => s.trim());
    return { name, inn: inn.replace(/\D/g, ''), who };
  });
}

/** Разбор строки ответа ЕГРЮЛ в понятные поля. */
export function parseRow(r) {
  return {
    name: r.n || r.c || '',
    shortName: r.c || '',
    inn: r.i || '',
    ogrn: r.o || '',
    director: r.g || '',
    registered: r.r || '',
    terminated: r.e || '',
    status: r.e ? 'прекращена ' + r.e : 'действует',
    address: r.a || '',
    kind: r.k || '',
    token: r.t || '',
  };
}

/** Из текста выписки берём раздел об учредителях; номера ИНН физических лиц (12 цифр) вырезаем. */
export function foundersFromText(text) {
  const i = text.search(/Сведения об учредителях \(участниках\)/i);
  if (i < 0) return '';
  const rest = text.slice(i, i + 4000);
  const end = rest.search(/Сведения о лице, имеющем право|Сведения о держателе реестра|Сведения об участниках\/учредителях|Сведения о видах экономической деятельности/i);
  return (end > 0 ? rest.slice(0, end) : rest.slice(0, 1800))
    .replace(/\b\d{12}\b/g, '[ИНН физлица скрыт]')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// ---------- запросы ----------

async function post(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json' }, body: new URLSearchParams(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
async function get(path, asBuffer = false) {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept': '*/*' } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return asBuffer ? Buffer.from(await res.arrayBuffer()) : res.json();
}

async function search(query, reg) {
  const t = await post('/', { vyp3CaptchaToken: '', page: '', query, region: reg && reg !== '0' ? reg : '', PreventChromeAutocomplete: '' });
  if (t.captchaRequired) throw new Error('сервис запросил капчу — остановка; повторите позже или проверьте компанию на сайте вручную');
  if (!t.t) throw new Error('нет токена поиска');
  for (let i = 0; i < 6; i++) {
    await sleep(800);
    const r = await get(`/search-result/${t.t}?r=${Date.now()}&_=${Date.now()}`);
    if (r.rows) return r.rows.map(parseRow).slice(0, 5);
  }
  return [];
}

async function founders(token) {
  await get(`/vyp-request/${token}?r=${Date.now()}&_=${Date.now()}`);
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const s = await get(`/vyp-status/${token}?r=${Date.now()}&_=${Date.now()}`);
    if (s.status === 'ready') {
      const pdf = await get(`/vyp-download/${token}`, true);
      const f = join(OUT, `vyp-${token.slice(0, 8)}.pdf`);
      await writeFile(f, pdf);
      try {
        const { stdout } = await run('pdftotext', ['-layout', f, '-']);
        return foundersFromText(stdout);
      } catch { return '(не удалось извлечь текст: установите pdftotext — apt install poppler-utils)'; }
    }
  }
  return '(выписка не готова за 30 с)';
}

// ---------- запуск ----------

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(OUT, { recursive: true });
  const items = oneInn ? [{ name: '', inn: oneInn, who: '' }] : parseList(await readFile(join(ROOT, 'data/companies.txt'), 'utf8'));
  const report = []; const json = [];
  for (const it of items) {
    const q = it.inn || it.name;
    console.log(`→ ${q}`);
    let rows = [];
    try { rows = await search(q, it.inn ? '' : region); } catch (e) { report.push(`== ${it.name || it.inn}${it.who ? ` (${it.who})` : ''}\n  ошибка: ${e.message}`); json.push({ ...it, error: e.message }); if (/капч/.test(e.message)) break; await sleep(PAUSE_MS); continue; }
    const lines = [`== ${it.name || it.inn}${it.who ? ` (${it.who})` : ''}`];
    if (!rows.length) lines.push('  (в ЕГРЮЛ не найдено)');
    for (const [i, r] of rows.entries()) {
      lines.push(`  ${i + 1}. ${r.name} · ИНН ${r.inn} · ОГРН ${r.ogrn} · ${r.status} · зарегистрирована ${r.registered}`);
      if (r.director) lines.push(`     руководитель: ${r.director}`);
      if (r.address) lines.push(`     адрес: ${r.address}`);
      if (wantFounders && i === 0 && r.token && r.kind !== 'fl') {
        try { const f = await founders(r.token); if (f) lines.push('     учредители:\n' + f.split('\n').map((s) => '       ' + s).join('\n')); } catch (e) { lines.push(`     учредители: ошибка (${e.message})`); }
      }
    }
    report.push(lines.join('\n')); json.push({ ...it, rows: rows.map(({ token, ...r }) => r) });
    await sleep(PAUSE_MS);
  }
  await writeFile(join(OUT, 'companies.txt'), report.join('\n\n') + '\n');
  await writeFile(join(OUT, 'companies.json'), JSON.stringify(json, null, 2));
  console.log(`Готово. Пришлите файл gov-out/companies.txt (компаний: ${items.length}).`);
}
