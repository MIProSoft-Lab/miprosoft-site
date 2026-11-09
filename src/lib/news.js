// News and blog posts: content/news/<slug>/index.yaml (all languages, edited in
// the CMS at /admin/), with their images in the same folder.
import { peopleOf } from './data.js';
import { readEntries, localize, toDate } from './content.js';
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
export const renderBody = (post) => renderMarkdown(post.body, 'news', post.slug);
