#!/usr/bin/env node
// Автопоиск портретов для записей, которых ещё нет в data/commons-photos.json. Запускается на сервере.
// Ищет персону в Wikidata по имени, берёт свойство «изображение» (P18 — файл на Wikimedia Commons)
// и принимает кандидата, только если это человек (P31 = Q5) и совпадают годы жизни.
//
//   node scripts/discover-photos.mjs           # только отчёт: data/commons-photos.candidates.json
//   node scripts/discover-photos.mjs --write   # дописать надёжные находки в data/commons-photos.json
//   node scripts/discover-photos.mjs --only a,b
//
// Дальше — как обычно: node scripts/fetch-commons.mjs (проверит лицензию и скачает), см. DEPLOY.md.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER_AGENT } from './fetch-commons.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WD_API = 'https://www.wikidata.org/w/api.php';

// ---------- чистые функции (покрыты тестом) ----------

/** Минимальный разбор нужных полей фронтматтера записи. */
export function readRecord(md) {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const field = (k) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim();
  const unquote = (s) => (s ?? '').replace(/^["']|["']$/g, '');
  const int = (s) => (s && /^-?\d+$/.test(s) ? Number(s) : undefined);
  return {
    name: unquote(field('name')),
    birthYear: int(field('birthYear')),
    deathYear: int(field('deathYear')),
    archived: field('archived') === 'true',
    hasPhoto: /^photo:/m.test(fm),
  };
}

/** Имя для поиска: без уточнений в скобках и после запятой («Аввакум Петров, протопоп» → «Аввакум Петров»). */
export function searchName(name) {
  return name.replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim();
}

/** Год из значения времени Wikidata: «+1837-00-00T00:00:00Z» → 1837, «-0050-…» → -50. */
export function wdYear(claims, prop) {
  const t = claims?.[prop]?.[0]?.mainsnak?.datavalue?.value?.time;
  const m = typeof t === 'string' && t.match(/^([+-])(\d+)-/);
  return m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) : undefined;
}

const near = (a, b) => a === undefined || b === undefined || Math.abs(a - b) <= 1;

/**
 * Выбор кандидата из сущностей Wikidata. Надёжный (`high`) — человек с P18, у записи есть год рождения
 * и он совпадает (±1), год смерти не противоречит. Без годов у записи — только `low` (в манифест не пишется).
 */
export function pickCandidate(entities, record) {
  const out = [];
  for (const e of entities) {
    const c = e?.claims ?? {};
    const human = (c.P31 ?? []).some((s) => s?.mainsnak?.datavalue?.value?.id === 'Q5');
    const file = c.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!human || typeof file !== 'string') continue;
    const born = wdYear(c, 'P569');
    const died = wdYear(c, 'P570');
    if (!near(record.birthYear, born) || !near(record.deathYear, died)) continue;
    const confirmed = record.birthYear !== undefined && born !== undefined;
    out.push({
      qid: e.id,
      label: e.labels?.ru?.value ?? e.labels?.en?.value ?? '',
      description: e.descriptions?.ru?.value ?? e.descriptions?.en?.value ?? '',
      file: `File:${file}`,
      born, died,
      confidence: confirmed ? 'high' : 'low',
    });
  }
  // при нескольких подходящих — неоднозначно, автоматически не берём
  if (out.length > 1) out.forEach((x) => { x.confidence = 'low'; });
  return out;
}

// ---------- сеть ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(params, fetchImpl = fetch) {
  for (let i = 1; ; i++) {
    const res = await fetchImpl(`${WD_API}?${new URLSearchParams({ format: 'json', maxlag: '5', ...params })}`, {
      headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT },
    });
    if (res.ok) {
      const json = await res.json();
      if (json.error?.code === 'maxlag' && i < 4) { await sleep(5000); continue; }
      if (json.error) throw new Error(`Wikidata: ${json.error.code} ${json.error.info}`);
      return json;
    }
    if ((res.status === 429 || res.status >= 500) && i < 4) { await sleep(2000 * 2 ** i); continue; }
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function discoverOne(record, { fetchImpl = fetch, delay = 300 } = {}) {
  const found = await wd({ action: 'wbsearchentities', search: searchName(record.name), language: 'ru', uselang: 'ru', type: 'item', limit: '7' }, fetchImpl);
  const ids = (found.search ?? []).map((s) => s.id).filter(Boolean);
  if (!ids.length) return [];
  await sleep(delay);
  const ents = await wd({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels|descriptions', languages: 'ru|en' }, fetchImpl);
  return pickCandidate(ids.map((id) => ents.entities?.[id]).filter(Boolean), record);
}

export async function discoverAll({ personsDir, manifest, only, fetchImpl = fetch, delay = 300, log = console.log }) {
  const known = new Set((manifest.persons ?? []).map((p) => p.slug));
  const files = (await readdir(personsDir)).filter((f) => f.endsWith('.md')).sort();
  const results = [];
  for (const f of files) {
    const slug = f.slice(0, -3);
    if (only && !only.has(slug)) continue;
    if (known.has(slug)) continue;
    const rec = readRecord(await readFile(join(personsDir, f), 'utf8'));
    if (rec.archived || rec.hasPhoto || !rec.name) continue; // живым и архивным фото не подбираем
    try {
      const cands = await discoverOne(rec, { fetchImpl, delay });
      const best = cands.length === 1 ? cands[0] : null;
      results.push({ slug, name: rec.name, birthYear: rec.birthYear, deathYear: rec.deathYear, candidates: cands });
      log(best ? `${best.confidence === 'high' ? '✓' : '?'} ${slug} → ${best.file} (${best.qid}, ${best.born ?? '?'}–${best.died ?? ''})`
        : cands.length ? `? ${slug}: несколько кандидатов (${cands.map((c) => c.qid).join(', ')})` : `· ${slug}: нет портрета в Wikidata`);
    } catch (e) {
      results.push({ slug, name: rec.name, error: e.message });
      log(`✗ ${slug}: ${e.message}`);
    }
    await sleep(delay);
  }
  return results;
}

/** Надёжные находки → записи манифеста. */
export function acceptHigh(results) {
  return results
    .filter((r) => r.candidates?.length === 1 && r.candidates[0].confidence === 'high')
    .map((r) => ({ slug: r.slug, file: r.candidates[0].file, alt: `Портрет: ${r.name}` }));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const only = opt('--only') ? new Set(opt('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const manifestPath = opt('--manifest') ?? join(ROOT, 'data/commons-photos.json');
  const reportPath = join(ROOT, 'data/commons-photos.candidates.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const results = await discoverAll({ personsDir: join(ROOT, 'src/content/persons'), manifest, only, delay: Number(process.env.WIKIDATA_DELAY_MS ?? 300) });
  await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n');
  const add = acceptHigh(results);
  const low = results.filter((r) => r.candidates?.length && !add.some((a) => a.slug === r.slug)).length;
  console.log(`\nНадёжно найдено: ${add.length}; требуют ручной проверки: ${low}; без портрета: ${results.filter((r) => r.candidates && !r.candidates.length).length}. Отчёт: data/commons-photos.candidates.json`);
  if (args.includes('--write') && add.length) {
    manifest.persons = [...(manifest.persons ?? []), ...add];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`--write: добавлено в data/commons-photos.json: ${add.length}. Дальше: node scripts/fetch-commons.mjs`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
