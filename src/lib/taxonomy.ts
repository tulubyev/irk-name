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
  'svyashchennik': 'Религия',
  'vrach': 'Врачи',
  'muzykant': 'Музыканты',
  'interesnye': 'Интересные люди',
} as const;
export type SphereKey = keyof typeof SPHERES;

// Районы и городские округа Иркутской области. Добавляйте по мере появления записей.
export const DISTRICTS = {
  'g-irkutsk': 'г. Иркутск',
  'irkutskij-rajon': 'Иркутский район',
  'shelehovskij-rajon': 'Шелеховский район',
  'alarskij-rajon': 'Аларский район',
  'g-cheremhovo': 'г. Черемхово',
  'ust-udinskij-rajon': 'Усть-Удинский район',
  'nizhneilimskij-rajon': 'Нижнеилимский район',
} as const;
export type DistrictKey = keyof typeof DISTRICTS;

export const ERAS = {
  'xvii': 'XVII век',
  'xviii': 'XVIII век',
  'xix': 'XIX век',
  'xx': 'XX век',
  'xxi': 'XXI век',
} as const;
export type EraKey = keyof typeof ERAS;

export const CONNECTIONS = {
  birth: 'Уроженец Иркутска или Иркутской области (губернии)',
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

// Временные слои. Человек попадает в слой, если период его активной жизни
// (с 18 лет до смерти или до сегодняшнего дня) пересекается с границами слоя.
export const LAYERS = {
  'do-1917': { label: 'До 1917 года', hint: 'Российская империя', from: -Infinity, to: 1916 },
  'do-1992': { label: 'До 1992 года', hint: '1917–1991, советский период', from: 1917, to: 1991 },
  'nastoyashchee': { label: 'Настоящее время', hint: 'с 1992 года', from: 1992, to: Infinity },
} as const;
export type LayerKey = keyof typeof LAYERS;
export const LAYER_RULE =
  'Слой — период, в который человек жил и действовал (считая с 18 лет). Если он жил на стыке периодов, запись показывается в каждом из них.';
