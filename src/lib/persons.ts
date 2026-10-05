import { getCollection, type CollectionEntry } from 'astro:content';
import { LAYERS, type LayerKey, type DistrictKey } from './taxonomy';

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

const ERA_START = { xvii: 1600, xviii: 1700, xix: 1800, xx: 1900, xxi: 2000 } as const;

/** Временные слои, в которых человек жил и действовал. */
export function layersOf(p: Person['data']): LayerKey[] {
  const start = p.birthYear !== undefined ? p.birthYear + 18 : ERA_START[p.era];
  const end =
    p.deathYear ?? (p.birthYear !== undefined ? new Date().getFullYear() : ERA_START[p.era] + 99);
  return (Object.keys(LAYERS) as LayerKey[]).filter((k) => start <= LAYERS[k].to && end >= LAYERS[k].from);
}

/** Районы, с которыми связан человек (по местам). */
export function districtsOf(p: Person['data']): DistrictKey[] {
  return [...new Set(p.places.flatMap((pl) => (pl.district ? [pl.district] : [])))];
}

/** Населённые пункты, с которыми связан человек (по местам). */
export function settlementsOf(p: Person['data']): string[] {
  return [...new Set(p.places.flatMap((pl) => (pl.settlement ? [pl.settlement] : [])))];
}
