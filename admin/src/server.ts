import { Hono, type Context, type Next } from 'hono';
import { serve } from '@hono/node-server';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { config } from './config';
import { verifyPassword, createSession, verifySession, SESSION_COOKIE, isLocked, recordFailure, clearFailures } from './auth';
import { store, ConflictError } from './store';
import { schema, parse, serialize, fromForm, issuesToText, SLUG_RE } from './person';
import { loginPage, listPage, editPage, inboxPage, suggestionPage, type Row } from './views';
import * as suggestions from './suggestions';

// strict: false — /admin и /admin/ ведут на одну страницу
const app = new Hono({ strict: false }).basePath('/admin');

// Заголовки безопасности: не индексировать, без встраивания, без внешних скриптов.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Cache-Control', 'no-store');
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
});

app.get('/healthz', (c) => c.text('ok'));

const clientIp = (c: Context) => (c.req.header('x-forwarded-for')?.split(',')[0] ?? c.req.header('x-real-ip') ?? 'local').trim();

// Защита от CSRF: любой POST должен прийти с нашего же источника.
app.use('*', async (c, next) => {
  if (c.req.method === 'POST') {
    const origin = c.req.header('origin') ?? (c.req.header('referer') ? new URL(c.req.header('referer')!).origin : '');
    if (origin !== config.origin) return c.text('Запрос отклонён (неверный источник)', 403);
  }
  await next();
});

const cookieOpts = {
  path: '/admin',
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'Strict' as const,
  maxAge: config.sessionHours * 3600,
};

app.get('/login', (c) => c.html(loginPage()));
app.post('/login', async (c) => {
  const ip = clientIp(c);
  if (isLocked(ip)) return c.html(loginPage('Слишком много попыток. Попробуйте через 15 минут.'), 429);
  const { password } = await c.req.parseBody();
  if (typeof password === 'string' && verifyPassword(password, config.passwordHash)) {
    clearFailures(ip);
    setCookie(c, SESSION_COOKIE, createSession(), cookieOpts);
    return c.redirect('/admin/');
  }
  recordFailure(ip);
  console.warn(`admin: неудачный вход с ${ip}`);
  return c.html(loginPage('Неверный пароль.'), 401);
});
app.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/admin' });
  return c.redirect('/admin/login');
});

// Всё остальное — только после входа.
const requireAuth = async (c: Context, next: Next) => {
  if (!verifySession(getCookie(c, SESSION_COOKIE))) return c.redirect('/admin/login');
  await next();
};
app.use('/', requireAuth);
app.use('/new', requireAuth);
app.use('/p/*', requireAuth);
app.use('/predlozheniya', requireAuth);
app.use('/predlozheniya/*', requireAuth);

// Кэш разобранных файлов по sha: повторно скачиваются только изменённые.
const cache = new Map<string, Row>();
async function loadRows(): Promise<Row[]> {
  const refs = await store.list();
  const rows = await Promise.all(refs.map(async ({ slug, sha }) => {
    const hit = cache.get(sha);
    if (hit && hit.slug === slug) return hit;
    const file = await store.get(slug);
    const { data } = parse(file?.content ?? '');
    const res = schema.safeParse(data);
    const d = data as Record<string, unknown>;
    const years = [d.birthYear, d.deathYear].some((x) => x !== undefined) ? `${d.birthYear ?? '?'}–${d.deathYear ?? ''}` : '';
    const row: Row = {
      slug, sha: file?.sha ?? sha, name: String(d.name ?? slug), years,
      status: String(d.status ?? 'needs-check'), archived: d.archived === true,
      error: res.success ? undefined : 'ошибка в данных',
    };
    cache.set(row.sha, row);
    return row;
  }));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

app.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const show = c.req.query('show') ?? 'all';
  let rows = await loadRows();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q));
  if (show === 'archived') rows = rows.filter((r) => r.archived);
  if (show === 'published') rows = rows.filter((r) => !r.archived);
  if (show === 'needs-check' || show === 'verified') rows = rows.filter((r) => r.status === show);
  const flash = c.req.query('saved') ? savedMessage(c.req.query('saved')!) : undefined;
  return c.html(listPage(rows, q, show, flash, store.describe()));
});

const savedMessage = (slug: string) =>
  config.store === 'github'
    ? `Сохранено: ${slug}. Изменение записано в репозиторий; на сайте появится после деплоя (обычно несколько минут).`
    : `Сохранено в файл: ${slug}.`;

async function save(slug: string, content: string, sha: string | null, message: string) {
  const newSha = await store.put(slug, content, sha, message);
  return newSha;
}

// ?name= — предзаполнение из входящего предложения (переносится только имя персоны, без контактов отправителя)
app.get('/new', (c) => c.html(editPage({ isNew: true, data: { status: 'needs-check', era: 'xx', name: (c.req.query('name') ?? '').slice(0, 200) || undefined }, body: '' })));
app.post('/new', async (c) => {
  const f = await c.req.parseBody({ all: true });
  const slug = typeof f.slug === 'string' ? f.slug.trim() : '';
  const { data, body } = fromForm(f, {});
  const errors: string[] = [];
  if (!SLUG_RE.test(slug)) errors.push('slug: только латиница в нижнем регистре, цифры и дефисы');
  const res = schema.safeParse(data);
  if (!res.success) errors.push(...issuesToText(res.error));
  if (!errors.length && (await store.get(slug))) errors.push(`slug: запись «${slug}» уже существует`);
  if (errors.length || !res.success) return c.html(editPage({ isNew: true, slug, data, body, errors }), 400);
  try {
    await save(slug, serialize(res.data, body), null, `admin: add ${slug}`);
  } catch (e) {
    return c.html(editPage({ isNew: true, slug, data, body, errors: [(e as Error).message] }), e instanceof ConflictError ? 409 : 500);
  }
  return c.redirect(`/admin/p/${slug}?saved=1`);
});

app.get('/p/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) return c.notFound();
  const file = await store.get(slug);
  if (!file) return c.notFound();
  const { data, body } = parse(file.content);
  const res = schema.safeParse(data);
  return c.html(editPage({
    slug, sha: file.sha, data, body,
    errors: res.success ? undefined : ['В файле есть ошибки, исправьте их и сохраните:', ...issuesToText(res.error)],
    flash: c.req.query('saved') ? savedMessage(slug) : undefined,
  }));
});

app.post('/p/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) return c.notFound();
  const f = await c.req.parseBody({ all: true });
  const sha = typeof f.sha === 'string' ? f.sha : '';
  const file = await store.get(slug);
  if (!file) return c.notFound();
  const { data: existing } = parse(file.content);
  const { data, body } = fromForm(f, existing);
  const res = schema.safeParse(data);
  if (!res.success) return c.html(editPage({ slug, sha, data, body, errors: issuesToText(res.error) }), 400);
  try {
    await save(slug, serialize(res.data, body), sha, `admin: update ${slug}`);
  } catch (e) {
    return c.html(editPage({ slug, sha, data, body, errors: [(e as Error).message] }), e instanceof ConflictError ? 409 : 500);
  }
  return c.redirect(`/admin/p/${slug}?saved=1`);
});

// Быстрые переключатели из списка: архив и статус проверки.
app.post('/p/:slug/toggle', async (c) => {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) return c.notFound();
  const { sha, field } = await c.req.parseBody();
  const file = await store.get(slug);
  if (!file) return c.notFound();
  if (file.sha !== sha) return c.text('Запись изменилась с момента загрузки списка. Вернитесь назад и обновите страницу.', 409);
  const { data, body } = parse(file.content);
  if (field === 'archived') data.archived = !(data.archived === true);
  else if (field === 'status') data.status = data.status === 'verified' ? 'needs-check' : 'verified';
  else return c.text('Неизвестное действие', 400);
  const res = schema.safeParse(data);
  if (!res.success) return c.redirect(`/admin/p/${slug}`);
  const verb = field === 'archived' ? (res.data.archived ? 'archive' : 'publish') : (res.data.status === 'verified' ? 'mark verified' : 'mark needs-check');
  try {
    await save(slug, serialize(res.data, body), file.sha, `admin: ${verb} ${slug}`);
  } catch (e) {
    return c.text((e as Error).message, e instanceof ConflictError ? 409 : 500);
  }
  return c.redirect(`/admin/?saved=${encodeURIComponent(slug)}`);
});

// Входящие предложения с публичной формы. Хранятся только в томе на сервере, срок — не более года.
app.get('/predlozheniya', async (c) => {
  const flash = c.req.query('deleted') ? 'Предложение удалено.' : undefined;
  return c.html(inboxPage(await suggestions.list(), flash));
});
app.get('/predlozheniya/:id', async (c) => {
  const s = await suggestions.get(c.req.param('id'));
  return s ? c.html(suggestionPage(s)) : c.notFound();
});
app.post('/predlozheniya/:id/delete', async (c) => {
  await suggestions.remove(c.req.param('id'));
  return c.redirect('/admin/predlozheniya?deleted=1');
});

app.onError((err, c) => {
  console.error(err);
  return c.text('Внутренняя ошибка: ' + err.message, 500);
});

serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`admin: http://localhost:${i.port}/admin/ (хранилище: ${store.describe()})`));
