// News and blog posts: content/news/<slug>/index.yaml (all languages, edited in
// the CMS at /admin/), with their images in the same folder.
import { getImage } from 'astro:assets';
import { peopleOf } from './data.js';
import { markdown } from './markdown.js';
import { readEntries, localize, toDate } from './content.js';

// The posts' images, by path, so they can be resized and converted at build time.
const images = import.meta.glob('/content/news/*/*.{png,jpg,jpeg,webp,gif,avif,svg,PNG,JPG,JPEG,WEBP}', {
  eager: true,
  import: 'default',
});
const imageOf = (slug, name) => (name ? images[`/content/news/${slug}/${String(name).replace(/^\.?\//, '')}`] : undefined);

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
export async function renderBody(post) {
  let md = post.body;
  for (const [match, alt, src] of md.matchAll(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
    const meta = imageOf(post.slug, src);
    if (!meta) continue;
    const img = await getImage({ src: meta, width: Math.min(meta.width, 1400), format: 'webp' });
    md = md.replace(match, `![${alt}](${img.src})`);
  }
  return markdown(md);
}
