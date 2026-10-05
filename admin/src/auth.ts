import { createHmac, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { config } from './config';

/** Формат: scrypt:N:r:p:<соль base64>:<хэш base64>. Двоеточия, а не «$», — чтобы docker compose не подставлял переменные. */
export function hashPassword(password: string, N = 16384, r = 8, p = 1): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join(':');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, saltB64, hashB64] = stored.split(':');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Ключ подписи зависит и от секрета, и от хэша пароля: смена пароля завершает все сессии.
const signingKey = () => createHmac('sha256', config.sessionSecret).update(config.passwordHash).digest();
const sign = (data: string) => createHmac('sha256', signingKey()).update(data).digest('base64url');

export const SESSION_COOKIE = 'irkadmin';

export function createSession(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + config.sessionHours * 3600_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

// Ограничение попыток входа: не более 5 неудач за 15 минут с одного IP.
const failures = new Map<string, { count: number; first: number }>();
const WINDOW = 15 * 60_000;
const LIMIT = 5;

export function isLocked(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW) {
    failures.delete(ip);
    return false;
  }
  return f.count >= LIMIT;
}

export function recordFailure(ip: string): void {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW) failures.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}

export function clearFailures(ip: string): void {
  failures.delete(ip);
}
