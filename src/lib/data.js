import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { parseLooseDate } from './format.js';

const file = (path) => resolve(process.cwd(), path);
const read = (path) => readFileSync(file(path), 'utf8');
const readYaml = (path) => (existsSync(file(path)) ? parse(read(path)) ?? {} : {});

export const config = readYaml('cv.config.yaml');
export const languages = config.languages?.length ? config.languages : ['en'];
export const defaultLang = languages[0];

const WORK_GROUPS = {
  journal: ['journal-article', 'review', 'journal-issue', 'magazine-article', 'newspaper-article', 'letter'],
  conference: ['conference-paper', 'conference-abstract', 'conference-poster', 'conference-output', 'conference-presentation', 'conference-proceedings'],
  preprint: ['preprint', 'working-paper', 'report', 'research-technique'],
  book: ['book', 'book-chapter', 'edited-book', 'book-review', 'encyclopedia-entry', 'dictionary-entry'],
  thesis: ['dissertation-thesis', 'supervised-student-publication'],
  data: ['data-set', 'software', 'data-management-plan', 'physical-object'],
};
export const workGroupOrder = [...Object.keys(WORK_GROUPS), 'other'];
const groupOf = (w) => {
  // Preprint servers are often registered in ORCID as journal articles.
  if (/rxiv/i.test(w.venue ?? '') || /^10\.1101\//.test(w.doi ?? '')) return 'preprint';
  return Object.keys(WORK_GROUPS).find((g) => WORK_GROUPS[g].includes(w.type)) ?? 'other';
};

const squash = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);

function cleanWork(w) {
  const doiUrl = w.doi ? `https://doi.org/${w.doi}` : null;
  const sameAsDoi = (u) => u && doiUrl && u.toLowerCase() === doiUrl.toLowerCase();
  return {
    ...w,
    title: squash(w.title),
    venue: squash(w.venue),
    // Some sources use U+2010 (‐) instead of an ASCII hyphen in names.
    authors: w.authors?.map((a) => a.replace(/‐/g, '-')),
    url: doiUrl ?? w.url,
    openAccessUrl: sameAsDoi(w.openAccessUrl) ? null : w.openAccessUrl,
  };
}

// ORCID often holds the same work several times.
// Merge works with the same title and year, keeping the most complete record and filling its gaps from the others.
function dedupeWorks(works) {
  const key = (w) => `${w.title.normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase()}|${w.date?.year ?? ''}`;
  const score = (w) =>
    (w.doi ? 8 : 0) + (w.authors?.length ? 4 : 0) + (w.url && !/publons\.com/.test(w.url) ? 2 : 0) +
    (w.selected ? 16 : 0) + (w.venue?.length ?? 0) / 1000;
  const groups = new Map();
  for (const w of works) groups.set(key(w), [...(groups.get(key(w)) ?? []), w]);
  return [...groups.values()].map((dups) => {
    const [best, ...rest] = dups.sort((a, b) => score(b) - score(a));
    const merged = { ...best };
    for (const other of rest) {
      for (const [k, val] of Object.entries(other)) if (merged[k] == null || merged[k] === '') merged[k] = val;
    }
    return merged;
  });
}

const shortLabel = (s) => s.replace(/\s+(author id|profile)$/i, '');

function load() {
  const orcid = existsSync(file('data/orcid.json'))
    ? JSON.parse(read('data/orcid.json'))
    : { person: {}, works: [] };
  const manual = readYaml('data/manual.yaml');
  const overrides = readYaml('data/overrides.yaml');

  const itemOverride = new Map((overrides.items ?? []).map((o) => [Number(o.putCode), o]));
  const applyItems = (list = []) =>
    list
      .map((it) => ({ ...it, ...(itemOverride.get(it.putCode) ?? {}) }))
      .filter((it) => !it.hide);

  const workOverride = (w) =>
    (overrides.works ?? []).find(
      (o) => (o.doi && w.doi && o.doi.toLowerCase() === w.doi) || (o.putCode && Number(o.putCode) === w.putCode),
    ) ?? {};

  const allWorks = dedupeWorks(
    (orcid.works ?? [])
      .map((w) => cleanWork({ ...w, ...workOverride(w) }))
      .filter((w) => !w.hide),
  ).map((w) => ({ ...w, group: groupOf(w) }));

  // ORCID works of type "lecture-speech" are listed as talks, not publications.
  const talks = [
    ...allWorks
      .filter((w) => w.type === 'lecture-speech')
      .map((w) => ({ title: w.title, event: w.venue, date: w.date, url: w.url })),
    ...(manual.talks ?? []).map((t) => ({ ...t, date: parseLooseDate(t.date) })),
  ].sort((a, b) => (b.date?.year ?? 0) * 100 + (b.date?.month ?? 0) - ((a.date?.year ?? 0) * 100 + (a.date?.month ?? 0)));

  const works = allWorks.filter((w) => w.type !== 'lecture-speech');

  const person = orcid.person ?? {};
  const profile = manual.profile ?? {};
  const nameVariants = config.nameVariants?.length
    ? config.nameVariants
    : [person.name, ...(person.otherNames ?? []), profile.name].filter(Boolean);

  return {
    orcidId: orcid.orcid ?? config.orcid,
    lastModified: orcid.lastModified,
    profile: {
      name: profile.name || person.name || '',
      title: profile.title,
      email: profile.email || person.emails?.[0] || '',
      location: profile.location,
      photo: profile.photo,
      links: [
        ...(person.links ?? []),
        ...(person.identifiers ?? []).filter((i) => i.url).map((i) => ({ label: i.type, url: i.url })),
        ...(profile.links ?? []),
      ].map((l) => ({ ...l, label: shortLabel(l.label) })),
      keywords: person.keywords ?? [],
    },
    about: manual.about && Object.values(manual.about).some(Boolean) ? manual.about : person.biography,
    nameVariants,
    familyName: person.familyName ?? '',
    givenNames: person.givenNames ?? '',
    employment: applyItems(orcid.employment),
    education: applyItems([...(orcid.education ?? []), ...(orcid.qualifications ?? [])]),
    distinctions: applyItems(orcid.distinctions),
    invitedPositions: applyItems(orcid.invitedPositions),
    memberships: applyItems(orcid.memberships),
    service: applyItems(orcid.service),
    funding: applyItems(orcid.funding),
    peerReview: orcid.peerReview ?? [],
    works,
    talks,
    teaching: manual.teaching ?? [],
    supervision: manual.supervision ?? [],
    software: manual.software ?? [],
    skills: manual.skills ?? [],
    languages: manual.languages ?? [],
  };
}

export const cv = load();

export function hasContent(section) {
  if (section === 'about') return Boolean(cv.about) || cv.profile.keywords.length > 0;
  if (section === 'publications') return cv.works.length > 0;
  return Array.isArray(cv[section]) && cv[section].length > 0;
}
