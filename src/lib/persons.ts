import { getCollection, type CollectionEntry } from 'astro:content';

export type Person = CollectionEntry<'persons'>;

export async function getPersons(): Promise<Person[]> {
  const all = await getCollection('persons');
  return all.sort((a, b) => a.data.name.localeCompare(b.data.name, 'ru'));
}

export function lifespan(p: Person['data']): string {
  const a = p.datesApproximate ? '≈' : '';
  if (!p.birthYear && !p.deathYear) return '';
  return `${a}${p.birthYear ?? '?'}–${p.deathYear ?? ''}`.replace(/–$/, p.deathYear ? '' : '–');
}

export const SITE = 'https://irk.name';
