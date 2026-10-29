#!/usr/bin/env node
// Fetches the public ORCID record configured in cv.config.yaml, enriches works
// with Crossref (authors, venue) and OpenAlex (citations, open access), and
// writes a normalized, stable data/orcid.json used by the site.
//
// Usage: node scripts/fetch-orcid.mjs [--no-enrich]

import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';

const root = new URL('..', import.meta.url);
const config = parse(await readFile(new URL('cv.config.yaml', root), 'utf8'));
const orcid = String(config.orcid).trim();
const enrich = !process.argv.includes('--no-enrich');
const userAgent = `cv-online (https://github.com/; ${config.contactEmail ? 'mailto:' + config.contactEmail : 'no contact'})`;

async function getJson(url, headers = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': userAgent, ...headers } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
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
        authors: null,
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

// ---------- Enrichment ----------

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function enrichCrossref(list) {
  await pool(list.filter((w) => w.doi), 4, async (w) => {
    try {
      const msg = (await getJson(`https://api.crossref.org/works/${encodeURIComponent(w.doi)}`))?.message;
      if (!msg) return;
      w.authors = (msg.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' '));
      w.venue = w.venue ?? msg['container-title']?.[0] ?? msg.publisher ?? null;
      w.volume = msg.volume ?? null;
      w.issue = msg.issue ?? null;
      w.pages = msg.page ?? null;
      if (!w.date) {
        const parts = msg.issued?.['date-parts']?.[0];
        if (parts?.[0]) w.date = { year: parts[0], ...(parts[1] ? { month: parts[1] } : {}) };
      }
    } catch (err) {
      console.warn(`  Crossref failed for ${w.doi}: ${err.message}`);
    }
  });
}

// Optional: OpenAlex gives keyless requests only a small shared daily budget.
const openAlexKey = process.env.OPENALEX_API_KEY ?? '';

async function enrichOpenAlex(list) {
  const withDoi = list.filter((w) => w.doi);
  for (let i = 0; i < withDoi.length; i += 50) {
    const chunk = withDoi.slice(i, i + 50);
    const filter = chunk.map((w) => w.doi).join('|');
    try {
      const res = await getJson(
        `https://api.openalex.org/works?filter=doi:${encodeURIComponent(filter)}&per-page=50` +
          `&select=doi,cited_by_count,counts_by_year,open_access${openAlexKey ? `&api_key=${openAlexKey}` : ''}`,
      );
      for (const r of res?.results ?? []) {
        const doi = r.doi?.replace('https://doi.org/', '').toLowerCase();
        const w = chunk.find((x) => x.doi === doi);
        if (!w) continue;
        w.citations = r.cited_by_count ?? null;
        // { "2025": 3, "2026": 5 }: used for the citations-per-year chart.
        w.citationsByYear = Object.fromEntries(
          (r.counts_by_year ?? []).filter((c) => c.cited_by_count > 0).map((c) => [c.year, c.cited_by_count]).sort(),
        );
        w.openAccessUrl = r.open_access?.is_oa ? r.open_access.oa_url : null;
      }
    } catch (err) {
      console.warn(`  OpenAlex failed: ${err.message}`);
    }
  }
}

// ---------- Main ----------

console.log(`Fetching ORCID record ${orcid}…`);
const rec = await getJson(`https://pub.orcid.org/v3.0/${orcid}/record`, { Accept: 'application/json' });
if (!rec) throw new Error(`ORCID record ${orcid} not found`);
const a = rec['activities-summary'];

const data = {
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

if (enrich) {
  console.log(`Enriching ${data.works.filter((w) => w.doi).length} DOIs via Crossref…`);
  await enrichCrossref(data.works);
  if (config.features?.citations !== false) {
    console.log('Fetching citation counts from OpenAlex…');
    await enrichOpenAlex(data.works);
  }
}

await writeFile(new URL('data/orcid.json', root), JSON.stringify(data, null, 2) + '\n');
console.log(
  `Wrote data/orcid.json: ${data.works.length} works, ${data.employment.length} employments, ` +
  `${data.education.length} educations, ${data.funding.length} fundings, ${data.peerReview.length} review venues.`,
);
