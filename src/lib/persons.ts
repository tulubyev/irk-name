import { getCollection, type CollectionEntry } from 'astro:content';
import type { DistrictKey } from './taxonomy';

export type Person = CollectionEntry<'persons'>;

/** Опубликованные записи (без архива). Все публичные страницы берут данные отсюда. */
export async function getPersons(): Promise<Person[]> {
  return getAllPersons({ includeArchived: false });
}

export async function getAllPersons({ includeArchived = false } = {}): Promise<Person[]> {
  const all = await getCollection('persons', (p) => includeArchived || !p.data.archived);
  return all.sort((a, b) => a.data.name.localeCompare(b.data.name, 'ru'));
}

export function lifespan(p: Person['data']): string {
  const a = p.datesApproximate ? '≈' : '';
  if (!p.birthYear && !p.deathYear) return '';
  return `${a}${p.birthYear ?? '?'}–${p.deathYear ?? ''}`.replace(/–$/, p.deathYear ? '' : '–');
}

export const SITE = 'https://irk.name';

/** Районы, с которыми связан человек (по местам). */
export function districtsOf(p: Person['data']): DistrictKey[] {
  return [...new Set(p.places.flatMap((pl) => (pl.district ? [pl.district] : [])))];
}

/** Населённые пункты, с которыми связан человек (по местам). */
export function settlementsOf(p: Person['data']): string[] {
  return [...new Set(p.places.flatMap((pl) => (pl.settlement ? [pl.settlement] : [])))];
}
