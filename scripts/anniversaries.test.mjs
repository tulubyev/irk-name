import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePerson, level, findAnniversaries, renderReport } from './anniversaries.mjs';

const md = `---
name: Иван Иванов
birthYear: 1877
deathYear: 1950
summary: Краевед.
status: verified
countries:
  - Франция
photo:
  key: persons/x.webp
---
текст`;

test('parsePerson читает поля', () => {
  const p = parsePerson('ivan', md);
  assert.equal(p.birthYear, 1877);
  assert.deepEqual(p.countries, ['Франция']);
  assert.equal(p.hasPhoto, true);
  assert.equal(p.status, 'verified');
});

test('уровни юбилеев', () => {
  assert.deepEqual([150, 125, 90, 20, 77].map(level), [3, 2, 1, 0, 0]);
});

test('findAnniversaries и отчёт', () => {
  const p = parsePerson('ivan', md);
  const l = findAnniversaries([p], 2027);
  assert.equal(l.length, 1);
  assert.equal(l[0].kind, 'birth');
  assert.match(renderReport([p], 2027), /150 лет со дня рождения/);
  assert.match(renderReport([p], 2028), /Юбилеев в этом году нет/);
});
