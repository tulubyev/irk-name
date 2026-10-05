import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { SPHERES, ERAS, CONNECTIONS, DISTRICTS } from './lib/taxonomy';

const persons = defineCollection({
  // slug = имя файла (транслит), напр. grigoriy-shelikhov.md
  loader: glob({ pattern: '**/*.md', base: './src/content/persons' }),
  schema: z.object({
    name: z.string(),
    birthYear: z.number().int().optional(),
    deathYear: z.number().int().optional(),
    // «≈» перед годом выводится, если год приблизительный
    datesApproximate: z.boolean().default(false),
    spheres: z.array(z.enum(Object.keys(SPHERES) as [keyof typeof SPHERES, ...(keyof typeof SPHERES)[]])).min(1),
    era: z.enum(Object.keys(ERAS) as [keyof typeof ERAS, ...(keyof typeof ERAS)[]]),
    summary: z.string().max(300),
    connection: z.array(z.enum(Object.keys(CONNECTIONS) as [keyof typeof CONNECTIONS, ...(keyof typeof CONNECTIONS)[]])).min(1),
    connectionNote: z.string().optional(),
    places: z
      .array(
        z.object({
          name: z.string(),
          // населённый пункт (свободный текст) и район/городской округ (из справочника DISTRICTS)
          settlement: z.string().optional(),
          district: z.enum(Object.keys(DISTRICTS) as [keyof typeof DISTRICTS, ...(keyof typeof DISTRICTS)[]]).optional(),
          lat: z.number().optional(),
          lon: z.number().optional(),
        }),
      )
      .default([]),
    // Только свободные лицензии (Wikimedia Commons и т.п.) с атрибуцией
    photo: z
      .object({
        // относительный ключ в бакете, напр. persons/<slug>.webp (+ <slug>-640.webp)
        key: z.string().regex(/^[a-z0-9][a-z0-9\-_/]*\.webp$/),
        alt: z.string(),
        author: z.string(),
        license: z.string(),
        licenseUrl: z.url().optional(),
        sourceUrl: z.url(),
      })
      .optional(),
    sources: z.array(z.object({ title: z.string(), url: z.url() })).min(1),
    status: z.enum(['verified', 'needs-check']).default('needs-check'),
  }),
});

export const collections = { persons };
