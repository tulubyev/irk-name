import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { bodyLimit } from 'hono/body-limit';
import { validate, save, purgeExpired } from './suggestions';

// Приём предложений с публичной формы /predlozhit/. Без секретов и без доступа к GitHub:
// только пишет файлы в том на сервере. IP-адреса используются лишь в памяти для ограничения частоты.
const PORT = Number(process.env.PORT ?? 3001);
const ORIGIN = process.env.FORMS_ORIGIN ?? 'https://irk.name';
const FORM_PAGE = '/predlozhit/';
const THANKS_PAGE = '/predlozhit/spasibo/';
const MIN_FILL_MS = 3000;

const app = new Hono({ strict: false }).basePath('/api/suggest');

app.use('*', async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'no-store');
});

app.get('/healthz', (c) => c.text('ok'));

// Не более 10 отправок в час с одного IP (в памяти, на диск не пишется).
const hits = new Map<string, number[]>();
const WINDOW = 3600_000;
const LIMIT = 10;
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) if (ts.every((t) => now - t >= WINDOW)) hits.delete(ip);
}, 600_000).unref();

const clientIp = (c: Context) => (c.req.header('x-forwarded-for')?.split(',')[0] ?? c.req.header('x-real-ip') ?? 'local').trim();
const back = (c: Context, code: string) => c.redirect(`${FORM_PAGE}?oshibka=${code}#forma`, 303);

app.post(
  '/',
  bodyLimit({ maxSize: 16 * 1024, onError: (c) => back(c, 'size') }),
  async (c) => {
    const origin = c.req.header('origin') ?? (c.req.header('referer') ? new URL(c.req.header('referer')!).origin : '');
    if (origin !== ORIGIN) return c.text('Запрос отклонён (неверный источник)', 403);
    if (limited(clientIp(c))) return back(c, 'limit');

    const form = await c.req.parseBody();
    // Ловушки для ботов: скрытое поле и слишком быстрое заполнение. Боту отвечаем как обычно, но ничего не сохраняем.
    const started = Number(form.ts);
    if ((typeof form.website === 'string' && form.website !== '') || (started && Date.now() - started < MIN_FILL_MS)) {
      return c.redirect(THANKS_PAGE, 303);
    }
    const res = validate(form);
    if (!res.ok) return back(c, 'data');
    const id = await save(res.data);
    console.log(`forms: принято предложение ${id}`);
    return c.redirect(THANKS_PAGE, 303);
  },
);

app.onError((err, c) => {
  console.error('forms: ошибка', err.message);
  return back(c, 'server');
});

const purge = () => purgeExpired().then((n) => n && console.log(`forms: удалено устаревших предложений: ${n}`)).catch((e) => console.error('forms: очистка', e.message));
purge();
setInterval(purge, 86_400_000).unref();

serve({ fetch: app.fetch, port: PORT }, (i) => console.log(`forms: http://localhost:${i.port}/api/suggest`));
