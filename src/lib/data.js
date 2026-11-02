import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { parseLooseDate } from './format.js';
import { articleKey, orcidFile, personFile } from './articles.js';

const file = (path) => resolve(process.cwd(), path);
const read = (path) => readFileSync(file(path), 'utf8');
const readYaml = (path) => (existsSync(file(path)) ? parse(read(path)) ?? {} : {});
const readJson = (path, fallback) => (existsSync(file(path)) ? JSON.parse(read(path)) : fallback);

export const config = readYaml('site.config.yaml');
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
const normTitle = (s) => (s ?? '').normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase();

// ---------- Works ----------

// What was fetched about each article (data/works.json), shared by all members.
const articles = readJson('data/works.json', {});

// An ORCID work reference plus its article data. ORCID wins for what the member
// entered (venue, date); the article fills the rest.
function withArticle(ref) {
  const { metadataFetched, venue, date, ...article } = articles[articleKey(ref)] ?? {};
  return { ...article, ...ref, venue: ref.venue ?? venue ?? null, date: ref.date ?? date ?? null };
}

function openAccessOf(w) {
  if (w.openAccess !== undefined && w.openAccess !== null) return w.openAccess || null;
  // SISTEDES (JISBD, JCIS…) publishes everything under CC licences, free for authors.
  if (/hdl\.handle\.net\/11705\//.test(w.url ?? '') && /^CC/i.test(w.license ?? '')) {
    return { status: 'diamond', license: w.license };
  }
  // CEUR-WS is an open-access publisher with no fees (CC BY 4.0).
  if (/ceur/i.test(`${w.venue} ${w.url}`)) return { status: 'diamond', license: 'cc-by' };
  return null;
}

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
    openAccess: openAccessOf(w),
  };
}

// ORCID often holds the same work several times, and members share works.
// Merge works with the same title and year, or the same DOI, keeping the most
// complete record, filling its gaps from the others, and joining their members.
function dedupeWorks(works) {
  const byTitle = (w) => `${normTitle(w.title)}|${w.date?.year ?? ''}`;
  const score = (w) =>
    (w.doi ? 8 : 0) + (w.authors?.length ? 4 : 0) + (w.url && !/publons\.com/.test(w.url) ? 2 : 0) +
    (w.selected ? 16 : 0) + (w.venue?.length ?? 0) / 1000;
  const mergeBy = (list, key) => {
    const groups = new Map();
    list.forEach((w, i) => {
      const k = key(w) ?? `#${i}`;
      groups.set(k, [...(groups.get(k) ?? []), w]);
    });
    return [...groups.values()].map((dups) => {
      const [best, ...rest] = dups.sort((a, b) => score(b) - score(a));
      const merged = { ...best };
      for (const other of rest) {
        for (const [k, val] of Object.entries(other)) if (merged[k] == null || merged[k] === '') merged[k] = val;
      }
      merged.members = [...new Set(dups.flatMap((w) => w.members ?? []))];
      return merged;
    });
  };
  return mergeBy(mergeBy(works, byTitle), (w) => w.doi);
}

const byDateDesc = (a, b) =>
  (b.date?.year ?? 0) * 100 + (b.date?.month ?? 0) - ((a.date?.year ?? 0) * 100 + (a.date?.month ?? 0));

// ---------- Journal Impact Factors ----------

// data/jcr.json (from the Clarivate API, scripts/fetch-jcr.mjs) with
// data/jcr.yaml (entered by hand) taking precedence year by year.
function loadJournals() {
  const fetched = readJson('data/jcr.json', {}).journals ?? [];
  const manual = readYaml('data/jcr.yaml').journals ?? [];
  const journals = [];
  for (const j of [...fetched, ...manual]) {
    const issn = (j.issn ?? []).map((s) => String(s).toUpperCase());
    const same = journals.find((o) => o.issn.some((s) => issn.includes(s)) || normTitle(o.title) === normTitle(j.title));
    if (same) {
      same.issn = [...new Set([...same.issn, ...issn])];
      same.jif = { ...same.jif, ...j.jif };
    } else {
      journals.push({ title: j.title, issn, jif: { ...j.jif } });
    }
  }
  return journals;
}
const journals = loadJournals();

// Quartile and percentile follow from the rank ("12/131") the way JCR computes them.
function withRankStats(m) {
  const [pos, total] = String(m.rank ?? '').split('/').map(Number);
  if (!(pos > 0 && total >= pos)) return m;
  return {
    quartile: `Q${Math.ceil((pos / total) * 4)}`,
    percentile: Math.round(((total - pos + 0.5) / total) * 1000) / 10,
    ...m,
  };
}

// The JCR data of the publication year, or the latest available year otherwise.
// Some journals have a category rank but no JIF.
function impactFactorOf(w) {
  if (w.jif !== undefined) return w.jif;
  const issn = (w.issn ?? []).map((s) => s.toUpperCase());
  const journal =
    journals.find((j) => j.issn.some((s) => issn.includes(s))) ??
    journals.find((j) => w.venue && normTitle(j.title) === normTitle(w.venue));
  const years = Object.keys(journal?.jif ?? {}).filter((y) => journal.jif[y]?.value != null || journal.jif[y]?.rank).map(Number);
  if (!years.length) return null;
  const year = years.includes(w.date?.year) ? w.date.year : Math.max(...years);
  return { year, ...withRankStats(journal.jif[year]) };
}

// ---------- Metrics ----------

// Citation metrics computed from a list of works.
function computeMetrics(works) {
  const counts = works.map((w) => w.citations ?? 0).sort((a, b) => b - a);
  const byYear = {};
  for (const w of works) {
    for (const [year, n] of Object.entries(w.citationsByYear ?? {})) byYear[year] = (byYear[year] ?? 0) + n;
  }
  const years = Object.keys(byYear).map(Number);
  const perYear = years.length
    ? Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => {
        const year = Math.min(...years) + i;
        return { year, citations: byYear[year] ?? 0 };
      })
    : [];
  return {
    publications: works.length,
    citations: counts.reduce((a, b) => a + b, 0),
    hIndex: counts.filter((c, i) => c >= i + 1).length,
    i10Index: counts.filter((c) => c >= 10).length,
    perYear,
  };
}

// ---------- Members ----------

const shortLabel = (s) => s.replace(/\s+(author id|profile)$/i, '');
const globalOverrides = readYaml('data/overrides.yaml');
const sameDoi = (o, w) => o.doi && w.doi && String(o.doi).toLowerCase() === w.doi;

function loadMember({ id, orcid: orcidId }) {
  orcidId = String(orcidId).trim();
  const orcid = readJson(orcidFile(orcidId), { person: {}, works: [] });
  const manual = readYaml(personFile(id));

  const itemOverride = new Map((manual.items ?? []).map((o) => [Number(o.putCode), o]));
  const applyItems = (list = []) =>
    list
      .map((it) => ({ ...it, ...(itemOverride.get(it.putCode) ?? {}) }))
      .filter((it) => !it.hide);

  // Group-wide corrections first, then this member's.
  const workOverride = (w) => ({
    ...(globalOverrides.works ?? []).find((o) => sameDoi(o, w)),
    ...(manual.works ?? []).find((o) => sameDoi(o, w) || (o.putCode && Number(o.putCode) === w.putCode)),
  });

  const allWorks = dedupeWorks(
    (orcid.works ?? [])
      .map((ref) => cleanWork({ ...withArticle(ref), ...workOverride(ref), members: [id] }))
      .filter((w) => !w.hide),
  ).map((w) => {
    const work = { ...w, group: groupOf(w) };
    if (work.group === 'journal') work.jif = impactFactorOf(work);
    return work;
  });

  // ORCID works of type "lecture-speech" are listed as talks, not publications.
  const talks = [
    ...allWorks
      .filter((w) => w.type === 'lecture-speech')
      .map((w) => ({ title: w.title, event: w.venue, date: w.date, url: w.url })),
    ...(manual.talks ?? []).map((t) => ({ ...t, date: parseLooseDate(t.date) })),
  ].sort(byDateDesc);

  const works = allWorks.filter((w) => w.type !== 'lecture-speech').sort(byDateDesc);

  const person = orcid.person ?? {};
  const profile = manual.profile ?? {};
  const nameVariants = manual.nameVariants?.length
    ? manual.nameVariants
    : [person.name, ...(person.otherNames ?? []), profile.name].filter(Boolean);

  const name = profile.name || person.name || id;
  const employment = applyItems(orcid.employment);

  return {
    id,
    name,
    // "Antonio Crespi Tobeña" -> "AC": shown when there is no photo.
    initials: (person.givenNames && person.familyName
      ? [person.givenNames, person.familyName]
      : name.split(/\s+/)
    ).map((n) => n.trim().charAt(0).toUpperCase()).slice(0, 2).join(''),
    // Shown under the name when there is no title: the current (or latest) job.
    affiliation: employment[0] ?? null,
    orcidId: orcid.orcid ?? orcidId,
    lastModified: orcid.lastModified,
    sections: manual.sections ?? config.sections ?? [],
    collapsed: manual.collapsed ?? config.collapsed ?? [],
    profile: {
      name,
      title: profile.title,
      email: profile.email || person.emails?.[0] || '',
      location: profile.location,
      photo: profile.photo,
      links: [
        ...(person.links ?? []),
        ...(person.identifiers ?? []).filter((i) => i.url).map((i) => ({ label: i.type, url: i.url })),
        ...(profile.links ?? []),
      ]
        .map((l) => ({ ...l, label: shortLabel(l.label) }))
        .filter((l) => !(profile.hideLinks ?? []).some((h) => l.label.toLowerCase() === String(h).toLowerCase())),
      keywords: person.keywords ?? [],
    },
    about: manual.about && Object.values(manual.about).some(Boolean) ? manual.about : person.biography,
    nameVariants,
    familyName: person.familyName ?? '',
    givenNames: person.givenNames ?? '',
    employment,
    education: applyItems([...(orcid.education ?? []), ...(orcid.qualifications ?? [])]),
    distinctions: applyItems(orcid.distinctions),
    invitedPositions: applyItems(orcid.invitedPositions),
    memberships: applyItems(orcid.memberships),
    service: applyItems(orcid.service),
    funding: applyItems(orcid.funding),
    peerReview: orcid.peerReview ?? [],
    works,
    metrics: computeMetrics(works),
    talks,
    teaching: manual.teaching ?? [],
    supervision: manual.supervision ?? [],
    software: manual.software ?? [],
    skills: manual.skills ?? [],
    languages: manual.languages ?? [],
  };
}

export const members = (config.members ?? []).map(loadMember);
export const memberById = new Map(members.map((m) => [m.id, m]));

// ---------- Group ----------

// The group's publications: every member's works, once each, with the ids of
// the members who list them in `members`. Per-member choices (selected) are dropped.
const groupWorks = dedupeWorks(members.flatMap((m) => m.works.map(({ selected, ...w }) => w))).sort(byDateDesc);

export const group = {
  name: config.group?.name ?? '',
  fullName: config.group?.fullName ?? '',
  description: config.group?.description ?? '',
  institution: config.group?.institution ?? null,
  works: groupWorks,
  metrics: computeMetrics(groupWorks),
  lastModified: members.map((m) => m.lastModified).filter(Boolean).sort().at(-1) ?? null,
};

export function hasContent(cv, section) {
  if (section === 'about') return Boolean(cv.about) || cv.profile.keywords.length > 0;
  if (section === 'publications') return cv.works.length > 0;
  return Array.isArray(cv[section]) && cv[section].length > 0;
}
