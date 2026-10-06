import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecord, searchName, wdYear, pickCandidate, discoverAll, acceptHigh } from './discover-photos.mjs';

const t = (y) => ({ mainsnak: { datavalue: { value: { time: `${y < 0 ? '-' : '+'}${String(Math.abs(y)).padStart(4, '0')}-00-00T00:00:00Z` } } } });
const ent = (id, { human = true, file, born, died, label = 'X' } = {}) => ({
  id,
  labels: { ru: { value: label } },
  descriptions: { ru: { value: 'описание' } },
  claims: {
    P31: [{ mainsnak: { datavalue: { value: { id: human ? 'Q5' : 'Q515' } } } }],
    ...(file ? { P18: [{ mainsnak: { datavalue: { value: file } } }] } : {}),
    ...(born !== undefined ? { P569: [t(born)] } : {}),
    ...(died !== undefined ? { P570: [t(died)] } : {}),
  },
});

test('readRecord и searchName', () => {
  const r = readRecord('---\nname: "Аввакум Петров, протопоп"\nbirthYear: 1620\ndeathYear: 1682\narchived: true\n---\n\nтекст');
  assert.deepEqual(r, { name: 'Аввакум Петров, протопоп', birthYear: 1620, deathYear: 1682, archived: true, hasPhoto: false });
  assert.equal(searchName(r.name), 'Аввакум Петров');
  assert.equal(searchName('Иннокентий (Вениаминов), митрополит'), 'Иннокентий');
  assert.equal(readRecord('---\nname: A\nphoto:\n  key: x.webp\n---').hasPhoto, true);
});

test('wdYear', () => {
  assert.equal(wdYear({ P569: [t(1837)] }, 'P569'), 1837);
  assert.equal(wdYear({ P569: [t(-50)] }, 'P569'), -50);
  assert.equal(wdYear({}, 'P569'), undefined);
});

test('pickCandidate: годы, не-человек, неоднозначность', () => {
  const rec = { birthYear: 1871, deathYear: 1942 };
  assert.deepEqual(pickCandidate([ent('Q1', { file: 'A.jpg', born: 1871, died: 1942 })], rec).map((c) => [c.qid, c.file, c.confidence]), [['Q1', 'File:A.jpg', 'high']]);
  assert.equal(pickCandidate([ent('Q2', { file: 'B.jpg', born: 1900, died: 1950 })], rec).length, 0, 'другие годы');
  assert.equal(pickCandidate([ent('Q3', { human: false, file: 'C.jpg' })], rec).length, 0, 'не человек');
  assert.equal(pickCandidate([ent('Q4', { born: 1871 })], rec).length, 0, 'нет P18');
  assert.equal(pickCandidate([ent('Q5', { file: 'D.jpg', born: 1872, died: 1942 })], rec)[0].confidence, 'high', '±1 год');
  assert.equal(pickCandidate([ent('Q6', { file: 'E.jpg' })], {})[0].confidence, 'low', 'без годов у записи');
  const two = pickCandidate([ent('Q7', { file: 'F.jpg', born: 1871 }), ent('Q8', { file: 'G.jpg', born: 1871 })], rec);
  assert.deepEqual(two.map((c) => c.confidence), ['low', 'low']);
});

test('discoverAll + acceptHigh на моках Wikidata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'disc-'));
  const persons = join(dir, 'persons');
  await mkdir(persons);
  await writeFile(join(persons, 'nit-romanov.md'), '---\nname: "Нит Степанович Романов"\nbirthYear: 1871\ndeathYear: 1942\n---\n');
  await writeFile(join(persons, 'known.md'), '---\nname: "Известный"\nbirthYear: 1800\n---\n');
  await writeFile(join(persons, 'living.md'), '---\nname: "Живущий"\nbirthYear: 1960\narchived: true\n---\n');
  await writeFile(join(persons, 'nobody.md'), '---\nname: "Безвестный"\nbirthYear: 1900\n---\n');
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url); calls.push(u.searchParams.get('action') + ':' + (u.searchParams.get('search') ?? u.searchParams.get('ids')));
    const body = u.searchParams.get('action') === 'wbsearchentities'
      ? { search: u.searchParams.get('search') === 'Нит Степанович Романов' ? [{ id: 'Q100' }] : [] }
      : { entities: { Q100: ent('Q100', { file: 'Romanov N S.jpg', born: 1871, died: 1942 }) } };
    return { ok: true, status: 200, json: async () => body };
  };
  const results = await discoverAll({ personsDir: persons, manifest: { persons: [{ slug: 'known' }] }, only: null, fetchImpl, delay: 0, log: () => {} });
  assert.deepEqual(results.map((r) => r.slug), ['nit-romanov', 'nobody'], 'известные и архивные пропущены');
  assert.deepEqual(acceptHigh(results), [{ slug: 'nit-romanov', file: 'File:Romanov N S.jpg', alt: 'Портрет: Нит Степанович Романов' }]);
  assert.ok(!calls.some((c) => c.includes('Живущий')));
});
