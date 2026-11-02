#!/usr/bin/env node
// Writes public/admin/config.yml, the configuration of the content editor
// (Sveltia CMS, https://sveltiacms.app) served at /admin/. It is generated so it
// follows the site: languages and repository from site.config.yaml, members
// (for authors and instructors) from their ORCID records, and one field per
// interface text from content/translations/<default language>.yaml.
//
// Runs before `npm run dev` and `npm run build`; run it by hand with
// `npm run cms:config` after changing members, languages or translation keys.

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const readJson = (path) => read(path).then(JSON.parse).catch(() => null);

const config = parse(await read('site.config.yaml')) ?? {};
const languages = config.languages?.length ? config.languages : ['en'];
const defaultLang = languages[0];
if (!config.cms?.repo) throw new Error('Set cms.repo (owner/repository) in site.config.yaml');

// Members as options for authors and instructors: "Name" -> id.
const people = await Promise.all(
  (config.members ?? []).map(async (m) => {
    const person = (await readJson(`data/orcid/${String(m.orcid).trim()}.json`))?.person;
    const own = parse(await read(`data/people/${m.id}.yaml`).catch(() => '')) ?? {};
    return { label: own.profile?.name || person?.name || m.id, value: m.id };
  }),
);

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const languageOptions = [...new Set([...languages, 'en', 'ca', 'es'])].map((l) => ({ label: languageNames.of(l), value: l }));

// ---------- Interface texts ----------

const TEMPLATE_HINTS = {
  citations: 'Number of citations. {n} is replaced by the number.',
  reviews: 'Number of peer reviews. {n} is replaced by the number.',
  showing: '{n} and {total} are replaced by numbers.',
  jifTooltip: '{year} is replaced by the year.',
  jcrTooltip: '{year} is replaced by the year.',
  'news.notTranslated': '{language} is replaced by the name of the language the post is shown in.',
  'courses.ects': '{n} is replaced by the number of credits.',
  'courses.hours': '{n} is replaced by the number of hours.',
};

// "hIndex" -> "H index", "oaStatus" -> "Oa status"
const human = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (m, c) => ` ${c.toLowerCase()}`);

function textFields(obj, path = []) {
  return Object.entries(obj).map(([key, value]) => {
    const id = [...path, key].join('.');
    const hint = TEMPLATE_HINTS[id];
    const base = { name: key, label: human(key), i18n: true, required: false, ...(hint ? { hint } : {}) };
    if (value && typeof value === 'object' && ('one' in value || 'other' in value)) {
      return {
        ...base,
        widget: 'object',
        fields: [
          { name: 'one', label: 'Exactly one', widget: 'string', i18n: true, required: false },
          { name: 'other', label: 'Any other number', widget: 'string', i18n: true, required: false },
        ],
      };
    }
    if (value && typeof value === 'object') {
      return { ...base, widget: 'object', collapsed: true, fields: textFields(value, [...path, key]) };
    }
    return { ...base, widget: String(value ?? '').length > 70 ? 'text' : 'string' };
  });
}

const texts = parse(await read(`content/translations/${defaultLang}.yaml`)) ?? {};

// ---------- Collections ----------

const memberSelect = (name, label, hint) => ({
  name, label, widget: 'select', multiple: true, required: false, options: people, hint,
});
const guestList = (name, label) => ({
  name, label, widget: 'list', required: false, hint: 'People who are not members of the group.',
  field: { name: 'name', label: 'Name', widget: 'string' },
});

const news = {
  name: 'news',
  label: 'News & blog',
  label_singular: 'Post',
  description: 'News and blog posts. The latest three are shown on the home page.',
  folder: 'content/news',
  path: '{{slug}}/index',
  extension: 'yaml',
  format: 'yaml',
  // Images are kept in each post's folder.
  media_folder: '',
  public_folder: '',
  create: true,
  i18n: true,
  summary: '{{date}} · {{title}}',
  sortable_fields: ['date', 'title'],
  fields: [
    { name: 'title', label: 'Title', widget: 'string', i18n: true },
    { name: 'date', label: 'Date', widget: 'datetime', type: 'date' },
    {
      name: 'kind', label: 'Type', widget: 'select', default: 'news',
      options: [{ label: 'News', value: 'news' }, { label: 'Blog post', value: 'blog' }],
    },
    memberSelect('authors', 'Authors', 'Group members; they link to their profiles.'),
    guestList('guestAuthors', 'Other authors'),
    { name: 'image', label: 'Cover image', widget: 'image', required: false },
    { name: 'imageAlt', label: 'Cover image description', widget: 'string', i18n: true, required: false, hint: 'What the picture shows, for people who cannot see it.' },
    { name: 'summary', label: 'Summary', widget: 'text', i18n: true, required: false, hint: 'One or two sentences for the cards. If empty, the start of the text is used.' },
    { name: 'body', label: 'Text', widget: 'markdown', i18n: true, hint: 'An image followed by a line in italics shows the italics as its caption.' },
  ],
};

const courses = {
  name: 'courses',
  label: 'Courses',
  label_singular: 'Course',
  description: 'Courses the group currently teaches. Delete a course when it is no longer offered.',
  folder: 'content/courses',
  extension: 'yaml',
  format: 'yaml',
  create: true,
  i18n: true,
  summary: '{{title}}',
  sortable_fields: ['order', 'title'],
  fields: [
    { name: 'title', label: 'Title', widget: 'string', i18n: true },
    { name: 'order', label: 'Order', widget: 'number', value_type: 'int', required: false, hint: 'Courses are listed by this number, lowest first.' },
    {
      name: 'type', label: 'Type', widget: 'select', required: false,
      options: Object.entries(texts.courses?.types ?? {}).map(([value, label]) => ({ label, value })),
    },
    { name: 'summary', label: 'Description', widget: 'text', i18n: true, required: false },
    memberSelect('instructors', 'Instructors', 'Group members; they link to their profiles.'),
    guestList('guestInstructors', 'Other instructors'),
    { name: 'start', label: 'Start', widget: 'string', required: false, pattern: ['^\\d{4}(-\\d{2})?$', 'A year or year-month, e.g. 2027 or 2027-02'] },
    { name: 'end', label: 'End', widget: 'string', required: false, pattern: ['^\\d{4}(-\\d{2})?$', 'A year or year-month, e.g. 2027 or 2027-06'] },
    { name: 'schedule', label: 'Schedule', widget: 'string', i18n: true, required: false, hint: 'Free text, e.g. "Tuesdays and Thursdays, 16:00–18:00".' },
    {
      name: 'format', label: 'Format', widget: 'select', required: false,
      options: Object.entries(texts.courses?.formats ?? {}).map(([value, label]) => ({ label, value })),
    },
    { name: 'languages', label: 'Taught in', widget: 'select', multiple: true, required: false, options: languageOptions },
    { name: 'ects', label: 'ECTS credits', widget: 'number', value_type: 'float', required: false },
    { name: 'hours', label: 'Hours', widget: 'number', value_type: 'int', required: false, hint: 'Shown when there are no ECTS credits.' },
    { name: 'institution', label: 'Institution', widget: 'string', i18n: true, required: false },
    { name: 'url', label: 'Link', widget: 'string', required: false, hint: 'Information or enrolment page.' },
  ],
};

const translations = {
  name: 'translations',
  label: 'Translations',
  description: 'Texts of the website interface (menus, labels, buttons) in every language.',
  i18n: true,
  files: [
    {
      name: 'interface',
      label: 'Interface texts',
      file: 'content/translations/{{locale}}.yaml',
      format: 'yaml',
      i18n: true,
      fields: textFields(texts),
    },
  ],
};

// The published site, when building for GitHub Pages (the workflow sets these),
// for the editor's "view site" link; otherwise the editor uses its own origin.
const basePath = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
const siteUrl = process.env.SITE_URL ? `${process.env.SITE_URL.replace(/\/$/, '')}${basePath}/` : null;
const groupName = typeof config.group?.name === 'object' ? config.group.name[defaultLang] : config.group?.name;

const cms = {
  // Branding, to match the site (the colours and fonts are in public/admin/index.html).
  app_title: groupName ? `${groupName} · Content editor` : 'Content editor',
  logo: { src: `${basePath}/admin/logo.png` },
  ...(siteUrl ? { site_url: siteUrl } : {}),
  backend: {
    name: 'github',
    repo: config.cms.repo,
    branch: config.cms.branch ?? 'main',
    // "Sign In with GitHub" needs an OAuth client (e.g. Sveltia CMS Authenticator,
    // https://github.com/sveltia/sveltia-cms-auth); until cms.authUrl is set,
    // only signing in with an access token is offered.
    ...(config.cms.authUrl ? { base_url: config.cms.authUrl } : { auth_methods: ['token'] }),
  },
  media_folder: '/public/media',
  public_folder: '/media',
  i18n: { structure: 'single_file', locales: languages, default_locale: defaultLang, initial_locales: 'all' },
  collections: [news, courses, translations],
};

await mkdir(new URL('public/admin/fonts/', root), { recursive: true });
// The site's typeface, for the editor and its previews (not committed: copied here).
for (const weight of ['Regular', 'Italic', 'Bold', 'Light']) {
  await copyFile(new URL(`src/assets/fonts/UIBsans-${weight}.ttf`, root), new URL(`public/admin/fonts/UIBsans-${weight}.ttf`, root));
}
await writeFile(
  new URL('public/admin/config.yml', root),
  '# yaml-language-server: $schema=https://unpkg.com/@sveltia/cms/schema/sveltia-cms.json\n' +
    '# GENERATED by scripts/cms-config.mjs from site.config.yaml, the members and\n' +
    '# content/translations/: edit those (or the script) instead of this file.\n' +
    stringify(cms, { lineWidth: 0 }),
);
console.log(`Wrote public/admin/config.yml: ${languages.join(', ')}; ${people.length} members; ${JSON.stringify(texts).match(/":"/g)?.length ?? 0} interface texts.`);
