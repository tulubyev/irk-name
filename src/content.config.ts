import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { personSchema } from './lib/person-schema';

const persons = defineCollection({
  // slug = имя файла (транслит), напр. grigoriy-shelikhov.md
  loader: glob({ pattern: '**/*.md', base: './src/content/persons' }),
  schema: personSchema(z),
});

export const collections = { persons };
