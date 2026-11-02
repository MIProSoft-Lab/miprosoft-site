// Interface texts per language, from content/translations/<lang>.yaml (editable
// in the CMS at /admin/). To add a language, add its code to `languages` in
// site.config.yaml and translate a copy of en.yaml.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const file = (path) => resolve(process.cwd(), path);
const readYaml = (path) => (existsSync(file(path)) ? parse(readFileSync(file(path), 'utf8')) ?? {} : {});

const config = readYaml('site.config.yaml');
const languages = config.languages?.length ? config.languages : ['en'];
const defaultLang = languages[0];

// Texts that take values. In the YAML they are templates with {placeholders};
// here they become functions, called with the value of their only placeholder
// (t.citations(3)) or with an object ({ n: 3, total: 10 }). A template with
// `one` and `other` forms picks one by the number {n}.
const TEMPLATES = new Set([
  'citations', 'reviews', 'jifTooltip', 'jcrTooltip',
  'news.notTranslated', 'courses.ects', 'courses.hours',
]);

function template(value, lang) {
  const forms = typeof value === 'object' ? value : { other: value };
  const first = (forms.other ?? '').match(/\{(\w+)\}/)?.[1] ?? 'n';
  const plural = new Intl.PluralRules(lang);
  return (arg) => {
    const params = arg !== null && typeof arg === 'object' ? arg : { [first]: arg };
    const text = (typeof params.n === 'number' && forms[plural.select(params.n)]) || forms.other || '';
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
}

// Missing or empty texts in a language are taken from the default language.
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !isForms(v)
      ? merge(base[k], v)
      : v == null || v === '' ? base?.[k] : v;
  }
  return out;
}
const isForms = (v) => 'other' in v || 'one' in v;

function compile(obj, lang, path = []) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => {
      const key = [...path, k].join('.');
      if (TEMPLATES.has(key)) return [k, template(v, lang)];
      return [k, v && typeof v === 'object' && !Array.isArray(v) ? compile(v, lang, [...path, k]) : v];
    }),
  );
}

const raw = Object.fromEntries(languages.map((l) => [l, readYaml(`content/translations/${l}.yaml`)]));
export const ui = Object.fromEntries(
  languages.map((l) => [l, compile(l === defaultLang ? raw[l] : merge(raw[defaultLang], raw[l]), l)]),
);

export function strings(lang) {
  return ui[lang] ?? ui[defaultLang];
}

// A localized value is a string or a { lang: string } map.
export function loc(value, lang, fallback) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  return value[lang] || value[fallback] || Object.values(value).find(Boolean) || '';
}
