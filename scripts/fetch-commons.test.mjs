// Тест fetch-commons.mjs без сети: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, isFreeLicense, parseImageInfo, mapPages, setPhotoInFrontmatter, photoBlock } from './fetch-commons.mjs';

test('stripHtml убирает теги и раскрывает сущности', () => {
  assert.equal(stripHtml('<a href="//x">Karl&nbsp;Bulla</a> <span>(1855&#8211;1929)</span>'), 'Karl Bulla (1855–1929)');
  assert.equal(stripHtml('a<br/>b &amp; c &#x41;'), 'a b & c A');
  assert.equal(stripHtml(undefined), '');
});

test('isFreeLicense — белый список', () => {
  for (const ok of ['Public domain', 'PD-RU-exempt', 'PD-old-100', 'CC0', 'CC0 1.0', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC BY-SA 3.0 de', 'CC BY 2.0', 'CC BY-SA 4.0'])
    assert.ok(isFreeLicense(ok), ok);
  for (const bad of ['', undefined, 'CC BY-NC 4.0', 'CC BY-NC-SA 2.0', 'CC BY-ND 3.0', 'GFDL', 'Attribution', 'Fair use', 'All rights reserved', 'CC BY-SA 4.0; GFDL extra'])
    assert.ok(!isFreeLicense(bad), String(bad));
});

const info = (meta, extra = {}) => ({
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg',
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1280px-X.jpg',
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
  mime: 'image/jpeg',
  sha1: 'abc',
  extmetadata: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { value: v }])),
  ...extra,
});

test('parseImageInfo: автор без HTML, лицензия, ссылки', () => {
  const m = parseImageInfo(info({
    Artist: '<a href="https://commons.wikimedia.org/wiki/User:Foo">Foo Bar</a>',
    LicenseShortName: 'CC BY-SA 4.0',
    LicenseUrl: '//creativecommons.org/licenses/by-sa/4.0',
    ImageDescription: '<div lang="ru">Портрет</div>',
  }));
  assert.equal(m.author, 'Foo Bar');
  assert.equal(m.license, 'CC BY-SA 4.0');
  assert.equal(m.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0');
  assert.equal(m.description, 'Портрет');
  assert.equal(m.sourceUrl, 'https://commons.wikimedia.org/wiki/File:X.jpg');
  assert.equal(m.free, true);
});

test('parseImageInfo: PD без автора и ссылки на лицензию; NonFree отсекается', () => {
  const pd = parseImageInfo(info({ LicenseShortName: 'Public domain' }));
  assert.equal(pd.author, 'Автор неизвестен');
  assert.equal(pd.licenseUrl, undefined);
  assert.equal(pd.free, true);
  assert.equal(parseImageInfo(info({ LicenseShortName: 'CC BY 4.0', NonFree: 'true' })).free, false);
  assert.equal(parseImageInfo(info({ LicenseShortName: 'CC BY-NC 2.0' })).free, false);
  assert.equal(parseImageInfo(info({})).free, false);
});

test('mapPages сопоставляет нормализованные имена и редиректы', () => {
  const json = {
    query: {
      normalized: [{ from: 'File:a_b.jpg', to: 'File:A b.jpg' }],
      redirects: [{ from: 'File:Old.jpg', to: 'File:New.jpg' }],
      pages: [{ title: 'File:A b.jpg', imageinfo: [{}] }, { title: 'File:New.jpg', imageinfo: [{}] }, { title: 'File:Gone.jpg', missing: true }],
    },
  };
  const m = mapPages(['File:a_b.jpg', 'File:Old.jpg', 'File:Gone.jpg', 'File:None.jpg'], json);
  assert.equal(m.get('File:a_b.jpg').title, 'File:A b.jpg');
  assert.equal(m.get('File:Old.jpg').title, 'File:New.jpg');
  assert.equal(m.get('File:Gone.jpg').missing, true);
  assert.equal(m.get('File:None.jpg'), undefined);
});

const photo = {
  key: 'persons/ivan.webp', alt: 'Портрет «Ивана»', author: 'Карл Булла', license: 'Public domain',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Ivan.jpg',
};
const md = `---
name: "Иван"
spheres: ["pisatel"]
places:
  - name: "Иркутск"
sources:
  - title: "Источник"
    url: "https://example.org"
status: needs-check
---
Текст.
`;

test('setPhotoInFrontmatter вставляет блок перед sources и не трогает остальное', () => {
  const { text, changed, existing } = setPhotoInFrontmatter(md, photo);
  assert.ok(changed);
  assert.equal(existing, undefined);
  assert.ok(text.includes(`  - name: "Иркутск"\n${photoBlock(photo)}\nsources:\n`));
  assert.ok(text.includes('alt: "Портрет «Ивана»"'));
  assert.ok(!text.includes('licenseUrl'));
  assert.equal(text.replace(`${photoBlock(photo)}\n`, ''), md);
  assert.ok(text.endsWith('---\nТекст.\n'));
});

test('setPhotoInFrontmatter идемпотентен и заменяет старый блок', () => {
  const once = setPhotoInFrontmatter(md, photo).text;
  const twice = setPhotoInFrontmatter(once, photo);
  assert.equal(twice.changed, false);
  assert.equal(twice.existing, photo.sourceUrl);

  const updated = setPhotoInFrontmatter(once, { ...photo, license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0' });
  assert.ok(updated.changed);
  assert.equal(updated.text.match(/^photo:/gm).length, 1);
  assert.ok(updated.text.includes('  licenseUrl: "https://creativecommons.org/licenses/by/4.0"\n  sourceUrl: "https://commons.wikimedia.org/wiki/File:Ivan.jpg"\nsources:'));
});

test('setPhotoInFrontmatter: блок в конце, кавычки и CRLF', () => {
  const tail = '---\r\nname: "X"\r\nstatus: verified\r\n---\r\nТело\r\n';
  const { text } = setPhotoInFrontmatter(tail, { ...photo, author: 'A "B" \\ C' });
  assert.ok(text.includes('status: verified\r\nphoto:\r\n'));
  assert.ok(text.includes('  author: "A \\"B\\" \\\\ C"\r\n'));
  assert.ok(text.endsWith('---\r\nТело\r\n'));
  assert.throws(() => setPhotoInFrontmatter('нет фронтматтера', photo));
});

test('fetchAll + applyAll на моках: фильтр, webp, lock, идемпотентность', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const sharp = (await import('sharp')).default;
  const { fetchAll, applyAll } = await import('./fetch-commons.mjs');

  const dir = await mkdtemp(join(tmpdir(), 'commons-'));
  const personsDir = join(dir, 'persons');
  await mkdir(personsDir);
  await writeFile(join(personsDir, 'ivan.md'), md);
  const jpg = await sharp({ create: { width: 2000, height: 2500, channels: 3, background: '#a33' } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 500, height: 600, channels: 4, background: '#33a' } }).png().toBuffer();

  const api = {
    query: {
      pages: [
        { title: 'File:Ivan.jpg', imageinfo: [info({ Artist: '<b>Карл Булла</b>', LicenseShortName: 'Public domain' }, { sha1: 's1', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ivan.jpg' })] },
        { title: 'File:Nc.jpg', imageinfo: [info({ LicenseShortName: 'CC BY-NC 4.0' })] },
        { title: 'File:Gone.jpg', missing: true },
        { title: 'File:Arms.svg', imageinfo: [info({ LicenseShortName: 'Public domain' }, { mime: 'image/svg+xml', url: 'https://x/Arms.svg', thumburl: 'https://x/500px-Arms.svg.png' })] },
      ],
    },
  };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    assert.match(opts.headers['User-Agent'], /^irk-name-media\/1\.0 \(https:\/\/irk\.name/);
    const u = String(url);
    if (u.includes('api.php')) return new Response(JSON.stringify(api));
    if (u.endsWith('.svg')) return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>');
    return new Response(u.includes('Arms') ? png : jpg);
  };
  process.env.COMMONS_DELAY_MS = '0';
  const log = console.log; console.log = () => {};
  try {
    const opts = {
      manifest: {
        persons: [
          { slug: 'ivan', file: 'File:Ivan.jpg', alt: 'Портрет Ивана' },
          { slug: 'nc', file: 'File:Nc.jpg', alt: '-' },
          { slug: 'gone', file: 'File:Gone.jpg', alt: '-' },
        ],
        heraldry: [{ key: 'irkutsk', file: 'File:Arms.svg', alt: 'Герб' }],
      },
      lockPath: join(dir, 'lock.json'), mediaDir: join(dir, 'media'), personsDir,
    };
    const s1 = await fetchAll(opts);
    assert.deepEqual([s1.ok, s1.downloaded, s1.rejected, s1.missing], [2, 2, 1, 1]);
    const big = await sharp(join(dir, 'media/persons/ivan.webp')).metadata();
    const small = await sharp(join(dir, 'media/persons/ivan-640.webp')).metadata();
    assert.deepEqual([big.format, big.width, small.width], ['webp', 1200, 640]);
    assert.equal((await sharp(join(dir, 'media/persons/ivan-160.webp')).metadata()).width, 160);
    assert.equal((await sharp(join(dir, 'media/heraldry/irkutsk.webp')).metadata()).height, 128);
    assert.ok((await stat(join(dir, 'media/heraldry/irkutsk.svg'))).size > 0);

    const lock = JSON.parse(await readFile(opts.lockPath, 'utf8'));
    assert.deepEqual(Object.keys(lock.persons), ['ivan']);
    assert.equal(lock.persons.ivan.author, 'Карл Булла');
    assert.equal(lock.persons.ivan.key, 'persons/ivan.webp');
    assert.equal(lock.heraldry.irkutsk.svg, true);

    calls.length = 0;
    const s2 = await fetchAll(opts);
    assert.equal(s2.unchanged, 2);
    assert.ok(calls.every((u) => u.includes('api.php')), 'повторный запуск не скачивает файлы');

    await applyAll(opts);
    const out = await readFile(join(personsDir, 'ivan.md'), 'utf8');
    assert.ok(out.includes('photo:\n  key: "persons/ivan.webp"\n  alt: "Портрет Ивана"\n  author: "Карл Булла"\n  license: "Public domain"\n'));
    await applyAll(opts);
    assert.equal(await readFile(join(personsDir, 'ivan.md'), 'utf8'), out);
  } finally {
    globalThis.fetch = realFetch;
    console.log = log;
  }
});
