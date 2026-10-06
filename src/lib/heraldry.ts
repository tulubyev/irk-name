// Гербы в шапке сайта. Файлы — с Wikimedia Commons (data/commons-photos.json, раздел heraldry),
// готовятся scripts/fetch-commons.mjs и лежат в бакете как heraldry/<key>.webp (+ .svg).
// Пока файла нет на CDN, картинка скрывается (onerror) и вёрстка не меняется.
export const HERALDRY = [
  { key: 'heraldry/irkutsk.webp', alt: 'Герб города Иркутска', width: 23, height: 28 },
  { key: 'heraldry/irkutsk-oblast.webp', alt: 'Герб Иркутской области', width: 23, height: 28 },
] as const;
