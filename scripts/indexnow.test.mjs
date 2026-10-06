import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findKey, urlsFromChanges, urlsFromSitemap, submit, ENDPOINTS } from './indexnow.mjs';

test('urlsFromChanges: записи персон → страницы, прочее игнорируется', () => {
  const urls = urlsFromChanges(['src/content/persons/anton-chekhov.md', 'src/styles/global.css', 'src/content/persons/nit-romanov.md', 'README.md']);
  assert.deepEqual(urls.sort(), ['https://irk.name/', 'https://irk.name/persona/anton-chekhov/', 'https://irk.name/persona/nit-romanov/']);
  assert.deepEqual(urlsFromChanges(['src/pages/index.astro']), []);
});

test('urlsFromSitemap берёт только адреса сайта', () => {
  const xml = '<urlset><url><loc>https://irk.name/</loc></url><url><loc>https://other.example/x</loc></url></urlset>';
  assert.deepEqual(urlsFromSitemap(xml), ['https://irk.name/']);
});

test('findKey: ровно один ключ', () => {
  const d = mkdtempSync(join(tmpdir(), 'inow-'));
  writeFileSync(join(d, 'robots.txt'), '');
  assert.throws(() => findKey(d));
  writeFileSync(join(d, '3af54e8422e1738ac247872e4914739d.txt'), '3af54e8422e1738ac247872e4914739d');
  assert.equal(findKey(d), '3af54e8422e1738ac247872e4914739d');
});

test('submit: тело запроса и учёт кодов ответа', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { status: 202 }; };
  const ok = await submit(['https://irk.name/a/'], 'k'.repeat(32), { fetchImpl, log: () => {} });
  assert.equal(ok, 1);
  assert.deepEqual(ENDPOINTS, ['https://yandex.com/indexnow']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { host: 'irk.name', key: 'k'.repeat(32), keyLocation: `https://irk.name/${'k'.repeat(32)}.txt`, urlList: ['https://irk.name/a/'] });
});
