import * as z from 'zod/v4';
import YAML from 'yaml';
import { personSchema } from '../../src/lib/person-schema';
import { DISTRICTS } from '../../src/lib/taxonomy';

z.config(z.locales.ru());
export const schema = personSchema(z);
export type PersonData = z.infer<typeof schema>;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parse(content: string): { data: Record<string, unknown>; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: content };
  return { data: (YAML.parse(m[1]) ?? {}) as Record<string, unknown>, body: m[2].replace(/^\s*\n/, '') };
}

const ORDER = ['name', 'birthYear', 'deathYear', 'datesApproximate', 'spheres', 'era', 'summary', 'connection',
  'connectionNote', 'places', 'countries', 'photo', 'gallery', 'links', 'sources', 'status', 'archived'] as const;

/** Сериализует в Markdown с фронтматтером; значения по умолчанию (false, пустые списки) опускаются. */
export function serialize(data: PersonData, body: string): string {
  const out: Record<string, unknown> = {};
  for (const k of ORDER) {
    const v = (data as Record<string, unknown>)[k];
    if (v === undefined || v === '' || v === false) continue;
    if (Array.isArray(v) && v.length === 0 && k !== 'sources') continue;
    out[k] = v;
  }
  out.status = data.status;
  const yaml = YAML.stringify(out, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${body.trim()}\n`;
}

// ---- Форма ⇄ данные ----

type FormBody = Record<string, string | File | (string | File)[]>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(str).filter(Boolean);
const int = (v: unknown) => {
  const s = str(v);
  return s === '' ? undefined : /^-?\d+$/.test(s) ? Number(s) : NaN;
};
const num = (v: string | undefined) => (v === undefined || v.trim() === '' ? undefined : Number(v.trim().replace(',', '.')));

/** Места: одна строка — «Название | Населённый пункт | район | широта | долгота». */
export function placesToText(places: PersonData['places'] = []): string {
  return places.map((p) => [p.name, p.settlement ?? '', p.district ?? '', p.lat ?? '', p.lon ?? ''].join(' | ').replace(/( \| )+$/, '')).join('\n');
}
/** Источники и ссылки «Подробнее»: одна строка — «Название | URL». */
export function sourcesToText(sources: { title: string; url: string }[] = []): string {
  return sources.map((s) => `${s.title} | ${s.url}`).join('\n');
}
const textToLinks = (v: unknown) => str(v).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.lastIndexOf('|');
  return i === -1 ? { title: l, url: l } : { title: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
});

/** Сохраняет прежний порядок отмеченных значений, новые — в конец (чтобы правка не переставляла сферы). */
const keepOrder = (values: string[], prev: unknown) => {
  const old = Array.isArray(prev) ? (prev as string[]) : [];
  const rank = (v: string) => (old.includes(v) ? old.indexOf(v) : old.length + values.indexOf(v));
  return [...values].sort((a, b) => rank(a) - rank(b));
};

// ---- Фотографии ----

export interface Img { key: string; alt: string; caption?: string; author: string; license: string; licenseUrl?: string; sourceUrl?: string }
export type ImgRow = Img & { id: string };
export const NEW_SLOTS = [1, 2, 3];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const opt = (v: unknown) => str(v) || undefined;
const imgFields = (get: (name: string) => unknown): Img => ({
  key: str(get('key')), alt: str(get('alt')), caption: opt(get('caption')), author: str(get('author')),
  license: str(get('license')), licenseUrl: opt(get('licenseUrl')), sourceUrl: opt(get('sourceUrl')),
});

/** Фото записи в порядке «главное, затем галерея». */
export function imagesOf(data: Record<string, unknown>): Img[] {
  return [data.photo, ...((data.gallery as unknown[] | undefined) ?? [])].filter(Boolean) as Img[];
}

/** Главное фото и галерея из списка; главное — по id, иначе первое. */
export function arrangeImages(rows: ImgRow[], mainId: string): { photo: Img | undefined; gallery: Img[] } {
  const strip = ({ id: _id, ...img }: ImgRow): Img => JSON.parse(JSON.stringify(img));
  const main = rows.find((r) => r.id === mainId) ?? rows[0];
  return { photo: main ? strip(main) : undefined, gallery: rows.filter((r) => r !== main).map(strip) };
}

/** Строки уже загруженных фото из формы (с правками и отметкой «удалить»). */
export function existingRowsFromForm(f: FormBody): { rows: ImgRow[]; mainId: string } | null {
  if (f.img_count === undefined) return null;
  const n = Math.min(Number(str(f.img_count)) || 0, 200);
  const rows: ImgRow[] = [];
  for (let i = 0; i < n; i++) {
    if (str(f[`img_del_${i}`]) === 'on') continue;
    rows.push({ id: `i${i}`, ...imgFields((k) => f[`img_${k}_${i}`]) });
  }
  return { rows, mainId: str(f.main) };
}

/** Новые файлы из формы: до трёх, каждый со своими данными об авторе и лицензии. */
export function newUploadsFromForm(f: FormBody): { uploads: { id: string; file: File; meta: Omit<Img, 'key'> }[]; errors: string[] } {
  const uploads: { id: string; file: File; meta: Omit<Img, 'key'> }[] = [];
  const errors: string[] = [];
  for (const n of NEW_SLOTS) {
    const file = f[`new_file_${n}`];
    if (!(file instanceof File) || file.size === 0) continue;
    const { key: _key, ...meta } = imgFields((k) => f[`new_${k}_${n}`]);
    const miss = ([['alt', 'описание для скринридера'], ['author', 'автор'], ['license', 'лицензия или условия публикации']] as const).filter(([k]) => !meta[k]).map(([, l]) => l);
    if (miss.length) errors.push(`Новое фото ${n}: заполните — ${miss.join(', ')}`);
    else if (file.size > MAX_UPLOAD_BYTES) errors.push(`Новое фото ${n}: файл больше ${MAX_UPLOAD_BYTES / 1024 / 1024} МБ`);
    else uploads.push({ id: `n${n}`, file, meta });
  }
  return { uploads, errors };
}

export function fromForm(f: FormBody, existing: Record<string, unknown>): { data: Record<string, unknown>; body: string; rows: ImgRow[]; mainId: string } {
  const places = str(f.places).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, settlement, district, lat, lon] = l.split('|').map((x) => x.trim());
    return {
      name,
      ...(settlement ? { settlement } : {}),
      ...(district ? { district } : {}),
      ...(num(lat) !== undefined ? { lat: num(lat) } : {}),
      ...(num(lon) !== undefined ? { lon: num(lon) } : {}),
    };
  });
  const sources = textToLinks(f.sources);
  const fromRows = existingRowsFromForm(f);
  const rows: ImgRow[] = fromRows?.rows ?? imagesOf(existing).map((img, i) => ({ id: `i${i}`, ...img }));
  const mainId = fromRows?.mainId ?? '';
  const arranged = arrangeImages(rows, mainId);
  const images = { photo: arranged.photo, gallery: arranged.gallery };
  const data: Record<string, unknown> = {
    name: str(f.name),
    birthYear: int(f.birthYear),
    deathYear: int(f.deathYear),
    datesApproximate: f.datesApproximate === 'on',
    spheres: keepOrder(list(f.spheres), existing.spheres),
    era: str(f.era),
    summary: str(f.summary),
    connection: keepOrder(list(f.connection), existing.connection),
    connectionNote: str(f.connectionNote) || undefined,
    places,
    countries: str(f.countries).split(',').map((c) => c.trim()).filter(Boolean),
    ...images,
    links: textToLinks(f.links),
    sources,
    status: str(f.status),
    archived: f.archived === 'on',
  };
  return { data, body: typeof f.body === 'string' ? f.body.replace(/\r\n/g, '\n') : '', rows, mainId };
}

const LABELS: Record<string, string> = {
  name: 'Имя', birthYear: 'Год рождения', deathYear: 'Год смерти', spheres: 'Виды деятельности', era: 'Век',
  summary: 'Кратко', connection: 'Связь с регионом', connectionNote: 'Комментарий о связи', places: 'Места',
  sources: 'Источники', gallery: 'Фотографии', alt: 'описание фото', author: 'автор фото', license: 'лицензия', caption: 'подпись', links: 'Подробнее о жизни и деятельности', status: 'Проверка', photo: 'Фото', title: 'название', url: 'ссылка',
  countries: 'Страны за рубежом', settlement: 'населённый пункт', district: 'район', lat: 'широта', lon: 'долгота',
};
export function issuesToText(err: z.ZodError): string[] {
  return err.issues.map((i) => {
    const path = i.path.map((p) => (typeof p === 'number' ? `строка ${p + 1}` : LABELS[String(p)] ?? String(p))).join(', ');
    return `${path || 'Запись'}: ${i.message}`;
  });
}

export const districtKeys = Object.keys(DISTRICTS);
