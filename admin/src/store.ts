// Хранилище записей. Источник истины — Markdown-файлы в git.
// github: читает и пишет через GitHub API (каждое сохранение — коммит в ветку), с проверкой sha.
// fs: локальные файлы — для разработки и тестов.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config';

export const PERSONS_DIR = 'src/content/persons';

export interface FileRef { slug: string; sha: string }
export interface FileData { content: string; sha: string }

export class ConflictError extends Error {
  constructor() {
    super('Запись изменилась с момента открытия (её правили в другом месте). Обновите страницу и повторите правку.');
  }
}

export interface Store {
  list(): Promise<FileRef[]>;
  get(slug: string): Promise<FileData | null>;
  /** sha = null — создать новый файл (ошибка, если уже существует). */
  put(slug: string, content: string, sha: string | null, message: string): Promise<string>;
  describe(): string;
}

const gitBlobSha = (content: string) => {
  const buf = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
};

class FsStore implements Store {
  private dir = join(config.fsRoot, PERSONS_DIR);
  describe() { return `локальные файлы (${this.dir})`; }
  async list() {
    const names = (await readdir(this.dir)).filter((n) => n.endsWith('.md'));
    return Promise.all(names.map(async (n) => ({ slug: n.slice(0, -3), sha: gitBlobSha(await readFile(join(this.dir, n), 'utf8')) })));
  }
  async get(slug: string) {
    try {
      const content = await readFile(join(this.dir, `${slug}.md`), 'utf8');
      return { content, sha: gitBlobSha(content) };
    } catch {
      return null;
    }
  }
  async put(slug: string, content: string, sha: string | null) {
    const current = await this.get(slug);
    if ((current?.sha ?? null) !== sha) throw new ConflictError();
    await writeFile(join(this.dir, `${slug}.md`), content, 'utf8');
    return gitBlobSha(content);
  }
}

class GitHubStore implements Store {
  private api = `${config.github.apiUrl}/repos/${config.github.repo}`;
  describe() { return `GitHub ${config.github.repo}@${config.github.branch}`; }
  private async req(path: string, init: RequestInit = {}) {
    const res = await fetch(this.api + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.github.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'irk-name-admin',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    return res;
  }
  async list() {
    const res = await this.req(`/git/trees/${encodeURIComponent(config.github.branch)}?recursive=1`);
    if (!res.ok) throw new Error(`GitHub: не удалось получить список файлов (${res.status})`);
    const { tree } = (await res.json()) as { tree: { path: string; sha: string; type: string }[] };
    const prefix = `${PERSONS_DIR}/`;
    return tree
      .filter((t) => t.type === 'blob' && t.path.startsWith(prefix) && t.path.endsWith('.md') && !t.path.slice(prefix.length).includes('/'))
      .map((t) => ({ slug: t.path.slice(prefix.length, -3), sha: t.sha }));
  }
  async get(slug: string) {
    const res = await this.req(`/contents/${PERSONS_DIR}/${slug}.md?ref=${encodeURIComponent(config.github.branch)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub: не удалось прочитать ${slug} (${res.status})`);
    const j = (await res.json()) as { content: string; sha: string };
    return { content: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
  }
  async put(slug: string, content: string, sha: string | null, message: string) {
    const res = await this.req(`/contents/${PERSONS_DIR}/${slug}.md`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: config.github.branch,
        ...(sha ? { sha } : {}),
      }),
    });
    // 409 — sha устарел; 422 без sha — файл уже существует
    if (res.status === 409 || (res.status === 422 && !sha)) throw new ConflictError();
    if (!res.ok) throw new Error(`GitHub: не удалось сохранить ${slug} (${res.status})`);
    const j = (await res.json()) as { content: { sha: string } };
    return j.content.sha;
  }
}

export const store: Store = config.store === 'fs' ? new FsStore() : new GitHubStore();
