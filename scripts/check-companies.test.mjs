import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parseRow, foundersFromText } from './check-companies.mjs';

test('parseList: пропускает комментарии, достаёт ИНН и «для кого»', () => {
  const l = parseList('# комм\nИНК | 38 08 1700 | Буйнов\n\nСлата | | Заяц\n');
  assert.deepEqual(l, [{ name: 'ИНК', inn: '38081700', who: 'Буйнов' }, { name: 'Слата', inn: '', who: 'Заяц' }]);
});
test('parseRow: статус по дате прекращения', () => {
  assert.equal(parseRow({ n: 'ООО А', i: '1', o: '2', r: '01.01.2000' }).status, 'действует');
  assert.match(parseRow({ n: 'ООО Б', e: '02.02.2020' }).status, /прекращена 02.02.2020/);
});
test('foundersFromText: берёт раздел и скрывает ИНН физлиц', () => {
  const t = 'Шапка\nСведения об учредителях (участниках) юридического лица\nИванов Иван ИНН 381234567890 доля 70%\nСведения о видах экономической деятельности\nпрочее';
  const f = foundersFromText(t);
  assert.match(f, /Иванов Иван/);
  assert.match(f, /\[ИНН физлица скрыт\]/);
  assert.doesNotMatch(f, /381234567890|прочее/);
  assert.equal(foundersFromText('нет раздела'), '');
});
