#!/usr/bin/env node
// Фото персон и гербы с Wikimedia Commons. Запускается на сервере (нужен доступ к Commons).
//
//   node scripts/fetch-commons.mjs            # метаданные + скачивание в media/, пишет lock-файл
//   node scripts/fetch-commons.mjs --dry-run  # только метаданные и проверка лицензий, без скачивания
//   node scripts/fetch-commons.mjs --force    # перекачать даже неизменённые файлы
//   node scripts/fetch-commons.mjs --apply    # дописать photo во фронтматтер по lock-файлу
//   node scripts/fetch-commons.mjs --only a,b # ограничиться этими slug (и ключами гербов)
//
// Вход:  data/commons-photos.json — { persons: [{ slug, file, alt }], heraldry: [{ key, file, alt }] }
// Выход: media/persons/<slug>.webp (≤1200 px) + <slug>-640.webp, media/heraldry/<key>.svg|webp,
//        data/commons-photos.lock.json — автор, лицензия, ссылки (из API Commons, не вручную).
// Повторный запуск ничего не перекачивает, если файл на Commons не изменился (sha1).
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://commons.wikimedia.org/w/api.php';
// https://meta.wikimedia.org/wiki/User-Agent_policy — имя/версия + контакт
export const USER_AGENT = `irk-name-media/1.0 (https://irk.name; https://github.com/tulubyev/irk-name${process.env.COMMONS_CONTACT ? `; ${process.env.COMMONS_CONTACT}` : ''}) node/${process.versions.node}`;
// Стандартные ширины миниатюр Wikimedia (нестандартные могут отдавать 429)
const THUMB_PERSON = 1280;
const THUMB_HERALDRY = 500;
const MAX_WIDTH = 1200;
const SMALL_WIDTH = 640;
const HERALDRY_HEIGHT = 128;

// ---------- чистые функции (покрыты тестом) ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Текст без HTML: теги убраны, сущности раскрыты, пробелы схлопнуты. */
export function stripHtml(html = '') {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Свободная ли лицензия: Public domain, PD-*, CC0, CC BY *, CC BY-SA *.
 * NC/ND, GFDL-only, «Attribution», fair use и всё непонятное — нет.
 */
export function isFreeLicense(shortName) {
  const s = String(shortName ?? '').trim().toLowerCase();
  if (!s) return false;
  if (s === 'public domain' || /^pd(-|$)/.test(s)) return true;
  if (/^cc0(\s+1\.0)?$/.test(s)) return true;
  if (/\b(nc|nd)\b/.test(s)) return false;
  return /^cc[ -]by(-sa)?(\s+\d(\.\d)?)?(\s+[a-z]{2,}(-[a-z]+)?)?$/.test(s);
}

const httpsUrl = (u) => {
  if (!u) return undefined;
  const s = String(u).trim().replace(/^\/\//, 'https://').replace(/^http:\/\//, 'https://');
  try { return new URL(s).href; } catch { return undefined; }
};

/** Разбор imageinfo[0] одной страницы ответа API → нормализованные метаданные. */
export function parseImageInfo(info) {
  const m = info?.extmetadata ?? {};
  const v = (k) => (m[k]?.value == null ? '' : String(m[k].value));
  const license = stripHtml(v('LicenseShortName')) || stripHtml(v('UsageTerms'));
  const author = stripHtml(v('Artist')) || stripHtml(v('Credit')) || 'Автор неизвестен';
  const nonFree = /^(true|1)$/i.test(v('NonFree').trim());
  return {
    author: author.length > 200 ? `${author.slice(0, 197)}…` : author,
    license,
    licenseUrl: httpsUrl(stripHtml(v('LicenseUrl'))),
    description: stripHtml(v('ImageDescription')).slice(0, 300),
    sourceUrl: httpsUrl(info?.descriptionurl),
    url: info?.url,
    thumbUrl: info?.thumburl,
    mime: info?.mime,
    sha1: info?.sha1,
    free: !nonFree && isFreeLicense(license),
  };
}

const normTitle = (t) => {
  const s = String(t).trim().replace(/_/g, ' ').replace(/^(file|image|файл):/i, '');
  return `File:${s.charAt(0).toUpperCase()}${s.slice(1)}`;
};

/** Ответ API (formatversion=2) → Map: запрошенное имя файла → страница. */
export function mapPages(requested, json) {
  const q = json?.query ?? {};
  const alias = new Map();
  for (const n of [...(q.normalized ?? []), ...(q.redirects ?? [])]) alias.set(n.from, n.to);
  const byTitle = new Map((q.pages ?? []).map((p) => [p.title, p]));
  const out = new Map();
  for (const r of requested) {
    let t = normTitle(r);
    for (let i = 0; i < 3 && !byTitle.has(t) && alias.has(t); i++) t = alias.get(t);
    if (!byTitle.has(t) && alias.has(r)) t = alias.get(r);
    out.set(r, byTitle.get(t));
  }
  return out;
}

const YAML_KEY = /^[A-Za-z_][\w-]*\s*:/;
const q = (s) => JSON.stringify(String(s)); // JSON-строка — валидный YAML double-quoted scalar

/** YAML-блок photo для фронтматтера. */
export function photoBlock(p) {
  return [
    'photo:',
    `  key: ${q(p.key)}`,
    `  alt: ${q(p.alt)}`,
    `  author: ${q(p.author)}`,
    `  license: ${q(p.license)}`,
    ...(p.licenseUrl ? [`  licenseUrl: ${q(p.licenseUrl)}`] : []),
    `  sourceUrl: ${q(p.sourceUrl)}`,
  ].join('\n');
}

/**
 * Вставляет/заменяет верхнеуровневый блок photo во фронтматтере Markdown.
 * Остальные строки YAML не трогаются; новый блок ставится перед sources: (или в конец).
 * Возвращает { text, changed, existing } — existing: sourceUrl уже стоявшего фото.
 */
export function setPhotoInFrontmatter(md, photo) {
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('нет фронтматтера');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('фронтматтер не закрыт');
  const fm = lines.slice(1, end);

  let existing;
  let start = fm.findIndex((l) => /^photo\s*:/.test(l));
  if (start >= 0) {
    let stop = start + 1;
    while (stop < fm.length && !YAML_KEY.test(fm[stop])) stop++;
    const old = fm.slice(start, stop);
    existing = old.map((l) => l.match(/^\s+sourceUrl:\s*["']?([^"'\s]+)/)?.[1]).find(Boolean) ?? '';
    // хвостовые пустые строки/комментарии оставляем на месте
    while (stop > start + 1 && /^\s*(#.*)?$/.test(fm[stop - 1])) stop--;
    fm.splice(start, stop - start);
  } else {
    start = fm.findIndex((l) => /^sources\s*:/.test(l));
    if (start < 0) start = fm.length;
  }
  fm.splice(start, 0, ...photoBlock(photo).split('\n'));
  const text = ['---', ...fm, ...lines.slice(end)].join(eol);
  return { text, changed: text !== md, existing };
}

// ---------- сеть и файлы ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, { tries = 4 } = {}) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && i < tries) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** i;
      console.warn(`  ${res.status}, повтор через ${Math.round(wait / 1000)} с`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status} ${url}`);
  }
}

async function queryInfo(files, width) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const chunk = files.slice(i, i + 50);
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', redirects: '1', prop: 'imageinfo',
      iiprop: 'url|extmetadata|mime|sha1', iiurlwidth: String(width), iiextmetadatalanguage: 'ru',
      titles: chunk.join('|'), maxlag: '5',
    });
    const json = await (await http(`${API}?${params}`)).json();
    if (json.error) throw new Error(`Commons API: ${json.error.code} ${json.error.info}`);
    for (const [k, p] of mapPages(chunk, json)) out.set(k, p);
  }
  return out;
}

const exists = (p) => access(p).then(() => true, () => false);
const readJson = async (p, def) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return def; throw e; } };

async function download(url) {
  await sleep(Number(process.env.COMMONS_DELAY_MS ?? 500)); // вежливо к серверам Wikimedia
  return Buffer.from(await (await http(url)).arrayBuffer());
}

async function savePerson(sharp, buf, mediaDir, slug) {
  const dir = join(mediaDir, 'persons');
  await mkdir(dir, { recursive: true });
  const img = sharp(buf, { failOn: 'none' }).rotate();
  await img.clone().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(dir, `${slug}.webp`));
  await img.clone().resize({ width: SMALL_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toFile(join(dir, `${slug}-640.webp`));
}

async function saveHeraldry(sharp, info, mediaDir, key) {
  const dir = join(mediaDir, 'heraldry');
  await mkdir(dir, { recursive: true });
  const isSvg = info.mime === 'image/svg+xml';
  if (isSvg) await writeFile(join(dir, `${key}.svg`), await download(info.url));
  // растр для сайта: svg Commons отдаёт как png-миниатюру
  const raster = await download(info.thumbUrl ?? info.url);
  await sharp(raster, { failOn: 'none' }).resize({ height: HERALDRY_HEIGHT, withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toFile(join(dir, `${key}.webp`));
  return isSvg;
}

// ---------- команды ----------

export async function fetchAll({ manifest, lockPath, mediaDir, dryRun, force, only }) {
  const lock = await readJson(lockPath, { persons: {}, heraldry: {} });
  lock.persons ??= {}; lock.heraldry ??= {};
  const pick = (id) => !only || only.has(id);
  const persons = (manifest.persons ?? []).filter((p) => pick(p.slug));
  const heraldry = (manifest.heraldry ?? []).filter((h) => pick(h.key));
  const sharp = dryRun ? null : (await import('sharp')).default;
  const rejected = [];
  const stats = { ok: 0, downloaded: 0, unchanged: 0, rejected: 0, missing: 0, failed: 0 };

  const groups = [
    { kind: 'persons', items: persons, id: (x) => x.slug, width: THUMB_PERSON },
    { kind: 'heraldry', items: heraldry, id: (x) => x.key, width: THUMB_HERALDRY },
  ];
  for (const g of groups) {
    if (!g.items.length) continue;
    console.log(`\n== ${g.kind}: ${g.items.length} файл(ов), запрос метаданных…`);
    const pages = await queryInfo([...new Set(g.items.map((x) => x.file))], g.width);
    for (const item of g.items) {
      const id = g.id(item);
      const page = pages.get(item.file);
      const prev = lock[g.kind][id];
      if (!page || page.missing || !page.imageinfo?.length) {
        stats.missing++;
        console.log(`✗ ${id}: файл не найден на Commons — ${item.file}`);
        delete lock[g.kind][id];
        continue;
      }
      const meta = parseImageInfo(page.imageinfo[0]);
      if (!meta.free) {
        stats.rejected++;
        rejected.push({ id, file: item.file, license: meta.license || '(нет)' });
        console.log(`✗ ${id}: лицензия не из белого списка — «${meta.license || 'нет'}» (${item.file})`);
        delete lock[g.kind][id];
        continue;
      }
      const entry = {
        file: page.title,
        ...(g.kind === 'persons' ? { key: `persons/${id}.webp` } : { key: `heraldry/${id}.webp` }),
        alt: item.alt,
        author: meta.author,
        license: meta.license,
        ...(meta.licenseUrl ? { licenseUrl: meta.licenseUrl } : {}),
        sourceUrl: meta.sourceUrl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        sha1: meta.sha1,
        ...(meta.description ? { description: meta.description } : {}),
      };
      const outs = g.kind === 'persons'
        ? [join(mediaDir, 'persons', `${id}.webp`), join(mediaDir, 'persons', `${id}-640.webp`)]
        : [join(mediaDir, 'heraldry', `${id}.webp`)];
      const same = prev && prev.sha1 === meta.sha1 && prev.file === page.title;
      if (dryRun) {
        console.log(`✓ ${id}: ${entry.license} · ${entry.author} [dry-run]`);
      } else if (!force && same && (await Promise.all(outs.map(exists))).every(Boolean)) {
        stats.unchanged++;
        console.log(`= ${id}: без изменений`);
      } else {
        try {
          if (g.kind === 'persons') await savePerson(sharp, await download(meta.thumbUrl ?? meta.url), mediaDir, id);
          else entry.svg = await saveHeraldry(sharp, { ...meta }, mediaDir, id);
          stats.downloaded++;
          console.log(`↓ ${id}: ${entry.license} · ${entry.author}`);
        } catch (e) {
          stats.failed++;
          console.log(`✗ ${id}: ошибка скачивания — ${e.message}`);
          continue;
        }
      }
      if (g.kind === 'heraldry' && entry.svg === undefined && prev?.svg !== undefined) entry.svg = prev.svg;
      lock[g.kind][id] = entry;
      stats.ok++;
    }
  }

  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const out = { generatedBy: 'scripts/fetch-commons.mjs', persons: sorted(lock.persons), heraldry: sorted(lock.heraldry) };
  if (!dryRun) await writeFile(lockPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nИтого: годных ${stats.ok} (скачано ${stats.downloaded}, без изменений ${stats.unchanged}), ` +
    `несвободная лицензия ${stats.rejected}, не найдено ${stats.missing}, ошибок ${stats.failed}.`);
  if (rejected.length) {
    console.log('\nПропущены из-за лицензии:');
    for (const r of rejected) console.log(`  - ${r.id}: ${r.file} — ${r.license}`);
  }
  if (!dryRun) console.log(`Lock-файл: ${lockPath}`);
  return stats;
}

export async function applyAll({ lockPath, personsDir, mediaDir, force, only }) {
  const lock = await readJson(lockPath, null);
  if (!lock) throw new Error(`нет ${lockPath} — сначала запустите без --apply`);
  let changed = 0, same = 0, skipped = 0;
  for (const [slug, e] of Object.entries(lock.persons ?? {})) {
    if (only && !only.has(slug)) continue;
    const path = join(personsDir, `${slug}.md`);
    if (!(await exists(path))) { skipped++; console.log(`✗ ${slug}: нет файла записи`); continue; }
    if (!(await exists(join(mediaDir, e.key)))) console.warn(`! ${slug}: нет ${join(mediaDir, e.key)} локально — убедитесь, что файл загружен в бакет`);
    const md = await readFile(path, 'utf8');
    const res = setPhotoInFrontmatter(md, e);
    if (res.existing && res.existing !== e.sourceUrl && !force) {
      skipped++;
      console.log(`! ${slug}: уже есть другое фото (${res.existing}) — пропуск (--force, чтобы заменить)`);
      continue;
    }
    if (!res.changed) { same++; continue; }
    await writeFile(path, res.text);
    changed++;
    console.log(`✎ ${slug}`);
  }
  console.log(`\n--apply: изменено ${changed}, без изменений ${same}, пропущено ${skipped}.`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const only = opt('--only') ? new Set(opt('--only').split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const paths = {
    manifestPath: opt('--manifest') ?? join(ROOT, 'data/commons-photos.json'),
    lockPath: opt('--lock') ?? join(ROOT, 'data/commons-photos.lock.json'),
    mediaDir: opt('--media') ?? join(ROOT, 'media'),
    personsDir: join(ROOT, 'src/content/persons'),
  };
  const common = { ...paths, force: args.includes('--force'), only };
  if (args.includes('--apply')) return applyAll(common);
  const manifest = JSON.parse(await readFile(paths.manifestPath, 'utf8'));
  const stats = await fetchAll({ ...common, manifest, dryRun: args.includes('--dry-run') });
  if (stats.failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
