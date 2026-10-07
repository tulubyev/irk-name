// Схема записи о персоне. Общая для сайта (src/content.config.ts) и админки (admin/),
// чтобы правка в админке не могла сломать сборку сайта.
// Принимает экземпляр zod: сайт передаёт astro/zod, админка — zod/v4.
import type * as Zod from 'zod/v4';
import { SPHERES, ERAS, CONNECTIONS, DISTRICTS } from './taxonomy';

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export function personSchema(z: typeof Zod) {
  const image = z.object({
    // относительный ключ в бакете, напр. persons/<slug>.webp (+ <slug>-640.webp, <slug>-160.webp)
    key: z.string().regex(/^[a-z0-9][a-z0-9\-_/]*\.webp$/),
    alt: z.string(),
    // подпись под фото (необязательно)
    caption: z.string().optional(),
    author: z.string(),
    license: z.string(),
    licenseUrl: z.url().optional(),
    // ссылка на оригинал; у снимков из семейных архивов её может не быть
    sourceUrl: z.url().optional(),
  });
  return z.object({
    name: z.string().min(1),
    birthYear: z.number().int().optional(),
    deathYear: z.number().int().optional(),
    // «≈» перед годом выводится, если год приблизительный
    datesApproximate: z.boolean().default(false),
    spheres: z.array(z.enum(keys(SPHERES))).min(1),
    era: z.enum(keys(ERAS)),
    summary: z.string().min(1).max(300),
    connection: z.array(z.enum(keys(CONNECTIONS))).min(1),
    connectionNote: z.string().optional(),
    places: z
      .array(
        z.object({
          name: z.string().min(1),
          // населённый пункт (свободный текст) и район/городской округ (из справочника DISTRICTS)
          settlement: z.string().optional(),
          district: z.enum(keys(DISTRICTS)).optional(),
          lat: z.number().optional(),
          lon: z.number().optional(),
        }),
      )
      .default([]),
    // Главное фото (миниатюра в карточке, картинка в соцсетях). Свободная лицензия или разрешение владельца архива
    photo: image.optional(),
    // Дополнительные фото: показываются на странице персоны под статьёй
    gallery: z.array(image).default([]),
    // Расширение карточки: статьи и материалы о жизни и деятельности (помимо источников фактов)
    links: z.array(z.object({ title: z.string().min(1), url: z.url() })).default([]),
    sources: z.array(z.object({ title: z.string().min(1), url: z.url() })).min(1),
    status: z.enum(['verified', 'needs-check']).default('needs-check'),
    // В архиве: запись не публикуется на сайте (видна только администратору)
    archived: z.boolean().default(false),
  });
}
