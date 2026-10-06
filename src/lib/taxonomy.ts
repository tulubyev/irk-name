export const SPHERES = {
  'puteshestvennik': 'Путешественники и первопроходцы',
  'kupec': 'Бизнес',
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
  'vrach': 'Врачи',
  'muzykant': 'Музыканты',
  'interesnye': 'Интересные люди',
} as const;
export type SphereKey = keyof typeof SPHERES;

// Цветовые группы сфер (цвета — в global.css, классы .fam-<группа>; контраст ≥ 4.5:1 в обеих темах).
export const SPHERE_FAMILY: Record<SphereKey, string> = {
  puteshestvennik: 'travel',
  kupec: 'merchant',
  pisatel: 'culture',
  dramaturg: 'culture',
  artist: 'culture',
  muzykant: 'culture',
  uchenyj: 'science',
  voennyj: 'military',
  'gosudarstvennyj-deyatel': 'power',
  gradonachalnik: 'power',
  revolyucioner: 'power',
  dekabrist: 'power',
  svyashchennik: 'clergy',
  vrach: 'medicine',
  arhitektor: 'builders',
  sportsmen: 'people',
  interesnye: 'people',
};

// Районы и городские округа Иркутской области. Добавляйте по мере появления записей.
export const DISTRICTS = {
  'g-irkutsk': 'г. Иркутск',
  'irkutskij-rajon': 'Иркутский район',
  'shelehovskij-rajon': 'Шелеховский район',
  'alarskij-rajon': 'Аларский район',
  'g-cheremhovo': 'г. Черемхово',
  'ust-udinskij-rajon': 'Усть-Удинский район',
  'balaganskij-rajon': 'Балаганский район',
  'nizhneilimskij-rajon': 'Нижнеилимский район',
  'g-bratsk': 'г. Братск',
  'kachugskij-rajon': 'Качугский район',
  'ust-kutskij-rajon': 'Усть-Кутский район',
  'slyudyanskij-rajon': 'Слюдянский район',
  'g-zima': 'г. Зима',
  'nizhneudinskij-rajon': 'Нижнеудинский район',
  'ehirit-bulagatskij-rajon': 'Эхирит-Булагатский район',
  'bohanskij-rajon': 'Боханский район',
  'kirenskij-rajon': 'Киренский район',
  'cheremhovskij-rajon': 'Черемховский район',
  'g-angarsk': 'Ангарский городской округ',
  'tajshetskij-rajon': 'Тайшетский район',
  'g-usole-sibirskoe': 'г. Усолье-Сибирское',
  'g-ust-ilimsk': 'г. Усть-Илимск',
  'olhonskij-rajon': 'Ольхонский район',
  'g-tulun': 'г. Тулун',
  'bodajbinskij-rajon': 'Бодайбинский район',
  'osinskij-rajon': 'Осинский район',
  'nukutskij-rajon': 'Нукутский район',
  'zalarinskij-rajon': 'Заларинский район',
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
