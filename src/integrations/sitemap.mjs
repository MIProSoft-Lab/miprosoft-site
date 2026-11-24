// Writes dist/sitemap.xml and dist/robots.txt after the build, so search
// engines find every page and each page's versions in the other languages.
//
// The sitemap is made from the built pages themselves: each page with a
// canonical address (<link rel="canonical">) is listed with its language
// versions (<link rel="alternate" hreflang>), both set in src/layouts/Base.astro.
// Pages without one are left out: redirects of old addresses, the language
// chooser at the root, the 404 page and the content editor (/admin/).
//
// robots.txt lets every crawler in and points to the sitemap. Keeping pages out
// of search results is done with <meta name="robots" content="noindex"> on the
// pages, not here: a crawler blocked by robots.txt never sees that tag.
// Note: robots.txt only counts at the root of a domain, so on a GitHub Pages
// project site (you.github.io/repository/) submit the sitemap in Google Search
// Console instead.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.html'))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

export default function sitemap() {
  let site;
  let base;
  return {
    name: 'sitemap',
    hooks: {
      'astro:config:done': ({ config }) => {
        site = config.site;
        base = config.base.replace(/\/?$/, '/');
      },
      'astro:build:done': async ({ dir, logger }) => {
        const out = fileURLToPath(dir);
        const pages = [];
        for (const file of await htmlFiles(out)) {
          const html = await readFile(file, 'utf8');
          const head = html.slice(0, html.indexOf('</head>'));
          if (/http-equiv="refresh"/i.test(head)) continue;
          const links = head.match(/<link\s[^>]*>/g) ?? [];
          const canonical = links.find((l) => attr(l, 'rel') === 'canonical');
          if (!canonical) continue;
          const alternates = links
            .filter((l) => attr(l, 'rel') === 'alternate' && attr(l, 'hreflang'))
            .map((l) => ({ lang: attr(l, 'hreflang'), href: attr(l, 'href') }));
          pages.push({ loc: attr(canonical, 'href'), alternates });
        }
        pages.sort((a, b) => a.loc.localeCompare(b.loc));

        const body = pages.map((p) => [
          '  <url>',
          `    <loc>${xml(p.loc)}</loc>`,
          ...p.alternates.map((a) => `    <xhtml:link rel="alternate" hreflang="${xml(a.lang)}" href="${xml(a.href)}"/>`),
          '  </url>',
        ].join('\n'));
        await writeFile(join(out, 'sitemap.xml'), [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
          ...body,
          '</urlset>',
          '',
        ].join('\n'));

        const sitemapUrl = new URL(`${base}sitemap.xml`, site).href;
        await writeFile(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`);
        logger.info(`sitemap.xml with ${pages.length} pages, and robots.txt`);
      },
    },
  };
}
