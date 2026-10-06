// Базовый URL медиа-CDN. Переопределяется переменной PUBLIC_CDN_URL при сборке.
const CDN = (import.meta.env.PUBLIC_CDN_URL ?? 'https://cdn.irk.name').replace(/\/+$/, '');

/** Абсолютный URL по ключу объекта в бакете (persons/<slug>.webp). */
export function mediaUrl(key: string): string {
  return `${CDN}/${key.replace(/^\/+/, '')}`;
}

const sized = (key: string, suffix: string) => mediaUrl(key.replace(/\.webp$/, `${suffix}.webp`));

/** srcset из двух заранее подготовленных размеров: <name>-640.webp и <name>.webp (≤1200). */
export function mediaSrcset(key: string): string {
  return `${sized(key, '-640')} 640w, ${mediaUrl(key)} 1200w`;
}

/** srcset миниатюры для карточки: <name>-160.webp и <name>-640.webp. */
export function thumbSrcset(key: string): string {
  return `${sized(key, '-160')} 160w, ${sized(key, '-640')} 640w`;
}

export const thumbUrl = (key: string) => sized(key, '-160');
