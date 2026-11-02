// Content edited in the CMS (/admin/): one YAML file per entry with every
// language in it, the way Sveltia CMS stores it (i18n structure "single_file"):
//
//   en:                 # default language: every field, including the shared ones
//     title: …
//     date: 2026-11-02
//   ca:                 # other languages: only the translated fields
//     title: …
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse } from 'yaml';

const file = (path) => resolve(process.cwd(), path);
const config = existsSync(file('site.config.yaml')) ? parse(readFileSync(file('site.config.yaml'), 'utf8')) ?? {} : {};
const languages = config.languages?.length ? config.languages : ['en'];
const defaultLang = languages[0];

// Entries of a folder: `<dir>/<slug>.yaml`, or `<dir>/<slug>/index.yaml` when
// `bundles` is set (entries with their own folder for images).
export function readEntries(dir, { bundles = false } = {}) {
  if (!existsSync(file(dir))) return [];
  return readdirSync(file(dir), { withFileTypes: true })
    .flatMap((d) => {
      if (bundles && d.isDirectory()) {
        const path = join(dir, d.name, 'index.yaml');
        return existsSync(file(path)) ? [{ slug: d.name, path }] : [];
      }
      if (!bundles && d.isFile() && /\.ya?ml$/.test(d.name)) return [{ slug: d.name.replace(/\.ya?ml$/, ''), path: join(dir, d.name) }];
      return [];
    })
    .map(({ slug, path }) => {
      const data = parse(readFileSync(file(path), 'utf8')) ?? {};
      const base = data[defaultLang] ?? data[languages.find((l) => data[l])];
      if (!base) throw new Error(`${path}: no content in any language (${languages.join(', ')})`);
      return { slug, path, data, base };
    });
}

const filled = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);

// An entry in one language: the default language's fields, overridden by the
// language's own. `translated` is false when the language has no title (or no
// content at all), and `lang` is then the language the text is shown in.
export function localize(entry, lang) {
  const own = entry.data[lang];
  const translated = Boolean(own && filled(own.title ?? own.name));
  const shown = translated ? lang : entry.data[defaultLang] ? defaultLang : languages.find((l) => entry.data[l]);
  const fields = { ...entry.base };
  if (translated) for (const [k, v] of Object.entries(own)) if (filled(v)) fields[k] = v;
  return { ...fields, slug: entry.slug, lang: shown, translated };
}

// YAML dates come as text ("2026-11-02"), or as Date objects from some editors.
export function toDate(value) {
  if (value instanceof Date) return value;
  const d = value ? new Date(String(value)) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}
