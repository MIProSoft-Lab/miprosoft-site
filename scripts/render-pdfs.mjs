#!/usr/bin/env node
// Prints every member's CV in every language to dist/people/<id>/cv-<lang>.pdf
// with headless Chrome, from a running `astro preview` of the built site.
//
// Usage: node scripts/render-pdfs.mjs
//   PREVIEW_URL  where the site is served (default http://localhost:4321)
//   BASE_PATH    the site's base path, as for the build (default "")
//   CHROME       Chrome binary (default google-chrome)

import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const root = new URL('..', import.meta.url);
const config = parse(await readFile(new URL('site.config.yaml', root), 'utf8'));
if (config.features?.pdf === false) {
  console.log('PDF disabled in site.config.yaml');
  process.exit(0);
}

const origin = (process.env.PREVIEW_URL ?? 'http://localhost:4321') + (process.env.BASE_PATH ?? '').replace(/\/$/, '');
const chrome = process.env.CHROME ?? 'google-chrome';
const languages = config.languages?.length ? config.languages : ['en'];

for (const { id } of config.members ?? []) {
  const dir = new URL(`dist/people/${id}/`, root);
  await mkdir(dir, { recursive: true });
  for (const lang of languages) {
    const out = new URL(`cv-${lang}.pdf`, dir).pathname;
    const url = `${origin}/${lang}/people/${id}/`;
    // Chrome happily prints an error page, so check the page is there first.
    const status = (await fetch(url)).status;
    if (status !== 200) throw new Error(`${url}: HTTP ${status} (is the preview of this site running there?)`);
    execFileSync(chrome, [
      '--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer',
      `--print-to-pdf=${out}`, url,
    ], { stdio: 'inherit' });
    console.log(`  ${id} (${lang}) -> ${out}`);
  }
}
