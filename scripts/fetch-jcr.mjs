#!/usr/bin/env node
// Fetches Journal Impact Factors from the Clarivate Journals API for the
// journals of the works in data/orcid.json, and writes data/jcr.json (same
// format as data/jcr.yaml, which takes precedence over it).
//
// Needs an API key with JCR access (https://developer.clarivate.com) in
// CLARIVATE_API_KEY; without one it does nothing.
//
// Usage: node scripts/fetch-jcr.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';

const API = 'https://api.clarivate.com/apis/wos-journals/v1';
const apiKey = process.env.CLARIVATE_API_KEY ?? '';
if (!apiKey) {
  console.log('CLARIVATE_API_KEY not set: skipping JCR fetch (data/jcr.yaml is still used).');
  process.exit(0);
}

const root = new URL('..', import.meta.url);
const readJson = (path) => readFile(new URL(path, root), 'utf8').then(JSON.parse).catch(() => null);
const orcid = await readJson('data/orcid.json');
const manual = parse(await readFile(new URL('data/jcr.yaml', root), 'utf8').catch(() => '')) ?? {};
const previous = (await readJson('data/jcr.json'))?.journals ?? [];

const normTitle = (s) => (s ?? '').normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase();

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-ApiKey': apiKey, Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  // Keep well under the API's per-second limit.
  await new Promise((r) => setTimeout(r, 600));
  return res.json();
}

// Journals to look up, with the years their works were published in.
const journals = [];
for (const w of orcid?.works ?? []) {
  if (w.type !== 'journal-article' || !w.venue) continue;
  const issn = (w.issn ?? manual.journals?.find((j) => normTitle(j.title) === normTitle(w.venue))?.issn ?? []).map(String);
  if (!issn.length) continue;
  const same = journals.find((j) => j.issn.some((s) => issn.includes(s)));
  if (same) same.years.push(w.date?.year);
  else journals.push({ title: w.venue, issn, years: [w.date?.year] });
}

// JCR for year Y is released in June of Y+1, so the latest available year is
// the last or the one before. Fetch from the earliest publication year onwards.
const lastYear = new Date().getFullYear() - 1;

// The rank in the category with the best quartile.
function bestRank(ranks = []) {
  return [...ranks].filter((r) => r.quartile).sort((a, b) => a.quartile.localeCompare(b.quartile))[0];
}

const out = [];
for (const j of journals) {
  const old = previous.find((p) => p.issn?.some((s) => j.issn.includes(s)));
  const entry = { title: j.title, issn: j.issn, jif: { ...old?.jif } };
  try {
    const hit = (await get(`/journals?q=${encodeURIComponent(j.issn[0])}`))?.hits?.[0];
    if (!hit) {
      console.warn(`  Not in JCR: ${j.title} (${j.issn.join(', ')})`);
      if (old) out.push(old);
      continue;
    }
    entry.title = hit.name ?? j.title;
    const from = Math.min(...j.years.filter(Boolean), lastYear - 1);
    for (let year = from; year <= lastYear; year++) {
      const report = await get(`/journals/${encodeURIComponent(hit.id)}/reports/year/${year}`);
      const value = report?.metrics?.impactMetrics?.jif;
      const rank = bestRank(report?.ranks?.jif);
      // Some journals have a category rank but no JIF.
      if (value == null && !rank) continue;
      entry.jif[year] = {
        ...(value != null ? { value } : {}),
        ...(rank ? { quartile: rank.quartile, rank: rank.rank, category: rank.category } : {}),
      };
    }
    console.log(`  ${entry.title}: ${Object.keys(entry.jif).join(', ') || 'no JIF'}`);
  } catch (err) {
    console.warn(`  JCR failed for ${j.title}: ${err.message}`);
  }
  out.push(entry);
}

await writeFile(new URL('data/jcr.json', root), JSON.stringify({ journals: out }, null, 2) + '\n');
console.log(`Wrote data/jcr.json: ${out.length} journals.`);
