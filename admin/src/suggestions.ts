import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

// Предложения посетителей хранятся только на сервере (том docker), не в git и не во внешних сервисах.
export const SUGGESTIONS_DIR = process.env.SUGGESTIONS_DIR ?? '/data/suggestions';
// Срок хранения — как в политике обработки персональных данных (не более 1 года).
export const RETENTION_DAYS = 365;

export interface Suggestion {
  id: string;
  createdAt: string;
  personName: string;
  years: string;
  activity: string;
  place: string;
  about: string;
  sources: string;
  photo: string;
  senderName: string;
  senderEmail: string;
  consent: true;
}

const ID_RE = /^\d{13}-[a-f0-9]{8}$/;
export const isId = (id: string) => ID_RE.test(id);

// Поле: [заголовок для сообщений, максимальная длина, обязательное]
export const FIELDS = {
  personName: ['Имя персоны', 200, true],
  years: ['Годы жизни', 60, false],
  activity: ['Вид деятельности', 200, false],
  place: ['Населённый пункт, район', 200, false],
  about: ['Чем известен', 3000, true],
  sources: ['Источники', 3000, true],
  photo: ['Фото', 1000, false],
  senderName: ['Ваше имя', 100, false],
  senderEmail: ['E-mail', 200, false],
} as const satisfies Record<string, readonly [string, number, boolean]>;
type FieldKey = keyof typeof FIELDS;

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function validate(form: Record<string, unknown>): { ok: true; data: Omit<Suggestion, 'id' | 'createdAt'> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const out = {} as Record<FieldKey, string>;
  for (const [key, [label, max, required]] of Object.entries(FIELDS) as [FieldKey, (typeof FIELDS)[FieldKey]][]) {
    const raw = form[key];
    const v = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : '';
    if (required && !v) errors.push(`${label}: обязательное поле`);
    if (v.length > max) errors.push(`${label}: не длиннее ${max} символов`);
    out[key] = v;
  }
  if (out.senderEmail && !EMAIL_RE.test(out.senderEmail)) errors.push('E-mail: неверный формат');
  if (form.consent !== 'on' && form.consent !== 'yes') errors.push('Нужно согласие на обработку персональных данных');
  return errors.length ? { ok: false, errors } : { ok: true, data: { ...out, consent: true } };
}

export async function save(data: Omit<Suggestion, 'id' | 'createdAt'>): Promise<string> {
  await mkdir(SUGGESTIONS_DIR, { recursive: true });
  const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const record: Suggestion = { id, createdAt: new Date().toISOString(), ...data };
  const tmp = join(SUGGESTIONS_DIR, `.${id}.tmp`);
  await writeFile(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  await rename(tmp, join(SUGGESTIONS_DIR, `${id}.json`));
  return id;
}

async function ids(): Promise<string[]> {
  try {
    return (await readdir(SUGGESTIONS_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter(isId);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

export async function get(id: string): Promise<Suggestion | null> {
  if (!isId(id)) return null;
  try {
    return JSON.parse(await readFile(join(SUGGESTIONS_DIR, `${id}.json`), 'utf8')) as Suggestion;
  } catch {
    return null;
  }
}

/** Новые сверху. */
export async function list(): Promise<Suggestion[]> {
  const all = await Promise.all((await ids()).map(get));
  return all.filter((s): s is Suggestion => s !== null).sort((a, b) => b.id.localeCompare(a.id));
}

export async function remove(id: string): Promise<void> {
  if (!isId(id)) return;
  await rm(join(SUGGESTIONS_DIR, `${id}.json`), { force: true });
}

/** Удаляет предложения старше срока хранения. Возраст берётся из id (время создания в мс). */
export async function purgeExpired(now = Date.now()): Promise<number> {
  const limit = now - RETENTION_DAYS * 86_400_000;
  const old = (await ids()).filter((id) => Number(id.split('-')[0]) < limit);
  await Promise.all(old.map(remove));
  return old.length;
}
