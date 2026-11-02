// News and blog posts (src/content/news/<slug>/<lang>.md), grouped by post with
// one version per language.
import { getCollection } from 'astro:content';
import { languages, defaultLang, memberById } from './data.js';

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

// All posts, newest first. Cached for the build;
// in dev, read every time so new and edited posts show up on reload.
export async function getPosts() {
  if (cache && !import.meta.env.DEV) return cache;
  const bySlug = new Map();
  for (const entry of await getCollection('news')) {
    const [, slug, lang] = entry.filePath.match(/([^/\\]+)[/\\]([^/\\]+)\.md$/) ?? [];
    if (!languages.includes(lang)) {
      throw new Error(`${entry.filePath}: the file name must be a language of the site (${languages.join(', ')}).md`);
    }
    if (!bySlug.has(slug)) bySlug.set(slug, {});
    bySlug.get(slug)[lang] = entry;
  }

  cache = [...bySlug.entries()]
    .map(([slug, versions]) => {
      // Shared fields come from the default language, or the first one present.
      const baseLang = versions[defaultLang] ? defaultLang : languages.find((l) => versions[l]);
      const base = versions[baseLang].data;
      if (!base.date) throw new Error(`src/content/news/${slug}/${baseLang}.md: add a date (e.g. date: 2026-11-02)`);
      return {
        slug,
        versions,
        date: base.date,
        kind: base.kind ?? 'news',
        image: base.image,
        authors: (base.authors ?? []).map((a) => {
          const member = memberById.get(a);
          return member ? { id: a, name: member.name, member } : { name: a };
        }),
      };
    })
    .sort((a, b) => b.date - a.date || a.slug.localeCompare(b.slug));
  return cache;
}

// A post in one language: that version if it exists, otherwise the default
// language's (or the first available), with `translated: false`.
export function inLanguage(post, lang) {
  const shown = post.versions[lang] ? lang : post.versions[defaultLang] ? defaultLang : languages.find((l) => post.versions[l]);
  const entry = post.versions[shown];
  const baseAlt = Object.values(post.versions).find((v) => v.data.imageAlt)?.data.imageAlt;
  return {
    ...post,
    lang: shown,
    translated: shown === lang,
    entry,
    title: entry.data.title,
    summary: entry.data.summary ?? excerpt(entry.body),
    imageAlt: entry.data.imageAlt ?? baseAlt ?? '',
  };
}
