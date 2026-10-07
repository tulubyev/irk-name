// Обработка и хранение фото персон: три WebP-размера (как у scripts/fetch-commons.mjs) и загрузка в S3.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
  private client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  });
  describe() { return `S3 ${config.s3.bucket}`; }
  async put(key: string, body: Buffer) {
    await this.client.send(new PutObjectCommand({
      Bucket: config.s3.bucket, Key: key, Body: body, ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable', ACL: 'public-read',
    }));
  }
}

class FsMedia implements MediaStore {
  private root = join(config.fsRoot, 'media');
  describe() { return `локальная папка ${this.root}`; }
  async put(key: string, body: Buffer) {
    const file = join(this.root, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }
}

/** null — загрузка отключена (не заданы ключи S3 и режим не локальный). */
export const media: MediaStore | null =
  config.s3.accessKeyId && config.s3.secretAccessKey ? new S3Media() : config.store === 'fs' ? new FsMedia() : null;

export const mediaUrl = (key: string) => `${config.cdnUrl}/${key}`;
export const sizedKey = (key: string, suffix: string) => key.replace(/\.webp$/, `${suffix}.webp`);
