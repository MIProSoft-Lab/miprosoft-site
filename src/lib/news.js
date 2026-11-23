// News and blog posts: content/news/<slug>/index.yaml (all languages, edited in
// the CMS at /admin/), with their images in the same folder.
import { peopleOf, group, tools, theses, courses, workKey, workAnchor as workAnchorOf, defaultLang } from './data.js';
import { readEntries, localize, toDate } from './content.js';
import { loc } from './i18n.js';
import { imageOf as bundleImage, renderMarkdown } from './bundle.js';

const imageOf = (slug, name) => bundleImage('news', slug, name);

// "**Bold** [link](url) text" -> "Bold link text", for summaries made from the body.
const plainText = (md = '') =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s.*$/gm, ' ')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, ' ')
    .replace(/[`*_~]+/g, '')
    .replace(/^\s*>\s?/gm, ' ')
    .replace(/[#|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function excerpt(md, max = 220) {
  const text = plainText(md);
  if (text.length <= max) return text;
  return text.slice(0, text.lastIndexOf(' ', max)).replace(/[,;:.]$/, '') + '…';
}

// What a post is about: the group's publications (by workKey), tools, theses
// and courses (by slug) it lists in `publications`, `tools`, `theses` and
// `courses`. A reference to something that doesn't exist stops the build.
const relatedKinds = {
  publications: () => group.works.map(workKey),
  tools: () => tools.map((x) => x.id),
  theses: () => theses.map((x) => x.id),
  courses: () => courses.map((x) => x.id),
};
function relatedOf(base, path) {
  const related = {};
  for (const [kind, ids] of Object.entries(relatedKinds)) {
    const wanted = [].concat(base[kind] ?? []).map((x) => String(x).trim()).filter(Boolean);
    const known = new Set(ids());
    const missing = wanted.filter((x) => !known.has(kind === 'publications' ? x.toLowerCase() : x));
    if (missing.length) throw new Error(`${path}: ${kind} not found: ${missing.join(', ')}`);
    related[kind] = wanted.map((x) => (kind === 'publications' ? x.toLowerCase() : x));
  }
  return related;
}

let cache;

// All posts, newest first. Cached for the build; in dev, read every time so
// new and edited posts show up on reload.
export async function getPosts() {
  if (cache && !import.meta.env.DEV) return cache;
  cache = readEntries('content/news', { bundles: true })
    .map((entry) => {
      const { base, slug, path } = entry;
      const date = toDate(base.date);
      if (!date) throw new Error(`${path}: add a date (e.g. date: 2026-11-02)`);
      if (base.image && !imageOf(slug, base.image)) throw new Error(`${path}: image "${base.image}" not found next to it`);
      return {
        entry,
        slug,
        date,
        kind: base.kind ?? 'news',
        image: imageOf(slug, base.image),
        authors: peopleOf(base.authors, base.guestAuthors),
        related: relatedOf(base, path),
      };
    })
    .sort((a, b) => b.date - a.date || a.slug.localeCompare(b.slug));
  return cache;
}

// A post in one language: that version if it exists, otherwise the default
// language's, with `translated: false`.
export function inLanguage(post, lang) {
  const text = localize(post.entry, lang);
  return {
    ...post,
    lang: text.lang,
    translated: text.translated,
    title: text.title,
    summary: text.summary || excerpt(text.body),
    imageAlt: text.imageAlt ?? '',
    body: text.body ?? '',
  };
}

// The post's Markdown as HTML. Images next to the post are resized and
// converted like the cover image.
export const renderBody = (post, lang) => renderMarkdown(post.body, 'news', post.slug, lang);

// The posts about one thing, newest first: postsAbout('tools', 'record'),
// postsAbout('publications', workKey(w)).
export async function postsAbout(kind, id) {
  const key = kind === 'publications' ? String(id).toLowerCase() : id;
  return (await getPosts()).filter((p) => p.related[kind]?.includes(key));
}

// What a post is about, in one language, for its "Related" section:
// [{ kind, title, href, meta, summary, year, lang }], in the order publications, tools, theses, courses.
export function relatedItems(post, lang) {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const home = `${base}${lang}/`;
  const r = post.related;
  const L = (x) => loc(x, lang, defaultLang);
  const items = [];
  for (const key of r.publications) {
    const w = group.works.find((x) => workKey(x) === key);
    items.push({
      kind: 'publication', title: w.title, href: `${home}research/publications/#${workAnchorOf(w)}`,
      meta: [w.venue, w.date?.year].filter(Boolean).join(' · '),
    });
  }
  for (const id of r.tools) {
    const x = tools.find((t) => t.id === id);
    const text = localize(x.entry, lang);
    items.push({ kind: 'tool', title: text.title, href: `${home}tools/${id}/`, meta: '', lang: text.translated ? undefined : text.lang });
  }
  for (const id of r.theses) {
    const x = theses.find((t) => t.id === id);
    items.push({
      kind: 'thesis', title: x.title, href: `${home}research/theses/#thesis-${id}`, year: x.year,
      meta: [x.student, L(x.degree)].filter(Boolean).join(' · '),
    });
  }
  for (const id of r.courses) {
    const x = courses.find((c) => c.id === id);
    const text = localize(x.entry, lang);
    items.push({
      kind: 'course', title: text.title, lang: text.translated ? undefined : text.lang,
      href: x.hasPage ? `${home}teaching/courses/${id}/` : `${home}teaching/courses/#${id}`,
      meta: L(text.institution) || '', summary: text.summary || '',
    });
  }
  return items;
}
