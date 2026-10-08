// Анализатор юбилейных дат и черновик пресс-пакета.
//   node scripts/anniversaries.mjs [--year 2027] [--out report.md] [--json]
// В карточках известны только годы, поэтому юбилей определяется по году; день и месяц
// нужно уточнить по источникам до публикации. Тексты строятся только из полей карточки.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://irk.name';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/s, '$2');

// Лёгкий разбор нужных полей frontmatter без зависимостей.
export function parsePerson(slug, md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const scalar = (k) => {
    const r = fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'));
    return r ? unquote(r[1]) : undefined;
  };
  const num = (k) => (scalar(k) !== undefined ? Number(scalar(k)) : undefined);
  const countries = [...(fm.match(/^countries:\n((?:\s+- .*\n?)+)/m)?.[1] ?? '').matchAll(/- (.+)/g)].map((x) => unquote(x[1]));
  return {
    slug,
    name: scalar('name'),
    birthYear: num('birthYear'),
    deathYear: num('deathYear'),
    approx: scalar('datesApproximate') === 'true',
    summary: scalar('summary') ?? '',
    status: scalar('status') ?? 'needs-check',
    archived: scalar('archived') === 'true',
    hasPhoto: /^photo:/m.test(fm),
    countries,
  };
}

// Уровень юбилея: 3 — «круглый» (кратно 100, 50), 2 — кратно 25, 1 — кратно 10, 0 — не юбилей.
export function level(n) {
  if (n <= 0) return 0;
  if (n % 50 === 0) return 3;
  if (n % 25 === 0) return 2;
  if (n % 10 === 0 && n >= 30) return 1;
  return 0;
}

export function findAnniversaries(persons, year) {
  const out = [];
  for (const p of persons) {
    if (p.archived || !p.name) continue;
    for (const [kind, y] of [['birth', p.birthYear], ['death', p.deathYear]]) {
      if (!y) continue;
      const n = year - y;
      const lv = level(n);
      if (lv) out.push({ person: p, kind, years: n, level: lv, eventYear: y });
    }
  }
  return out.sort((a, b) => b.level - a.level || b.years - a.years || a.person.name.localeCompare(b.person.name, 'ru'));
}

function plural(n, one, few, many) {
  const a = n % 100, b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b > 1 && b < 5) return few;
  return many;
}

const LEVEL = { 3: 'главный юбилей', 2: 'крупный юбилей', 1: 'юбилей' };

export function renderEntry(a) {
  const { person: p, kind, years, eventYear } = a;
  const yw = `${years} ${plural(years, 'год', 'года', 'лет')}`;
  const what = kind === 'birth' ? `со дня рождения (${eventYear})` : `со дня смерти (${eventYear})`;
  const url = `${SITE}/persona/${p.slug}/`;
  const warn = [];
  if (p.status !== 'verified') warn.push('карточка «требует проверки» — сверить факты и даты с источниками до публикации');
  if (p.approx) warn.push('даты в карточке приблизительные — юбилей под вопросом');
  if (!p.hasPhoto) warn.push('нет портрета — найти или запросить у владельца архива');
  warn.push('уточнить точные день и месяц по источникам (в карточке только год)');
  const place = p.countries.length ? ` (${p.countries.join(', ')})` : '';
  return [
    `### ${p.name} — ${yw} ${what}`,
    `*${LEVEL[a.level]}*${place}. Карточка: ${url}`,
    '',
    '**Перед публикацией:**',
    ...warn.map((w) => `- [ ] ${w}`),
    '',
    '**Черновик заметки для СМИ и соцсетей** (факты — только из карточки):',
    `> ${yw} назад ${kind === 'birth' ? 'родился' : 'ушёл из жизни'} ${p.name}. ${p.summary}`,
    `> Подробнее на irk.name: ${url}`,
    '',
    '**Предложения по обнародованию:**',
    '- Публикация в соцсетях проекта за 1–2 дня до даты и в день даты (со ссылкой на карточку).',
    '- Письмо в местные СМИ и на радио с готовым текстом и портретом (если есть права).',
    '- Предложение областной/городской библиотеке и музею: книжная выставка или заметка в рассылке.',
    '- Предложение школам и вузам города: материал для классного часа или краеведческого урока.',
    ...(p.countries.length ? ['- Рассылка в землячества и общества соотечественников (например, Иркутское землячество «Байкал»).'] : []),
    '',
  ].join('\n');
}

export function renderReport(persons, year) {
  const list = findAnniversaries(persons, year);
  const head = [
    `# Юбилейные даты ${year}: пресс-пакет (черновик)`,
    '',
    `Найдено юбилеев: ${list.length} (кратные 50, 25 и 10 лет от 30 лет). Рассчитано по годам из карточек.`,
    'Автоматический черновик: перед выпуском проверьте даты, факты и права на изображения.',
    '',
  ];
  if (!list.length) return head.concat('Юбилеев в этом году нет.\n').join('\n');
  const groups = [3, 2, 1].map((lv) => [lv, list.filter((a) => a.level === lv)]).filter(([, g]) => g.length);
  const title = { 3: 'Главные юбилеи (50, 100, 150… лет)', 2: 'Крупные юбилеи (25, 75, 125… лет)', 1: 'Юбилеи (кратные 10)' };
  const body = groups.flatMap(([lv, g]) => [`## ${title[lv]}`, '', ...g.map(renderEntry)]);
  return head.concat(body).join('\n');
}

export async function loadPersons(dir = join(root, 'src/content/persons')) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  const all = await Promise.all(files.map(async (f) => parsePerson(f.replace(/\.md$/, ''), await readFile(join(dir, f), 'utf8'))));
  return all.filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const year = Number(arg('--year') ?? new Date().getFullYear() + 1);
  const persons = await loadPersons();
  const text = process.argv.includes('--json')
    ? JSON.stringify(findAnniversaries(persons, year), null, 2)
    : renderReport(persons, year);
  const out = arg('--out');
  if (out) await writeFile(out, text); else console.log(text);
}
