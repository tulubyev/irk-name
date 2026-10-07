import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { SPHERES, ERAS, CONNECTIONS, DISTRICTS } from '../../src/lib/taxonomy';
import { placesToText, sourcesToText, imagesOf, NEW_SLOTS, MAX_UPLOAD_BYTES, type PersonData } from './person';
import { mediaUrl, sizedKey, media } from './media';
import { FIELDS, RETENTION_DAYS, type Suggestion } from './suggestions';

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

const CSS = `
fieldset.photos{border:1px solid var(--border);border-radius:.5rem;padding:.2rem 1rem 1rem;margin:1.2rem 0;background:#fff}fieldset.photos legend{font-weight:600;padding:0 .4rem}
.img{display:grid;grid-template-columns:7rem 1fr;gap:1rem;padding:.8rem 0;border-bottom:1px solid var(--border)}.img:last-of-type{border-bottom:0}.img img{width:100%;height:auto;border-radius:.3rem;background:#eee;display:block}
.img .f{display:grid;grid-template-columns:1fr 1fr;gap:.2rem .8rem}.img .f label{margin:.3rem 0 .1rem;font-size:.85rem}.img .f .w{grid-column:1/-1}@media(max-width:40rem){.img{grid-template-columns:1fr}.img .f{grid-template-columns:1fr}}
.inline-check{display:flex;gap:.3rem;align-items:center;font-weight:400;margin:.3rem 1rem .3rem 0}.snippet{font-family:ui-monospace,monospace;font-size:.8rem}
details.slot{margin:.6rem 0;border:1px dashed var(--border);border-radius:.4rem;padding:.4rem .8rem}details.slot summary{cursor:pointer;font-weight:600}

:root{--bg:#fbf8f3;--fg:#1f1b16;--muted:#6a6258;--accent:#7a2e2e;--border:#e4ddd0;--warn:#fff4d6;--ok:#e3f3e6;--err:#fde2e2;color-scheme:light}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;gap:1rem;align-items:center;padding:.7rem 1rem;border-bottom:1px solid var(--border);background:#fff;flex-wrap:wrap}
header a{color:var(--fg);text-decoration:none;font-weight:600}header .sp{flex:1}
main{max-width:70rem;margin:0 auto;padding:1rem}
a{color:var(--accent)}h1{font-size:1.4rem;margin:.5rem 0 1rem}
table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:.4rem .5rem;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
.badge{font-size:.75rem;border-radius:.3rem;padding:.05rem .4rem;white-space:nowrap}.warn{background:var(--warn)}.ok{background:var(--ok)}.arch{background:#e8e4ef}
form.inline{display:inline}button,.btn{font:inherit;border:1px solid var(--border);background:#fff;border-radius:.4rem;padding:.3rem .7rem;cursor:pointer;color:var(--fg);text-decoration:none;display:inline-block}
button.primary,.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
label{display:block;font-weight:600;margin:.8rem 0 .2rem}.hint{font-weight:400;color:var(--muted);font-size:.85rem}
input[type=text],input[type=url],input[type=password],input[type=search],input[type=number],select,textarea{width:100%;font:inherit;padding:.4rem .5rem;border:1px solid var(--border);border-radius:.4rem;background:#fff}
textarea{min-height:6rem;font-family:ui-monospace,monospace;font-size:.85rem}
.checks{display:flex;flex-wrap:wrap;gap:.3rem 1rem}.checks label{font-weight:400;margin:0;display:flex;gap:.3rem;align-items:center}
.row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem}@media(max-width:40rem){.row{grid-template-columns:1fr}}
.msg{padding:.6rem .8rem;border-radius:.4rem;margin:0 0 1rem}.msg.ok{background:var(--ok)}.msg.err{background:var(--err)}
.toolbar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem}.toolbar input{max-width:20rem}
.muted{color:var(--muted)}.actions{display:flex;gap:.3rem;flex-wrap:wrap}
`;

export function page(title: string, body: H, opts: { authed?: boolean } = {}): H {
  return html`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} — админка irk.name</title><style>${raw(CSS)}</style></head>
<body><header><a href="/admin/">irk.name · админка</a><span class="sp"></span>
${opts.authed ? html`<a href="/admin/predlozheniya">Предложения</a><a href="/admin/new">+ Новая запись</a><a href="/" target="_blank" rel="noopener">Сайт ↗</a>
<form class="inline" method="post" action="/admin/logout"><button>Выйти</button></form>` : ''}
</header><main>${body}</main></body></html>`;
}

export function loginPage(error?: string): H {
  return page('Вход', html`<h1>Вход</h1>
${error ? html`<p class="msg err">${error}</p>` : ''}
<form method="post" action="/admin/login" style="max-width:22rem">
<label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<p><button class="primary">Войти</button></p></form>`);
}

export interface Row { slug: string; sha: string; name: string; years: string; status: string; archived: boolean; error?: string }

export function listPage(rows: Row[], q: string, show: string, flash: string | undefined, storeDesc: string): H {
  const filters: [string, string][] = [['all', 'Все'], ['published', 'Опубликованные'], ['archived', 'Архив'], ['needs-check', 'Требуют проверки'], ['verified', 'Проверены']];
  return page('Записи', html`<h1>Записи (${rows.length})</h1>
${flash ? html`<p class="msg ok">${flash}</p>` : ''}
<form class="toolbar" method="get" action="/admin/">
<input type="search" name="q" value="${q}" placeholder="Поиск по имени или slug">
<select name="show">${filters.map(([v, l]) => html`<option value="${v}" ${v === show ? 'selected' : ''}>${l}</option>`)}</select>
<button>Показать</button><span class="muted">Хранилище: ${storeDesc}</span></form>
<table><thead><tr><th>Имя</th><th>Годы</th><th>Статус</th><th>Действия</th></tr></thead><tbody>
${rows.map((r) => html`<tr>
<td><a href="/admin/p/${r.slug}">${r.name}</a><br><span class="muted">${r.slug}</span>${r.error ? html`<br><span class="badge" style="background:var(--err)">${r.error}</span>` : ''}</td>
<td>${r.years}</td>
<td>${r.status === 'verified' ? html`<span class="badge ok">проверено</span>` : html`<span class="badge warn">требует проверки</span>`}
${r.archived ? html` <span class="badge arch">архив</span>` : ''}</td>
<td class="actions">
<form class="inline" method="post" action="/admin/p/${r.slug}/toggle"><input type="hidden" name="sha" value="${r.sha}"><input type="hidden" name="field" value="archived">
<button>${r.archived ? 'Опубликовать' : 'В архив'}</button></form>
<form class="inline" method="post" action="/admin/p/${r.slug}/toggle"><input type="hidden" name="sha" value="${r.sha}"><input type="hidden" name="field" value="status">
<button>${r.status === 'verified' ? 'Снять «проверено»' : 'Отметить «проверено»'}</button></form>
${r.archived ? '' : html`<a class="btn" href="/persona/${r.slug}/" target="_blank" rel="noopener">На сайте ↗</a>`}
</td></tr>`)}
</tbody></table>`, { authed: true });
}

export function editPage(opts: {
  slug?: string; sha?: string; data: Partial<PersonData> & Record<string, unknown>; body: string; errors?: string[]; flash?: string; isNew?: boolean;
}): H {
  const d = opts.data;
  const has = (arr: unknown, v: string) => Array.isArray(arr) && arr.includes(v);
  const action = opts.isNew ? '/admin/new' : `/admin/p/${opts.slug}`;
  return page(opts.isNew ? 'Новая запись' : String(d.name ?? opts.slug), html`
<p><a href="/admin/">← Все записи</a></p>
<h1>${opts.isNew ? 'Новая запись' : d.name}</h1>
${opts.flash ? html`<p class="msg ok">${opts.flash}</p>` : ''}
${opts.errors?.length ? html`<div class="msg err"><strong>Запись не сохранена:</strong><ul>${opts.errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
<form method="post" action="${action}" enctype="multipart/form-data">
${opts.isNew
  ? html`<label for="slug">Адрес (slug) <span class="hint">— транслит имени латиницей через дефис, например ivan-ivanov; потом не меняется</span></label>
<input type="text" id="slug" name="slug" value="${opts.slug ?? ''}" required pattern="[a-z0-9]+(-[a-z0-9]+)*">`
  : html`<input type="hidden" name="sha" value="${opts.sha}"><p class="muted">Адрес: /persona/${opts.slug}/</p>`}
<label for="name">Имя</label><input type="text" id="name" name="name" value="${d.name ?? ''}" required>
<div class="row">
<div><label for="birthYear">Год рождения</label><input type="number" id="birthYear" name="birthYear" value="${d.birthYear ?? ''}"></div>
<div><label for="deathYear">Год смерти</label><input type="number" id="deathYear" name="deathYear" value="${d.deathYear ?? ''}"></div>
<div><label for="era">Век</label><select id="era" name="era">${Object.entries(ERAS).map(([k, l]) => html`<option value="${k}" ${d.era === k ? 'selected' : ''}>${l}</option>`)}</select></div>
</div>
<div class="checks" style="margin-top:.5rem"><label><input type="checkbox" name="datesApproximate" ${d.datesApproximate ? 'checked' : ''}> годы приблизительные (≈)</label></div>
<label>Виды деятельности</label><div class="checks">${Object.entries(SPHERES).map(([k, l]) => html`<label><input type="checkbox" name="spheres" value="${k}" ${has(d.spheres, k) ? 'checked' : ''}> ${l}</label>`)}</div>
<label for="summary">Кратко <span class="hint">— до 300 символов, показывается в карточке</span></label><textarea id="summary" name="summary" maxlength="300" style="min-height:4rem;font-family:inherit">${d.summary ?? ''}</textarea>
<label>Связь с регионом</label><div class="checks">${Object.entries(CONNECTIONS).map(([k, l]) => html`<label><input type="checkbox" name="connection" value="${k}" ${has(d.connection, k) ? 'checked' : ''}> ${l}</label>`)}</div>
<label for="connectionNote">Комментарий о связи</label><textarea id="connectionNote" name="connectionNote" style="min-height:4rem;font-family:inherit">${d.connectionNote ?? ''}</textarea>
<label for="places">Места <span class="hint">— одно на строку: Название | Населённый пункт | район | широта | долгота. Районы: ${Object.keys(DISTRICTS).join(', ')}</span></label>
<textarea id="places" name="places">${placesToText(d.places as PersonData['places'])}</textarea>
<label for="links">Подробнее о жизни и деятельности <span class="hint">— статьи, книги, музейные страницы о человеке. Одна строка: Название | https://ссылка. Необязательно.</span></label>
<textarea id="links" name="links">${sourcesToText(d.links as PersonData['links'])}</textarea>
<label for="sources">Источники <span class="hint">— одна строка: Название | https://ссылка. Минимум один.</span></label>
<textarea id="sources" name="sources" required>${sourcesToText(d.sources as PersonData['sources'])}</textarea>
<label for="body">Статья (Markdown) <span class="hint">— развёрнутая биография; показывается на странице персоны под кратким описанием</span></label><textarea id="body" name="body" style="min-height:12rem">${opts.body}</textarea>
${photosSection(d, opts.isNew === true)}
<div class="row">
<div><label for="status">Проверка</label><select id="status" name="status">
<option value="needs-check" ${d.status !== 'verified' ? 'selected' : ''}>Требует проверки</option>
<option value="verified" ${d.status === 'verified' ? 'selected' : ''}>Проверено по источникам</option></select></div>
<div><label>Публикация</label><div class="checks"><label><input type="checkbox" name="archived" ${d.archived ? 'checked' : ''}> в архиве (не показывать на сайте)</label></div></div>
</div>
<p style="margin-top:1.5rem"><button class="primary">Сохранить</button> <a href="/admin/">Отмена</a></p>
</form>`, { authed: true });
}

const imgField = (label: string, name: string, value: string | undefined, opts: { wide?: boolean; required?: boolean; hint?: string; type?: string } = {}) =>
  html`<div class="${opts.wide ? 'w' : ''}"><label for="${name}">${label}${opts.hint ? html` <span class="hint">— ${opts.hint}</span>` : ''}</label><input type="${opts.type ?? 'text'}" id="${name}" name="${name}" value="${value ?? ''}" ${opts.required ? 'required' : ''}></div>`;

function photosSection(d: Record<string, unknown>, isNew: boolean): H {
  if (isNew) return html`<fieldset class="photos"><legend>Фотографии</legend><p class="muted">Фото добавляются после создания записи: сохраните её, и на этой странице появится загрузка.</p></fieldset>`;
  const imgs = imagesOf(d);
  const slot = (n: number) => html`<details class="slot" ${n === 1 ? 'open' : ''}><summary>Новое фото ${n}</summary>
<label for="new_file_${n}">Файл <span class="hint">— JPEG, PNG, WebP или TIFF до ${MAX_UPLOAD_BYTES / 1024 / 1024} МБ; сервер сам сделает три размера</span></label>
<input type="file" id="new_file_${n}" name="new_file_${n}" accept="image/jpeg,image/png,image/webp,image/tiff">
<div class="f" style="display:grid;grid-template-columns:1fr 1fr;gap:.2rem .8rem">
${imgField('Описание для скринридера', `new_alt_${n}`, '', { wide: true, hint: 'кто или что на снимке' })}
${imgField('Подпись под фото', `new_caption_${n}`, '', { wide: true, hint: 'необязательно, например «Н. Ф. Насонов, 1910-е»' })}
${imgField('Автор', `new_author_${n}`, '', { hint: 'фотограф, студия или «из семейного архива»' })}
${imgField('Лицензия или условия', `new_license_${n}`, '', { hint: 'например «Публикуется с разрешения владельца архива»' })}
${imgField('Страница лицензии (URL)', `new_licenseUrl_${n}`, '', { type: 'url' })}
${imgField('Источник (URL)', `new_sourceUrl_${n}`, '', { type: 'url', hint: 'если есть в интернете' })}
</div>
<label class="inline-check"><input type="radio" name="main" value="n${n}"> сделать главным (миниатюра в карточке)</label></details>`;
  return html`<fieldset class="photos"><legend>Фотографии</legend>
<p class="muted">Главное фото показывается в карточке и вверху страницы, остальные идут галереей под статьёй. Чтобы поставить снимок внутри статьи, скопируйте строку из поля «В статью» в текст выше. Всё применяется кнопкой «Сохранить» внизу.</p>
<input type="hidden" name="img_count" value="${imgs.length}">
${imgs.map((img, i) => html`<div class="img"><div><img src="${mediaUrl(sizedKey(img.key, '-160'))}" alt="" loading="lazy"></div><div>
<div class="f">
${imgField('Описание для скринридера', `img_alt_${i}`, img.alt, { wide: true, required: true })}
${imgField('Подпись под фото', `img_caption_${i}`, img.caption, { wide: true })}
${imgField('Автор', `img_author_${i}`, img.author, { required: true })}
${imgField('Лицензия или условия', `img_license_${i}`, img.license, { required: true })}
${imgField('Страница лицензии (URL)', `img_licenseUrl_${i}`, img.licenseUrl, { type: 'url' })}
${imgField('Источник (URL)', `img_sourceUrl_${i}`, img.sourceUrl, { type: 'url' })}
</div>
<input type="hidden" name="img_key_${i}" value="${img.key}">
<label for="snip_${i}" style="font-size:.85rem">В статью <span class="hint">— скопируйте и вставьте в текст</span></label>
<input type="text" id="snip_${i}" class="snippet" readonly value="![${img.alt.replace(/[\[\]]/g, '')}](${mediaUrl(sizedKey(img.key, '-640'))})">
<label class="inline-check"><input type="radio" name="main" value="i${i}" ${i === 0 ? 'checked' : ''}> главное</label>
<label class="inline-check"><input type="checkbox" name="img_del_${i}"> убрать из записи <span class="hint">(файл в хранилище остаётся)</span></label>
</div></div>`)}
${media
  ? html`<h3 style="margin:1rem 0 .3rem;font-size:1rem">Добавить фото</h3>${NEW_SLOTS.map(slot)}<p class="muted">Хранилище: ${media.describe()}.</p>`
  : html`<p class="msg err">Загрузка фото отключена: на сервере не заданы ключи S3 (S3_ACCESS_KEY_ID и S3_SECRET_ACCESS_KEY, см. DEPLOY.md).</p>`}
</fieldset>`;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Irkutsk', dateStyle: 'short', timeStyle: 'short' });

export function inboxPage(items: Suggestion[], flash?: string): H {
  return page('Предложения', html`<h1>Предложения посетителей (${items.length})</h1>
${flash ? html`<p class="msg ok">${flash}</p>` : ''}
<p class="muted">Хранятся только на сервере и удаляются автоматически через ${RETENTION_DAYS} дней. Рассмотренные удаляйте сразу. Контакты отправителей не переносите в записи справочника.</p>
${items.length ? html`<table><thead><tr><th>Дата</th><th>Персона</th><th>Чем известен</th></tr></thead><tbody>
${items.map((s) => html`<tr><td style="white-space:nowrap">${fmtDate(s.createdAt)}</td>
<td><a href="/admin/predlozheniya/${s.id}">${s.personName}</a>${s.years ? html`<br><span class="muted">${s.years}</span>` : ''}</td>
<td>${s.about.length > 160 ? s.about.slice(0, 160) + '…' : s.about}</td></tr>`)}
</tbody></table>` : html`<p>Новых предложений нет.</p>`}`, { authed: true });
}

export function suggestionPage(s: Suggestion): H {
  const rows = (Object.keys(FIELDS) as (keyof typeof FIELDS)[]).filter((k) => s[k]);
  return page(s.personName, html`<p><a href="/admin/predlozheniya">← Все предложения</a></p>
<h1>${s.personName}</h1><p class="muted">Получено ${fmtDate(s.createdAt)}</p>
<table>${rows.map((k) => html`<tr><th style="width:12rem">${FIELDS[k][0]}</th><td style="white-space:pre-wrap">${s[k]}</td></tr>`)}</table>
<div class="actions" style="margin-top:1rem">
<a class="btn primary" href="/admin/new?name=${encodeURIComponent(s.personName)}">Создать запись</a>
<form class="inline" method="post" action="/admin/predlozheniya/${s.id}/delete"><button>Удалить предложение</button></form></div>
<p class="muted">«Создать запись» переносит только имя персоны. Факты переносите вручную после проверки по источникам.</p>`, { authed: true });
}
