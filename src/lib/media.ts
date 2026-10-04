// Базовый URL медиа-CDN. Переопределяется переменной PUBLIC_CDN_URL при сборке.
const CDN = (import.meta.env.PUBLIC_CDN_URL ?? 'https://cdn.irk.name').replace(/\/+$/, '');

/** Абсолютный URL по ключу объекта в бакете (persons/<slug>.webp). */
export function mediaUrl(key: string): string {
  return `${CDN}/${key.replace(/^\/+/, '')}`;
}

/** srcset из двух заранее подготовленных размеров: <name>-640.webp и <name>.webp (1280). */
export function mediaSrcset(key: string): string {
  const small = key.replace(/\.webp$/, '-640.webp');
  return `${mediaUrl(small)} 640w, ${mediaUrl(key)} 1280w`;
}
