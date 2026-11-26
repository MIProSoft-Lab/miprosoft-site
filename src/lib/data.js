import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { parseLooseDate } from './format.js';
import { articleKey, orcidFile, personFile } from './articles.js';
import { readEntries } from './content.js';

const file = (path) => resolve(process.cwd(), path);
const read = (path) => readFileSync(file(path), 'utf8');
const readYaml = (path) => (existsSync(file(path)) ? parse(read(path)) ?? {} : {});
const readJson = (path, fallback) => (existsSync(file(path)) ? JSON.parse(read(path)) : fallback);

export const config = readYaml('site.config.yaml');
export const languages = config.languages?.length ? config.languages : ['en'];
export const defaultLang = languages[0];
// GoatCounter counting address (analytics.goatcounter in site.config.yaml), or null.
export const goatcounter = config.analytics?.goatcounter || null;

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

// ---------- Members ----------

const shortLabel = (s) => s.replace(/\s+(author id|profile)$/i, '');
const globalOverrides = readYaml('data/overrides.yaml');
const sameDoi = (o, w) => o.doi && w.doi && String(o.doi).toLowerCase() === w.doi;

function loadMember({ id, orcid: orcidId, pi = false }) {
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
    // Principal investigator (`pi: true` in site.config.yaml).
    pi: Boolean(pi),
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
// Members as listed on the team page: principal investigators first,
// otherwise in the order of site.config.yaml.
export const team = [...members].sort((a, b) => b.pi - a.pi);

// ---------- Group ----------

// The group's publications: every member's works, once each, with the ids of
// the members who list them in `members`. Per-member choices (selected) are dropped.
// A publication's stable key, used by news posts to point at it: its DOI or
// Sistedes handle ("doi:10.…", "hdl:11705/…"), or else its title ("title:…").
export const workKey = (w) => articleKey(w) ?? `title:${normTitle(w.title)}`;
// The id of a publication's entry in the lists (pub-doi-10-1016-…), so other
// pages can link to it.
export const workAnchor = (w) => `pub-${workKey(w).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

const groupWorks = dedupeWorks(members.flatMap((m) => m.works.map(({ selected, ...w }) => w))).sort(byDateDesc);

export const group = {
  name: config.group?.name ?? '',
  fullName: config.group?.fullName ?? '',
  description: config.group?.description ?? '',
  institution: config.group?.institution ?? null,
  // Social networks with a URL, in a fixed order: [{ network, url }].
  social: ['linkedin', 'instagram']
    .map((network) => ({ network, url: String(config.group?.social?.[network] ?? '').trim() }))
    .filter((s) => s.url),
  works: groupWorks,
  lastModified: members.map((m) => m.lastModified).filter(Boolean).sort().at(-1) ?? null,
};

// ---------- Content edited in the CMS ----------

// Members (by id, linked to their profiles) and other people (by name), e.g.
// a course's instructors or a thesis's supervisors. Other people whose name is
// that of a collaborator get `collaborator`, to link to their card on the team page.
export const peopleOf = (ids, guests) => [
  ...(ids ?? []).map((id) => {
    const member = memberById.get(id);
    return member ? { id, name: member.name, member } : { name: id };
  }),
  ...(guests ?? []).filter(Boolean).map((name) => {
    const collaborator = collaboratorByName().get(normalizeName(name));
    return collaborator ? { name: collaborator.name, collaborator } : { name };
  }),
];
const normalizeName = (name) => String(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
// Built on first use: peopleOf() is defined before the collaborators are loaded.
let collaboratorsByName;
const collaboratorByName = () => (collaboratorsByName ??= new Map(collaborators.map((c) => [normalizeName(c.name), c])));

// A field per language, for loc(): { en: 'Associate professor', ca: … }. For
// entries whose name or title is not translated, so localize() does not apply.
const perLanguage = (entry, key) => Object.fromEntries(languages.map((l) => [l, entry.data[l]?.[key] ?? '']));

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};
// [{ label, url }] from the CMS: entries without a URL are dropped, and a link
// without a label shows the site's name ("https://www.uib.es/…" -> "uib.es").
export const linksOf = (links) => (links ?? []).filter((l) => l?.url).map((l) => ({ url: l.url, label: l.label || hostOf(l.url) }));

const initialsOf = (name) => name.split(/\s+/).filter(Boolean).map((n) => n.charAt(0).toUpperCase()).slice(0, 2).join('');

// The entries of content/<dir>/ (all languages, edited in the CMS at /admin/),
// as `map` makes them from { entry, id, order, base }, listed by `order` (if
// they have one) and then by `name`, or by `sort` if given. Entries `map`
// returns nothing for are left out.
function loadCollection(dir, map, { sort, bundles = false, name = (x) => x.entry.base.title } = {}) {
  return readEntries(`content/${dir}`, { bundles })
    .map((entry) => map({ entry, id: entry.slug, order: Number(entry.base.order ?? 999), base: entry.base }))
    .filter(Boolean)
    .sort(sort ?? ((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(name(a) ?? '').localeCompare(String(name(b) ?? ''))));
}

// People outside the group who work with it. They have no profile page; their
// card lists their own `links`.
export const collaborators = loadCollection('collaborators', ({ entry, id, order, base: b }) => {
  const name = String(b.name ?? '').trim();
  if (!name) return null;
  return {
    entry,
    id,
    order,
    name,
    initials: initialsOf(name),
    role: perLanguage(entry, 'role'),
    institution: perLanguage(entry, 'institution'),
    links: linksOf(b.links),
    profile: { photo: b.photo },
  };
}, { name: (c) => c.name });

// Courses taught by members of the group, current and past: newest first, by
// start (or end) date; courses without dates last. `order` (then the title)
// only decides between courses that start in the same month.
export const courseTypes = ['microcredential', 'master', 'postgraduate', 'short', 'workshop', 'online', 'other'];
const monthsOf = (d) => (d ? d.year * 12 + (d.month ?? 1) : -Infinity);
export const courses = loadCollection('courses', ({ entry, id, order, base: b }) => ({
  entry,
  id,
  order,
  type: courseTypes.includes(b.type) ? b.type : 'other',
  start: parseLooseDate(b.start),
  end: parseLooseDate(b.end),
  format: b.format,
  languages: b.languages ?? [],
  ects: b.ects,
  hours: b.hours,
  url: b.url,
  // Taught when someone asks for it (e.g. in-house for a company), with no dates of its own.
  onDemand: Boolean(b.onDemand),
  // Courses with page text get a page of their own (/<lang>/teaching/courses/<slug>/).
  hasPage: languages.some((l) => String(entry.data[l]?.body ?? '').trim()),
  instructors: peopleOf(b.instructors, b.guestInstructors),
}), {
  sort: (a, b) =>
    monthsOf(b.start ?? b.end) - monthsOf(a.start ?? a.end) || a.order - b.order ||
    String(a.entry.base.title ?? '').localeCompare(String(b.entry.base.title ?? '')),
});

// The group's research lines.
export const researchLines = loadCollection('research-lines', ({ entry, id, order, base: b }) => ({
  entry,
  id,
  order,
  members: peopleOf(b.members),
}));

// PhD, master's and bachelor's theses supervised by members, newest first (by
// year: of the defence, or of the start if ongoing; ongoing first within a year).
export const thesisTypes = ['phd', 'master', 'bachelor'];
export const theses = loadCollection('theses', ({ entry, id, base: b }) => {
  const title = String(b.title ?? '').trim();
  if (!title) return null;
  return {
    entry,
    id,
    type: thesisTypes.includes(b.type) ? b.type : 'phd',
    title,
    student: String(b.student ?? '').trim(),
    year: b.year ? Number(b.year) : null,
    ongoing: b.status === 'ongoing',
    // The title is in the thesis's own language; these are translated.
    degree: perLanguage(entry, 'degree'),
    institution: perLanguage(entry, 'institution'),
    supervisors: peopleOf(b.supervisors, b.guestSupervisors),
    // People who helped without being supervisors ("With the support of").
    support: peopleOf(b.support, b.guestSupport),
    url: b.url || '',
    // The slug of the tool the thesis developed (content/tools/<slug>/), if any.
    tool: b.tool || '',
  };
}, { sort: (a, b) => (b.year ?? 0) - (a.year ?? 0) || b.ongoing - a.ongoing || a.title.localeCompare(b.title) });

// Each member's supervised (or supported) theses, for the "Theses" section of their profile.
for (const m of members) m.theses = theses.filter((x) => [...x.supervisors, ...x.support].some((p) => p.id === m.id));

// Each member's courses (as an instructor), for the "Courses" section of their profile.
for (const m of members) m.courses = courses.filter((c) => c.instructors.some((p) => p.id === m.id));

// Tools the group has developed: content/tools/<slug>/index.yaml, with their
// images next to it. Each one has one or more `tags` (research, teaching) and
// is listed, as a card, on the Tools page of each of those sections, and has a
// page of its own at /<lang>/tools/<slug>/; tools without a valid tag are left
// out. Their links are per language (see ToolCard).
export const toolTags = ['research', 'teaching'];
export const tools = loadCollection('tools', ({ entry, id, order, base: b }) => {
  const tags = [].concat(b.tags ?? []).filter((x) => toolTags.includes(x));
  if (!tags.length) return null;
  return {
    entry,
    id,
    order,
    tags,
    image: b.image || '',
  };
}, { bundles: true });
export const toolsFor = (tag) => tools.filter((x) => x.tags.includes(tag));

export function hasContent(cv, section) {
  if (section === 'theses') return cv.theses.length > 0;
  if (section === 'about') return Boolean(cv.about) || cv.profile.keywords.length > 0;
  if (section === 'publications') return cv.works.length > 0;
  return Array.isArray(cv[section]) && cv[section].length > 0;
}
