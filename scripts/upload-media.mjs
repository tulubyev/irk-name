#!/usr/bin/env node
// Загрузка локальной папки media/ в S3-бакет (Beget). Идемпотентно: пропускает файлы,
// у которых совпадает sha256 (хранится в метаданных объекта).
//
//   node scripts/upload-media.mjs [--dry-run] [--dir media] [--prefix ""]
//
// Окружение: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (ключи — только из окружения!);
//            S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_FORCE_PATH_STYLE — по умолчанию бакет irk.name в Beget S3.
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname, sep } from 'node:path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const dir = opt('--dir', 'media');
const prefix = opt('--prefix', '');

const need = (n) => { const v = process.env[n]; if (!v) { console.error(`Не задана переменная ${n}`); process.exit(1); } return v; };
// Значения по умолчанию — наш бакет в Beget S3 (не секрет); переопределяются через окружение
const bucket = process.env.S3_BUCKET || '0a011f8d633a-irk-name';
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud',
  region: process.env.S3_REGION || 'ru1',
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  credentials: dryRun && !process.env.S3_ACCESS_KEY_ID ? { accessKeyId: 'dry', secretAccessKey: 'dry' }
    : { accessKeyId: need('S3_ACCESS_KEY_ID'), secretAccessKey: need('S3_SECRET_ACCESS_KEY') },
});

const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
const HASHED = /-[0-9a-f]{8,}\.[a-z0-9]+$/;

async function* walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p); else if (e.isFile()) yield p;
  }
}

let up = 0, skip = 0;
for await (const file of walk(dir)) {
  const key = prefix + relative(dir, file).split(sep).join('/');
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) { console.warn(`пропуск (неизвестный тип): ${key}`); continue; }
  const body = await readFile(file);
  const sha = createHash('sha256').update(body).digest('hex');
  let same = false;
  if (!dryRun || process.env.S3_ACCESS_KEY_ID) {
    try { same = (await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).Metadata?.sha256 === sha; } catch { /* нет объекта */ }
  }
  if (same) { skip++; console.log(`= ${key}`); continue; }
  const cache = HASHED.test(key) ? 'public, max-age=31536000, immutable' : 'public, max-age=86400';
  console.log(`${dryRun ? '[dry-run] ' : ''}+ ${key} (${type}, ${cache})`);
  if (!dryRun) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type, CacheControl: cache, ACL: 'public-read', Metadata: { sha256: sha } }));
  }
  up++;
}
console.log(`Готово: загружено ${up}, без изменений ${skip}${dryRun ? ' (dry-run)' : ''}`);
