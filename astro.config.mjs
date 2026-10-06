import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Хостинг пока не выбран (Vercel / Cloudflare Pages) — конфиг от него не зависит.
export default defineConfig({
  site: 'https://irk.name',
  trailingSlash: 'always',
  integrations: [
    // служебные страницы в карту сайта не попадают
    sitemap({ filter: (page) => !page.includes('/predlozhit/spasibo/') && !page.endsWith('/404/') }),
  ],
});
