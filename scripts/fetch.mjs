#!/usr/bin/env node
// Fetches the public ORCID record of every member in site.config.yaml and
// enriches their works once per article:
//
//   data/orcid/<orcid>.json  one per member: profile, affiliations, funding,
//                            peer review, and references to their works
//   data/works.json          one entry per article (by DOI or handle), shared
//                            by every member who lists it
//
// Article metadata that rarely changes (Crossref, SISTEDES, abstracts) is kept
// from earlier runs and refetched only when it is older than
// `fetch.refreshDays` in site.config.yaml; citations and open-access status
// (OpenAlex, batched) are refreshed on every run.
//
// Usage: node scripts/fetch.mjs [--no-enrich] [--refresh]
//   --no-enrich  only fetch the ORCID records
//   --refresh    refetch all article metadata, ignoring the cache

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { parse } from 'yaml';
import { articleKey, orcidFile, SISTEDES_HANDLE } from '../src/lib/articles.js';

const root = new URL('..', import.meta.url);
const config = parse(await readFile(new URL('site.config.yaml', root), 'utf8'));
const members = (config.members ?? []).map((m) => ({ ...m, orcid: String(m.orcid).trim() }));
if (!members.length) throw new Error('No members in site.config.yaml');

const enrich = !process.argv.includes('--no-enrich');
const refreshAll = process.argv.includes('--refresh');
const refreshDays = Number(config.fetch?.refreshDays ?? 30);
const today = new Date().toISOString().slice(0, 10);
const userAgent = `cv-online (https://github.com/; ${config.contactEmail ? 'mailto:' + config.contactEmail : 'no contact'})`;

const readJson = (path) => readFile(new URL(path, root), 'utf8').then(JSON.parse).catch(() => null);
const writeJson = (path, data) => writeFile(new URL(path, root), JSON.stringify(data, null, 2) + '\n');

async function getJson(url, headers = {}, tries = 3, body = undefined) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent, ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// ---------- ORCID normalization ----------

const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x ?? null);

function date(d) {
  if (!d || !v(d.year)) return null;
  const out = { year: Number(v(d.year)) };
  if (v(d.month)) out.month = Number(v(d.month));
  return out;
}

function org(o) {
  if (!o) return null;
  return {
    name: o.name,
    city: o.address?.city ?? null,
    region: o.address?.region ?? null,
    country: o.address?.country ?? null,
  };
}

function affiliations(section, key) {
  const groups = section?.['affiliation-group'] ?? [];
  return groups
    .flatMap((g) => g.summaries.map((s) => s[key]))
    .filter(Boolean)
    .map((s) => ({
      putCode: s['put-code'],
      role: s['role-title'] ?? null,
      department: s['department-name'] ?? null,
      organization: org(s.organization),
      start: date(s['start-date']),
      end: date(s['end-date']),
      url: v(s.url),
    }))
    .sort(byDateDesc);
}

function byDateDesc(a, b) {
  const key = (x) => {
    const d = x.end ?? x.date ?? x.start;
    // Ongoing items (no end date but a start) go first.
    if (!x.end && x.start && !x.date) return 99999999;
    return d ? d.year * 100 + (d.month ?? 0) : 0;
  };
  return key(b) - key(a) || ((b.start?.year ?? 0) - (a.start?.year ?? 0));
}

function externalId(ids, type) {
  const id = (ids?.['external-id'] ?? []).find(
    (e) => e['external-id-type'] === type && e['external-id-relationship'] !== 'part-of',
  );
  return id ? v(id['external-id-normalized']) ?? id['external-id-value'] : null;
}

// Only what ORCID says about each work; enrichment goes to data/works.json.
function works(section) {
  return (section?.group ?? [])
    .map((g) => {
      // ORCID shows the summary with the highest display-index as preferred.
      const s = [...g['work-summary']].sort(
        (a, b) => Number(b['display-index'] ?? 0) - Number(a['display-index'] ?? 0),
      )[0];
      const doi = (externalId(g['external-ids'], 'doi') ?? externalId(s['external-ids'], 'doi'))?.toLowerCase() ?? null;
      return {
        putCode: s['put-code'],
        type: s.type,
        title: v(s.title?.title) ?? '',
        subtitle: v(s.title?.subtitle),
        venue: v(s['journal-title']),
        date: date(s['publication-date']),
        doi,
        arxiv: externalId(g['external-ids'], 'arxiv'),
        url: v(s.url) ?? (doi ? `https://doi.org/${doi}` : null),
      };
    })
    .sort(byDateDesc);
}

function fundings(section) {
  return (section?.group ?? [])
    .map((g) => g['funding-summary'][0])
    .map((s) => ({
      putCode: s['put-code'],
      title: v(s.title?.title) ?? '',
      type: s.type,
      organization: org(s.organization),
      grantNumber: externalId(s['external-ids'], 'grant_number'),
      start: date(s['start-date']),
      end: date(s['end-date']),
      url: v(s.url),
    }))
    .sort(byDateDesc);
}

// Peer reviews are aggregated per venue: "Reviewer for X (n reviews, 2019–2025)".
function peerReviews(section) {
  const byVenue = new Map();
  for (const g of section?.group ?? []) {
    for (const pg of g['peer-review-group'] ?? []) {
      for (const s of pg['peer-review-summary'] ?? []) {
        const name = s['convening-organization']?.name ?? s['review-group-id'];
        const year = Number(v(s['completion-date']?.year)) || null;
        const e = byVenue.get(name) ?? { venue: name, count: 0, firstYear: null, lastYear: null };
        e.count++;
        if (year) {
          e.firstYear = Math.min(e.firstYear ?? year, year);
          e.lastYear = Math.max(e.lastYear ?? year, year);
        }
        byVenue.set(name, e);
      }
    }
  }
  return [...byVenue.values()].sort((a, b) => b.count - a.count || a.venue.localeCompare(b.venue));
}

function person(p) {
  const n = p.name ?? {};
  const given = v(n['given-names']) ?? '';
  const family = v(n['family-name']) ?? '';
  return {
    name: v(n['credit-name']) ?? `${given} ${family}`.trim(),
    givenNames: given,
    familyName: family,
    otherNames: (p['other-names']?.['other-name'] ?? []).map((o) => o.content),
    biography: p.biography?.content ?? null,
    keywords: (p.keywords?.keyword ?? []).map((k) => k.content),
    links: (p['researcher-urls']?.['researcher-url'] ?? []).map((u) => ({
      label: u['url-name'] || v(u.url),
      url: v(u.url),
    })),
    identifiers: (p['external-identifiers']?.['external-identifier'] ?? []).map((i) => ({
      type: i['external-id-type'],
      value: i['external-id-value'],
      url: v(i['external-id-url']),
    })),
    emails: (p.emails?.email ?? []).map((e) => e.email),
  };
}

async function fetchRecord(orcid) {
  const rec = await getJson(`https://pub.orcid.org/v3.0/${orcid}/record`, { Accept: 'application/json' });
  if (!rec) throw new Error(`ORCID record ${orcid} not found`);
  const a = rec['activities-summary'];
  return {
    orcid,
    lastModified: rec.history?.['last-modified-date']?.value
      ? new Date(rec.history['last-modified-date'].value).toISOString().slice(0, 10)
      : null,
    person: person(rec.person),
    employment: affiliations(a.employments, 'employment-summary'),
    education: affiliations(a.educations, 'education-summary'),
    qualifications: affiliations(a.qualifications, 'qualification-summary'),
    distinctions: affiliations(a.distinctions, 'distinction-summary'),
    invitedPositions: affiliations(a['invited-positions'], 'invited-position-summary'),
    memberships: affiliations(a.memberships, 'membership-summary'),
    service: affiliations(a.services, 'service-summary'),
    funding: fundings(a.fundings),
    works: works(a.works),
    peerReview: peerReviews(a['peer-reviews']),
  };
}

// ---------- Article enrichment ----------
// Each enricher takes a list of { key, doi, url, rec } targets and fills `rec`,
// the article's entry in data/works.json, in place.

// Abstracts come as plain text (Semantic Scholar, SISTEDES), JATS XML (Crossref)
// or an inverted index (OpenAlex). Normalize to plain text.
function cleanAbstract(text) {
  if (!text) return null;
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(abstract|resumen|resum)\s*[:.—-]?\s*/i, '');
  return plain.length >= 40 ? plain : null;
}

// Abstract sources run in order of preference; each only fills what is missing,
// and abstracts found by earlier runs are kept (sources are flaky).
function setAbstract(rec, text, source) {
  if (rec.abstract) return;
  const clean = cleanAbstract(text);
  if (clean) Object.assign(rec, { abstract: clean, abstractSource: source });
}

// OpenAlex stores abstracts as { word: [positions] }.
function fromInvertedIndex(index) {
  if (!index) return null;
  const words = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return words.filter(Boolean).join(' ');
}

async function enrichCrossref(targets) {
  await pool(targets.filter((t) => t.doi), 4, async ({ doi, rec }) => {
    try {
      const msg = (await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`))?.message;
      if (!msg) return;
      rec.authors = (msg.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' '));
      rec.venue = msg['container-title']?.[0] ?? msg.publisher ?? null;
      rec.volume = msg.volume ?? null;
      rec.issue = msg.issue ?? null;
      rec.pages = msg.page ?? null;
      // Used to look up the journal's impact factor (data/jcr.*).
      rec.issn = msg.ISSN?.length ? msg.ISSN : null;
      // Only used when the ORCID record has no date.
      const parts = msg.issued?.['date-parts']?.[0];
      rec.date = parts?.[0] ? { year: parts[0], ...(parts[1] ? { month: parts[1] } : {}) } : null;
      setAbstract(rec, msg.abstract, 'Crossref');
    } catch (err) {
      console.warn(`  Crossref failed for ${doi}: ${err.message}`);
    }
  });
}

// SISTEDES digital library (JISBD, JCIS, PROLE…): works whose URL is a handle
// under prefix 11705. The handle resolves to a DSpace item whose public REST API
// gives authors (with their ORCID iDs) and the abstract.
const SISTEDES_API = 'https://biblioteca.sistedes.es/dspace.server/api';

// "Crespí, Antonio" -> "Antonio Crespí"
const givenFirst = (name) => name.split(/,\s*/).reverse().join(' ').trim();

async function enrichSistedes(targets) {
  await pool(targets.filter((t) => SISTEDES_HANDLE.test(t.url ?? '')), 2, async ({ url, rec }) => {
    try {
      const handle = url.match(SISTEDES_HANDLE)[1];
      // Citation handles (11705/JISBD/2025/101) point to the item handle (11705/3479).
      const record = await getJson(`https://hdl.handle.net/api/handles/${handle}`);
      const target = record?.values?.find((x) => x.type === 'URL')?.data?.value ?? '';
      const itemHandle = target.match(/11705\/[^/?#]+$/)?.[0] ?? handle;
      const item = await getJson(`${SISTEDES_API}/pid/find?id=${encodeURIComponent(itemHandle)}`);
      const m = item?.metadata;
      if (!m) return;
      const values = (key) => (m[key] ?? []).map((x) => x.value);
      // "signature" is how each author signs the paper; fall back to the full name.
      const authors = values('dc.contributor.signature').length ? values('dc.contributor.signature') : values('dc.contributor.author');
      if (!rec.authors?.length && authors.length) rec.authors = authors.map(givenFirst);
      setAbstract(rec, values('dc.description.abstract')[0], 'SISTEDES');
      rec.venue = rec.venue ?? values('bs.proceedings.name')[0] ?? null;
      rec.license = rec.license ?? values('dc.rights.license')[0] ?? null;
    } catch (err) {
      console.warn(`  SISTEDES failed for ${url}: ${err.message}`);
    }
  });
}

// Semantic Scholar: abstracts and one-sentence "TLDR" summaries, in batches of 500.
// Optional key (higher rate limits): SEMANTIC_SCHOLAR_API_KEY.
async function enrichSemanticScholar(targets) {
  const withDoi = targets.filter((t) => t.doi);
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY;
  for (let i = 0; i < withDoi.length; i += 500) {
    const chunk = withDoi.slice(i, i + 500);
    try {
      const res = await getJson(
        'https://api.semanticscholar.org/graph/v1/paper/batch?fields=abstract,tldr',
        key ? { 'x-api-key': key } : {},
        3,
        { ids: chunk.map((t) => `DOI:${t.doi}`) },
      );
      // The response is in request order, with null for unknown DOIs.
      (res ?? []).forEach((paper, j) => {
        if (!paper) return;
        const { rec } = chunk[j];
        setAbstract(rec, paper.abstract, 'Semantic Scholar');
        if (paper.tldr?.text) rec.tldr = paper.tldr.text;
      });
    } catch (err) {
      console.warn(`  Semantic Scholar failed: ${err.message}`);
    }
  }
}

// OpenAlex: citations, open access and abstracts, in batches of 50 DOIs.
// Optional key: keyless requests only get a small shared daily budget.
const openAlexKey = process.env.OPENALEX_API_KEY ?? '';

async function enrichOpenAlex(targets) {
  const withDoi = targets.filter((t) => t.doi);
  for (let i = 0; i < withDoi.length; i += 50) {
    const chunk = withDoi.slice(i, i + 50);
    const byDoi = new Map(chunk.map((t) => [t.doi, t]));
    try {
      const res = await getJson(
        `https://api.openalex.org/works?filter=doi:${encodeURIComponent(chunk.map((t) => t.doi).join('|'))}&per-page=50` +
          `&select=doi,cited_by_count,counts_by_year,open_access,best_oa_location,primary_location,abstract_inverted_index${openAlexKey ? `&api_key=${openAlexKey}` : ''}`,
      );
      for (const r of res?.results ?? []) {
        const t = byDoi.get(r.doi?.replace('https://doi.org/', '').toLowerCase());
        if (!t) continue;
        const { rec } = t;
        rec.openAccessUrl = r.open_access?.is_oa ? r.open_access.oa_url : null;
        rec.openAccess = r.open_access?.is_oa
          ? { status: r.open_access.oa_status, license: r.best_oa_location?.license ?? r.primary_location?.license ?? null }
          : null;
        setAbstract(rec, fromInvertedIndex(r.abstract_inverted_index), 'OpenAlex');
        if (config.features?.citations === false) continue;
        rec.citations = r.cited_by_count ?? null;
        // { "2025": 3, "2026": 5 }: used for the citations-per-year chart.
        rec.citationsByYear = Object.fromEntries(
          (r.counts_by_year ?? []).filter((c) => c.cited_by_count > 0).map((c) => [c.year, c.cited_by_count]).sort(),
        );
      }
    } catch (err) {
      console.warn(`  OpenAlex failed: ${err.message}`);
    }
  }
}

// ---------- Main ----------

await mkdir(new URL('data/orcid/', root), { recursive: true });

// 1. ORCID records, one per member. If one fails, keep its previous file.
const records = new Map();
let failed = 0;
await pool(members, 4, async (m) => {
  try {
    const record = await fetchRecord(m.orcid);
    await writeJson(orcidFile(m.orcid), record);
    records.set(m.orcid, record);
    console.log(`  ${m.id} (${m.orcid}): ${record.works.length} works, ${record.employment.length} employments, ` +
      `${record.funding.length} fundings, ${record.peerReview.length} review venues`);
  } catch (err) {
    failed++;
    console.warn(`  ORCID failed for ${m.id} (${m.orcid}), keeping the previous data: ${err.message}`);
    const previous = await readJson(orcidFile(m.orcid));
    if (previous) records.set(m.orcid, previous);
  }
});
if (failed === members.length) throw new Error('Could not fetch any ORCID record');

// Records of people who are no longer members.
for (const name of await readdir(new URL('data/orcid/', root))) {
  if (name.endsWith('.json') && !members.some((m) => `${m.orcid}.json` === name)) {
    await unlink(new URL(`data/orcid/${name}`, root));
    console.log(`  Removed data/orcid/${name} (not a member any more)`);
  }
}

// 2. Unique articles across all members.
const targets = new Map();
for (const m of members) {
  for (const w of records.get(m.orcid)?.works ?? []) {
    const key = articleKey(w);
    if (!key) continue;
    if (!targets.has(key)) targets.set(key, { key, doi: w.doi, url: w.url, members: new Set() });
    targets.get(key).members.add(m.id);
  }
}
const shared = [...targets.values()].filter((t) => t.members.size > 1).length;
console.log(`${targets.size} unique articles across ${members.length} members (${shared} shared by several).`);

if (enrich) {
  // Start from what earlier runs found; articles no member lists any more are dropped.
  const previous = (await readJson('data/works.json')) ?? {};
  for (const t of targets.values()) t.rec = { ...previous[t.key] };
  const all = [...targets.values()];

  // Stable metadata: only articles that are new or whose metadata is stale.
  const staleBefore = new Date(Date.now() - refreshDays * 86400000).toISOString().slice(0, 10);
  const stale = all.filter((t) => refreshAll || !t.rec.metadataFetched || t.rec.metadataFetched < staleBefore);
  if (stale.length) {
    console.log(`Fetching metadata of ${stale.length} new or stale articles from Crossref and SISTEDES…`);
    await enrichCrossref(stale);
    await enrichSistedes(stale);
    for (const t of stale) t.rec.metadataFetched = today;
  } else {
    console.log('Article metadata is up to date.');
  }

  if (config.features?.abstracts !== false) {
    // Articles with no abstract yet; summaries (TLDR) are retried on refresh.
    const missing = all.filter((t) => !t.rec.abstract || stale.includes(t));
    if (missing.length) {
      console.log(`Fetching abstracts and summaries of ${missing.length} articles from Semantic Scholar…`);
      await enrichSemanticScholar(missing);
    }
  }

  console.log(`Fetching citations and open-access status of ${all.filter((t) => t.doi).length} DOIs from OpenAlex…`);
  await enrichOpenAlex(all);

  if (config.features?.abstracts === false) {
    for (const t of all) for (const k of ['abstract', 'abstractSource', 'tldr']) delete t.rec[k];
  }
  if (config.features?.citations === false) {
    for (const t of all) for (const k of ['citations', 'citationsByYear']) delete t.rec[k];
  }

  const out = Object.fromEntries(all.sort((a, b) => a.key.localeCompare(b.key)).map((t) => [t.key, t.rec]));
  await writeJson('data/works.json', out);
  console.log(`Wrote data/works.json: ${all.length} articles.`);
}
