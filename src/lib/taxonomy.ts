export const SPHERES = {
  'puteshestvennik': 'Путешественники и первопроходцы',
  'kupec': 'Купцы и меценаты',
  'pisatel': 'Писатели и поэты',
  'dramaturg': 'Драматурги',
  'uchenyj': 'Учёные',
  'voennyj': 'Военные и флотоводцы',
  'gosudarstvennyj-deyatel': 'Государственные деятели',
  'dekabrist': 'Декабристы',
  'artist': 'Артисты и режиссёры',
  'sportsmen': 'Спортсмены',
  'arhitektor': 'Архитекторы и строители',
  'gradonachalnik': 'Градоначальники',
  'revolyucioner': 'Революционеры и политики',
  'svyashchennik': 'Духовенство',
} as const;
export type SphereKey = keyof typeof SPHERES;

export const ERAS = {
  'xvii': 'XVII век',
  'xviii': 'XVIII век',
  'xix': 'XIX век',
  'xx': 'XX век',
  'xxi': 'XXI век',
} as const;
export type EraKey = keyof typeof ERAS;

export const CONNECTIONS = {
  birth: 'Родился в Иркутске / Иркутской губернии',
  life: 'Жил в Иркутске',
  work: 'Работал в Иркутске',
  exile: 'Находился в ссылке',
  visit: 'Бывал в Иркутске',
} as const;
export type ConnectionKey = keyof typeof CONNECTIONS;

export const STATUS = {
  verified: 'Проверено по источникам',
  'needs-check': 'Требует проверки',
} as const;
