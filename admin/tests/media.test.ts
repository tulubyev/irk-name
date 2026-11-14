import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.ADMIN_SESSION_SECRET = 'x'.repeat(32);
process.env.ADMIN_STORE = 'fs';
const { createMediaStore, processImage } = await import('../src/media');
const { config } = await import('../src/config');
const local = (root: string) => createMediaStore({ ...config, store: 'github', mediaStore: 'fs', mediaRoot: root });

test('fs upload works with GitHub content and takes priority over S3 credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'irk-media-'));
  try {
    const store = createMediaStore({ ...config, store: 'github', mediaStore: 'fs', mediaRoot: root,
      s3: { ...config.s3, accessKeyId: 'unused', secretAccessKey: 'unused' } });
    assert.ok(store);
    const image = await processImage(await sharp({ create: { width: 1400, height: 1000, channels: 3, background: '#aaa' } }).png().toBuffer(), 'test-person');
    assert.equal(image.files.length, 3);
    assert.match(image.key, /^persons\/test-person-[a-f0-9]{10}\.webp$/);
    for (const [index, part] of image.files.entries()) {
      await store.put(part.key, part.body);
      assert.deepEqual(await readFile(join(root, part.key)), part.body);
      assert.equal((await sharp(join(root, part.key)).metadata()).width, [1200, 640, 160][index]);
    }
    assert.equal((await readdir(join(root, 'persons'))).length, 3);
    await store.put(image.key, image.files[0].body);
    assert.equal((await readdir(join(root, 'persons'))).length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unsafe paths and invalid slugs are rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'irk-media-'));
  try {
    const store = local(root)!;
    for (const key of ['../outside.webp', '/tmp/out.webp', 'persons/../../out.webp', 'persons/sub/out.webp', 'persons/x.svg', 'persons/..\\out.webp']) {
      await assert.rejects(() => store.put(key, Buffer.from('invalid')));
    }
    await assert.rejects(() => processImage(Buffer.from('invalid'), '../escape'));
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('symlinked persons directory cannot redirect writes outside media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'irk-media-'));
  const outside = await mkdtemp(join(tmpdir(), 'irk-outside-'));
  try {
    await symlink(outside, join(root, 'persons'));
    await assert.rejects(() => local(root)!.put('persons/test.webp', Buffer.from('invalid')));
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('disabled and automatic stores preserve previous behavior', () => {
  const noKeys = { ...config.s3, accessKeyId: '', secretAccessKey: '' };
  assert.equal(createMediaStore({ ...config, store: 'github', mediaStore: 'auto', s3: noKeys }), null);
  assert.equal(createMediaStore({ ...config, mediaStore: 'off' }), null);
  assert.ok(createMediaStore({ ...config, store: 'fs', mediaStore: 'auto', s3: noKeys }));
  assert.match(createMediaStore({ ...config, mediaStore: 's3', s3: { ...noKeys, accessKeyId: 'key', secretAccessKey: 'secret' } })!.describe(), /S3/);
  assert.throws(() => createMediaStore({ ...config, mediaStore: 's3', s3: noKeys }), /S3/);
  assert.throws(() => createMediaStore({ ...config, mediaStore: 'typo' as 'fs' }), /ADMIN_MEDIA_STORE/);
});

test('bad images and tiny images fail; valid images are not enlarged', async () => {
  await assert.rejects(() => processImage(Buffer.from('broken'), 'person'));
  const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(() => processImage(tiny, 'person'), /маленькое/);
  const small = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#fff' } }).png().toBuffer();
  const image = await processImage(small, 'person');
  for (const file of image.files) assert.equal((await sharp(file.body).metadata()).width, 120);
});

test('editor can replace main image, keep old image in gallery, and remove it', async () => {
  const { arrangeImages, existingRowsFromForm } = await import('../src/person');
  const old = { id: 'i0', key: 'persons/old.webp', alt: 'Old', author: 'Author', license: 'CC0' };
  const fresh = { id: 'n1', key: 'persons/new.webp', alt: 'New', author: 'Author', license: 'CC0' };
  const arranged = arrangeImages([old, fresh], 'n1');
  assert.equal(arranged.photo?.key, fresh.key);
  assert.equal(arranged.gallery[0].key, old.key);
  const remaining = existingRowsFromForm({ img_count: '2', img_del_0: 'on', img_key_1: fresh.key, img_alt_1: fresh.alt, img_author_1: fresh.author, img_license_1: fresh.license, main: 'i1' })!;
  assert.equal(arrangeImages(remaining.rows, remaining.mainId).photo?.key, fresh.key);
  assert.equal(remaining.rows.length, 1);
});


test('failed publication cleans up temporary files without removing existing paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'irk-media-'));
  try {
    await mkdir(join(root, 'persons', 'existing.webp'), { recursive: true });
    await assert.rejects(() => local(root)!.put('persons/existing.webp', Buffer.from('new')));
    assert.deepEqual(await readdir(join(root, 'persons')), ['existing.webp']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
