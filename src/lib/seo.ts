// Общие помощники для SEO: заголовки, описания, структурированные данные (schema.org).
import { SITE, districtsOf, lifespan, type Person } from './persons';
import { OPERATOR } from './operator';
import { mediaUrl } from './media';
import { SPHERES } from './taxonomy';

export const BRAND = 'Иркутяне';

// Коды подтверждения владения сайтом в вебмастерских (публичные метатеги). Заполняются после регистрации сайта.
export const VERIFICATION = {
  yandex: '', // Яндекс Вебмастер: <meta name="yandex-verification">
  google: '', // Google Search Console: <meta name="google-site-verification">
  bing: '', //   Bing Webmaster: <meta name="msvalidate.01">
};

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
export const biographies = (n: number) => `${n} ${plural(n, ['биография', 'биографии', 'биографий'])}`;

/** Обрезка до max символов по границе слова, с многоточием. */
export function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:—-]+$/, '')}…`;
}

/** Самые «заметные» записи: больше источников, есть фото, короткое имя — для описаний страниц. */
export function notable(list: Person[], n = 4): Person[] {
  return [...list]
    .filter((p) => p.data.name.length <= 34)
    .sort(
      (a, b) =>
        b.data.sources.length - a.data.sources.length ||
        Number(!!b.data.photo) - Number(!!a.data.photo) ||
        a.data.name.localeCompare(b.data.name, 'ru'),
    )
    .slice(0, n);
}
export const namesOf = (list: Person[], n = 4) => notable(list, n).map((p) => p.data.name).join(', ');

/** Заголовок страницы персоны: «Имя (годы) — биография». */
export function personTitle(d: Person['data']): string {
  const years = lifespan(d);
  return `${d.name}${years ? ` (${years})` : ''} — биография`;
}

/** Связанные записи для перелинковки: общие сферы, районы, век. */
export function relatedTo(person: Person, all: Person[], n = 6): Person[] {
  const d = person.data;
  const dist = new Set(districtsOf(d));
  return all
    .filter((p) => p.id !== person.id)
    .map((p) => ({
      p,
      score:
        p.data.spheres.filter((s) => d.spheres.includes(s)).length * 2 +
        districtsOf(p.data).filter((k) => dist.has(k)).length * 3 +
        (p.data.era === d.era ? 1 : 0) +
        (p.data.photo ? 0.5 : 0),
    }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || a.p.data.name.localeCompare(b.p.data.name, 'ru'))
    .slice(0, n)
    .map((x) => x.p);
}

// ---------- JSON-LD ----------

const ctx = 'https://schema.org';

export function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    '@context': ctx,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

export function collectionLd(opts: { name: string; url: string; description: string; persons: Person[] }) {
  return {
    '@context': ctx,
    '@type': 'CollectionPage',
    name: opts.name,
    url: opts.url,
    description: opts.description,
    inLanguage: 'ru',
    isPartOf: { '@id': `${SITE}/#website` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.persons.length,
      itemListElement: opts.persons.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/persona/${p.id}/`,
        name: p.data.name,
      })),
    },
  };
}

export function siteLd(description: string) {
  const [postalCode, , , locality, street] = OPERATOR.address.split(',').map((s) => s.trim());
  return {
    '@context': ctx,
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE}/#website`,
        name: BRAND,
        alternateName: 'irk.name',
        url: `${SITE}/`,
        inLanguage: 'ru',
        description,
        publisher: { '@id': `${SITE}/#org` },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Organization',
        '@id': `${SITE}/#org`,
        name: OPERATOR.shortName,
        legalName: OPERATOR.name,
        url: `${SITE}/`,
        taxID: OPERATOR.inn,
        email: OPERATOR.email,
        logo: `${SITE}/apple-touch-icon.png`,
        address: {
          '@type': 'PostalAddress',
          postalCode,
          addressRegion: 'Иркутская область',
          addressLocality: locality,
          streetAddress: street,
          addressCountry: 'RU',
        },
      },
    ],
  };
}

export function profileLd(person: Person, url: string, title: string) {
  const d = person.data;
  const image = d.photo
    ? {
        '@type': 'ImageObject',
        contentUrl: mediaUrl(d.photo.key),
        caption: d.photo.alt,
        creditText: d.photo.author,
        copyrightNotice: d.photo.author,
        acquireLicensePage: d.photo.sourceUrl,
        ...(d.photo.licenseUrl ? { license: d.photo.licenseUrl } : {}),
      }
    : undefined;
  return {
    '@context': ctx,
    '@type': 'ProfilePage',
    '@id': `${url}#profile`,
    url,
    name: title,
    inLanguage: 'ru',
    isPartOf: { '@id': `${SITE}/#website` },
    mainEntity: {
      '@type': 'Person',
      '@id': `${url}#person`,
      name: d.name,
      url,
      description: d.summary,
      ...(d.birthYear ? { birthDate: String(d.birthYear) } : {}),
      ...(d.deathYear ? { deathDate: String(d.deathYear) } : {}),
      ...(image ? { image } : {}),
      knowsAbout: d.spheres.map((s) => SPHERES[s]),
      sameAs: d.sources.map((s) => s.url),
    },
  };
}
