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
// "Courses are listed by this number, lowest first."
const orderField = (hint) => ({ name: 'order', label: 'Order', widget: 'number', value_type: 'int', required: false, hint });
// A list of { label, url }; `i18n`: a list per language, so the texts can be translated.
const linksField = ({ hint, example, i18n = false }) => ({
  name: 'links', label: 'Links', widget: 'list', ...(i18n ? { i18n: true } : {}), required: false, label_singular: 'Link',
  hint,
  summary: '{{label}} · {{url}}',
  fields: [
    { name: 'label', label: 'Text', widget: 'string', required: false, hint: `E.g. "${example}". If empty, the site name is shown.` },
    { name: 'url', label: 'URL', widget: 'string', pattern: ['^(https?://|mailto:)', 'A full address starting with https:// (or mailto:)'] },
  ],
});
// Options of a select from interface texts, e.g. texts.courses.types: { master: "Master's", … }.
const optionsFrom = (labels) => Object.entries(labels ?? {}).map(([value, label]) => ({ label, value }));
// A collection of entries in content/<name>/<slug>.yaml, every language in one file.
const folderCollection = ({ name, label, label_singular, description, ...rest }) => ({
  name, label, label_singular, description,
  folder: `content/${name}`,
  extension: 'yaml',
  format: 'yaml',
  create: true,
  i18n: true,
  ...rest,
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

const courses = folderCollection({
  name: 'courses',
  label: 'Courses',
  label_singular: 'Course',
  description: 'Courses the group currently teaches. Delete a course when it is no longer offered.',
  summary: '{{title}}',
  sortable_fields: ['order', 'title'],
  fields: [
    { name: 'title', label: 'Title', widget: 'string', i18n: true },
    orderField('Courses are listed by this number, lowest first.'),
    {
      name: 'type', label: 'Type', widget: 'select', required: false,
      options: optionsFrom(texts.courses?.types),
    },
    { name: 'summary', label: 'Description', widget: 'text', i18n: true, required: false },
    memberSelect('instructors', 'Instructors', 'Group members; they link to their profiles.'),
    guestList('guestInstructors', 'Other instructors'),
    { name: 'start', label: 'Start', widget: 'string', required: false, pattern: ['^\\d{4}(-\\d{2})?$', 'A year or year-month, e.g. 2027 or 2027-02'] },
    { name: 'end', label: 'End', widget: 'string', required: false, pattern: ['^\\d{4}(-\\d{2})?$', 'A year or year-month, e.g. 2027 or 2027-06'] },
    { name: 'schedule', label: 'Schedule', widget: 'string', i18n: true, required: false, hint: 'Free text, e.g. "Tuesdays and Thursdays, 16:00–18:00".' },
    {
      name: 'format', label: 'Format', widget: 'select', required: false,
      options: optionsFrom(texts.courses?.formats),
    },
    { name: 'languages', label: 'Taught in', widget: 'select', multiple: true, required: false, options: languageOptions },
    { name: 'ects', label: 'ECTS credits', widget: 'number', value_type: 'float', required: false },
    { name: 'hours', label: 'Hours', widget: 'number', value_type: 'int', required: false, hint: 'Shown when there are no ECTS credits.' },
    { name: 'institution', label: 'Institution', widget: 'string', i18n: true, required: false },
    { name: 'url', label: 'Link', widget: 'string', required: false, hint: 'Information or enrolment page.' },
  ],
});

const researchLines = folderCollection({
  name: 'research-lines',
  label: 'Research lines',
  label_singular: 'Research line',
  description: 'The research lines shown on the Research page.',
  summary: '{{title}}',
  sortable_fields: ['order', 'title'],
  fields: [
    { name: 'title', label: 'Title', widget: 'string', i18n: true },
    orderField('Research lines are listed by this number, lowest first.'),
    { name: 'summary', label: 'Summary', widget: 'text', i18n: true, required: false, hint: 'One or two sentences, shown under the title.' },
    { name: 'description', label: 'Description', widget: 'markdown', i18n: true, required: false, hint: 'Topics, projects, results… Optional.' },
    memberSelect('members', 'Researchers', 'Group members working on this line; they link to their profiles.'),
  ],
});

const theses = folderCollection({
  name: 'theses',
  label: 'Theses',
  label_singular: 'Thesis',
  description: 'PhD theses, master’s theses (TFM) and bachelor’s theses (TFG) supervised by members. They are listed on the Research page and on the supervisors’ profiles.',
  summary: '{{year}} · {{student}} · {{title}}',
  sortable_fields: ['year', 'title', 'student'],
  fields: [
    { name: 'title', label: 'Title', widget: 'string', hint: 'In the language the thesis is written in.' },
    { name: 'student', label: 'Student', widget: 'string' },
    {
      name: 'type', label: 'Type', widget: 'select', default: 'phd',
      options: optionsFrom(texts.research?.thesisTypes),
    },
    {
      name: 'status', label: 'Status', widget: 'select', default: 'defended',
      options: [{ label: 'Defended', value: 'defended' }, { label: 'In progress', value: 'ongoing' }],
    },
    { name: 'year', label: 'Year', widget: 'number', value_type: 'int', required: false, hint: 'Year of the defence (or of the start, if in progress).' },
    memberSelect('supervisors', 'Supervisors', 'Group members; they link to their profiles, and the thesis is listed on them.'),
    guestList('guestSupervisors', 'Other supervisors'),
    { name: 'degree', label: 'Degree or programme', widget: 'string', i18n: true, required: false, hint: 'E.g. "Doctoral Programme in Information and Communication Technologies".' },
    { name: 'institution', label: 'University', widget: 'string', i18n: true, required: false },
    { name: 'url', label: 'Link', widget: 'string', required: false, hint: 'The thesis in a repository, e.g. UIB’s or TDX.' },
  ],
});

const tools = folderCollection({
  name: 'tools',
  label: 'Tools',
  label_singular: 'Tool',
  description: 'Tools the group has developed. Each one is listed, as a card with its summary, on the Tools page of Research, of Teaching, or of both, as its sections say, and has a page of its own with the full text.',
  path: '{{slug}}/index',
  // Images are kept in each tool's folder.
  media_folder: '',
  public_folder: '',
  summary: '{{title}}',
  sortable_fields: ['order', 'title'],
  fields: [
    { name: 'title', label: 'Name', widget: 'string', i18n: true },
    {
      name: 'tags', label: 'Sections', widget: 'select', multiple: true, min: 1, default: ['research'],
      hint: 'Where the tool is listed: under Research, under Teaching, or both.',
      options: optionsFrom(texts.tools?.tags),
    },
    orderField('Tools are listed by this number, lowest first.'),
    {
      name: 'audiences', label: 'For', widget: 'select', multiple: true, required: false, hint: 'Who the tool is for.',
      options: optionsFrom(texts.tools?.audiences),
    },
    { name: 'summary', label: 'Summary', widget: 'text', i18n: true, required: false, hint: 'One or two sentences, shown on the card and at the top of the tool’s page.' },
    { name: 'image', label: 'Logo', widget: 'image', required: false, hint: 'Shown small, next to the name. Square works best.' },
    { name: 'body', label: 'Page text', widget: 'markdown', i18n: true, required: false, hint: 'The tool’s own page: what it does, pictures, guides, results… An image followed by a line in italics shows the italics as its caption.' },
    linksField({
      i18n: true,
      example: 'Try it',
      hint: 'Shown on the tool’s page, and the first one also on its card. The first one is shown as a button, e.g. the tool itself; then a demo, the code, a paper… Each language has its own list, so the texts can be translated; if a language has none, the default language’s are shown.',
    }),
  ],
});

const collaborators = folderCollection({
  name: 'collaborators',
  label: 'Collaborators',
  label_singular: 'Collaborator',
  description: 'People outside the group who work with it, shown on the team page after the members. Group members are set in site.config.yaml.',
  slug: '{{name}}',
  identifier_field: 'name',
  summary: '{{name}}',
  sortable_fields: ['order', 'name'],
  fields: [
    { name: 'name', label: 'Name', widget: 'string' },
    orderField('Collaborators are listed by this number, lowest first, then by name.'),
    { name: 'role', label: 'Position', widget: 'string', i18n: true, required: false, hint: 'E.g. "Associate professor".' },
    { name: 'institution', label: 'Institution', widget: 'string', i18n: true, required: false },
    { name: 'photo', label: 'Photo', widget: 'image', required: false, hint: 'Square works best. Without a photo, their initials are shown.' },
    linksField({ example: 'ORCID', hint: 'Shown on their card, e.g. ORCID, Google Scholar, their own web page.' }),
  ],
});

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
  collections: [news, researchLines, theses, courses, tools, collaborators, translations],
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
