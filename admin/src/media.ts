// Обработка и хранение фото персон: три WebP-размера (как у scripts/fetch-commons.mjs) и запись в локальное хранилище либо S3.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config';

const SIZES = [
  { suffix: '', width: 1200, quality: 80 },
  { suffix: '-640', width: 640, quality: 78 },
  { suffix: '-160', width: 160, quality: 75 },
] as const;
const FORMATS = new Set(['jpeg', 'png', 'webp', 'tiff']);

export interface ProcessedImage { key: string; files: { key: string; body: Buffer }[] }

/** Декодирует загруженный файл, учитывает поворот из EXIF и готовит три размера. Имя файла содержит хэш — кэш CDN не мешает правкам. */
export async function processImage(input: Buffer, slug: string): Promise<ProcessedImage> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Недопустимое имя персоны');
  const src = sharp(input, { failOn: 'none', limitInputPixels: 80_000_000 });
  const meta = await src.metadata();
  if (!meta.format || !FORMATS.has(meta.format)) throw new Error('поддерживаются JPEG, PNG, WebP и TIFF');
  if ((meta.width ?? 0) < 100 || (meta.height ?? 0) < 100) throw new Error('изображение слишком маленькое (меньше 100 px)');
  const img = src.rotate();
  const [full, mid, thumb] = await Promise.all(
    SIZES.map(({ width, quality }) => img.clone().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer()),
  );
  const hash = createHash('sha256').update(full).digest('hex').slice(0, 10);
  const key = `persons/${slug}-${hash}.webp`;
  const sized = (suffix: string) => key.replace(/\.webp$/, `${suffix}.webp`);
  return { key, files: [{ key, body: full }, { key: sized('-640'), body: mid }, { key: sized('-160'), body: thumb }] };
}

export interface MediaStore {
  put(key: string, body: Buffer): Promise<void>;
  describe(): string;
}

class S3Media implements MediaStore {
  private client: S3Client;
  constructor(private options: typeof config.s3) {
    this.client = new S3Client({
      endpoint: options.endpoint, region: options.region, forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }
  describe() { return `S3 ${this.options.bucket}`; }
  async put(key: string, body: Buffer) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket, Key: key, Body: body, ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable', ACL: 'public-read',
    }));
  }
}

class FsMedia implements MediaStore {
  constructor(private root: string) {}
  describe() { return 'локальное хранилище'; }
  async put(key: string, body: Buffer) {
    if (!/^persons\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/.test(key)) {
      throw new Error('Недопустимый ключ фотографии');
    }
    const file = join(this.root, key);
    const dir = dirname(file);
    await mkdir(dir, { recursive: true });
    if ((await lstat(dir)).isSymbolicLink()) throw new Error('Каталог фотографий не должен быть символической ссылкой');
    const temp = join(dir, `.upload-${randomUUID()}`);
    try {
      await writeFile(temp, body, { flag: 'wx', mode: 0o644 });
      await rename(temp, file);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
}

/** auto сохраняет прежний выбор: S3 при наличии ключей, fs только для локальных карточек. */
export function createMediaStore(options: typeof config = config): MediaStore | null {
  const hasS3 = Boolean(options.s3.accessKeyId && options.s3.secretAccessKey);
  switch (options.mediaStore) {
    case 'off': return null;
    case 'fs': return new FsMedia(options.mediaRoot);
    case 's3':
      if (!hasS3) throw new Error('Для ADMIN_MEDIA_STORE=s3 нужны ключи S3');
      return new S3Media(options.s3);
    case 'auto':
      return hasS3 ? new S3Media(options.s3) : options.store === 'fs' ? new FsMedia(options.mediaRoot) : null;
    default: throw new Error('ADMIN_MEDIA_STORE: допустимы auto, fs, s3, off');
  }
}

export const media = createMediaStore();

export const mediaUrl = (key: string) => `${config.cdnUrl}/${key}`;
export const sizedKey = (key: string, suffix: string) => key.replace(/\.webp$/, `${suffix}.webp`);
