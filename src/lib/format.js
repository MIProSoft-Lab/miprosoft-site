import { strings } from './i18n.js';

export function formatDate(d, lang) {
  if (!d) return '';
  if (typeof d === 'string' || typeof d === 'number') return String(d);
  if (!d.month) return String(d.year);
  return new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric' })
    .format(new Date(Date.UTC(d.year, d.month - 1, 1)));
}

export function formatRange(start, end, lang) {
  const s = formatDate(start, lang);
  const e = end ? formatDate(end, lang) : start ? strings(lang).present : '';
  if (!s) return e;
  if (s === e) return s;
  return `${s} – ${e}`;
}

export function formatPlace(org, lang) {
  if (!org) return '';
  let country = org.country ?? '';
  try {
    if (country) country = new Intl.DisplayNames([lang], { type: 'region' }).of(country) ?? country;
  } catch {}
  return [org.city, country].filter(Boolean).join(', ');
}

// Manual entries may give dates as YAML values like 2026-05 or 2026.
export function parseLooseDate(x) {
  if (x == null || x === '') return null;
  if (x instanceof Date) return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1 };
  const m = String(x).match(/^(\d{4})(?:-(\d{1,2}))?/);
  return m ? { year: Number(m[1]), ...(m[2] ? { month: Number(m[2]) } : {}) } : null;
}
