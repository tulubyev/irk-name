// Настройки берутся только из переменных окружения (на сервере — из .env, не из репозитория).
function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Хэш пароля: node hash-password.mjs (формат scrypt:N:r:p:соль:хэш)
  passwordHash: env('ADMIN_PASSWORD_HASH'),
  // Случайная строка ≥ 32 символов: openssl rand -hex 32
  sessionSecret: env('ADMIN_SESSION_SECRET'),
  // Разрешённый источник POST-запросов (защита от CSRF)
  origin: env('ADMIN_ORIGIN', 'https://irk.name'),
  cookieSecure: (process.env.ADMIN_COOKIE_SECURE ?? 'true') !== 'false',
  sessionHours: Number(process.env.ADMIN_SESSION_HOURS ?? 12),
  // Хранилище: github (рабочий режим) или fs (локальная разработка)
  store: (process.env.ADMIN_STORE ?? 'github') as 'github' | 'fs',
  fsRoot: process.env.ADMIN_FS_ROOT ?? '..',
  github: {
    token: process.env.GITHUB_TOKEN ?? '',
    repo: process.env.GITHUB_REPO ?? 'tulubyev/irk-name',
    branch: process.env.GITHUB_BRANCH ?? 'main',
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
  },
  siteUrl: process.env.SITE_URL ?? 'https://irk.name',
};

if (config.sessionSecret.length < 32) throw new Error('ADMIN_SESSION_SECRET должен быть не короче 32 символов');
if (config.store === 'github' && !config.github.token) throw new Error('Для ADMIN_STORE=github нужен GITHUB_TOKEN');
