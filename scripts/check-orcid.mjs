#!/usr/bin/env node
// Warns when a member co-authors an article that is not in their ORCID record.
//
// Every article in data/works.json comes from some member's ORCID record and
// has its author list (from Crossref or SISTEDES). Each author is matched
// against every member, by their name variants (data/people/<id>.yaml), ORCID
// name and ORCID "other names", or loosely by family name plus first name or
// initial ("A. L. Mesquida", "Jose-David Pérez"). A member found among the
// authors who does not list the article in ORCID gets a warning.
//
// Uses the committed data only (run `npm run fetch` first for fresh data).
// Prints GitHub Actions warning annotations and a job summary when run in an
// action. Exits 0 unless --strict is passed and something is missing.
//
// A false match (another person with a similar name) is silenced in that
// member's data/people/<id>.yaml:
//
//   works:
//     - doi: 10.1234/abcd
//       notMine: true
//
// Usage: node scripts/check-orcid.mjs [--strict]

import { readFile, appendFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { articleKey, orcidFile, personFile } from '../src/lib/articles.js';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8').catch(() => null);
const readYaml = async (path) => parse((await read(path)) ?? '') ?? {};
const readJson = async (path) => JSON.parse((await read(path)) ?? 'null');

const config = await readYaml('site.config.yaml');
const articles = (await readJson('data/works.json')) ?? {};

// "Antoni‐Lluís Mesquida" -> "antoni lluis mesquida"; "Crespí, Antonio" -> "antonio crespi".
const norm = (s) =>
  String(s ?? '')
    .split(/\s*,\s*/).reverse().join(' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);

async function loadMember({ id, orcid }) {
  orcid = String(orcid).trim();
  const record = await readJson(orcidFile(orcid));
  const manual = await readYaml(personFile(id));
  const person = record?.person ?? {};
  const variants = [
    ...(manual.nameVariants ?? []),
    manual.profile?.name,
    person.name,
    `${person.givenNames ?? ''} ${person.familyName ?? ''}`,
    ...(person.otherNames ?? []),
  ].map(norm).filter(Boolean);
  const notMine = new Set(
    (manual.works ?? [])
      .filter((o) => o.notMine)
      .map((o) => articleKey({ doi: o.doi ? String(o.doi) : null, url: o.handle ? `hdl.handle.net/${o.handle}` : null }))
      .filter(Boolean),
  );
  return {
    id,
    orcid,
    name: manual.profile?.name || person.name || id,
    hasRecord: Boolean(record),
    keys: new Set((record?.works ?? []).map(articleKey).filter(Boolean)),
    notMine,
    exact: new Set(variants),
    // Family names: the first one of each variant's last part is enough
    // ("Pérez Cañellas" is often signed "Pérez").
    family: new Set([tokens(person.familyName)[0]].filter(Boolean)),
    // First names: from ORCID and from every variant ("Antoni", "Toni"…).
    given: new Set([...tokens(person.givenNames), ...variants.map((v) => v.split(' ')[0])]),
  };
}

const members = await Promise.all((config.members ?? []).map(loadMember));

function matches(member, author) {
  const a = norm(author);
  if (!a) return false;
  if (member.exact.has(a)) return true;
  const t = a.split(' ');
  if (t.length < 2 || !t.slice(1).some((x) => member.family.has(x))) return false;
  // Initial ("A. L. Mesquida") or a known first name ("Antoni Mesquida").
  const first = t[0];
  return first.length === 1
    ? [...member.given].some((g) => g.startsWith(first))
    : member.given.has(first);
}

// Titles live in the ORCID records, not in data/works.json.
const titles = new Map();
for (const m of members) {
  const record = await readJson(orcidFile(m.orcid));
  for (const w of record?.works ?? []) {
    const key = articleKey(w);
    if (key && !titles.has(key)) titles.set(key, { title: w.title, year: w.date?.year, listedBy: new Set() });
    if (key) titles.get(key).listedBy.add(m.id);
  }
}

const missing = []; // { member, key, author }
for (const [key, rec] of Object.entries(articles)) {
  for (const author of rec.authors ?? []) {
    for (const m of members) {
      if (!m.hasRecord || m.keys.has(key) || m.notMine.has(key)) continue;
      if (!matches(m, author)) continue;
      if (missing.some((x) => x.member === m && x.key === key)) continue;
      missing.push({ member: m, key, author });
    }
  }
}

const link = (key) => (key.startsWith('doi:') ? `https://doi.org/${key.slice(4)}` : `https://hdl.handle.net/${key.slice(4)}`);
const inActions = process.env.GITHUB_ACTIONS === 'true';
// Annotation messages must escape %, \r and \n.
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const byMember = new Map();
for (const x of missing) byMember.set(x.member, [...(byMember.get(x.member) ?? []), x]);

for (const [m, list] of byMember) {
  console.log(`\n${m.name} (${m.id}, https://orcid.org/${m.orcid}) is missing ${list.length} work(s) in ORCID:`);
  for (const { key, author } of list) {
    const info = titles.get(key) ?? {};
    const line = `${info.title ?? key}${info.year ? ` (${info.year})` : ''}: ${link(key)}`;
    console.log(`  - ${line}\n      signed as "${author}", listed by ${[...(info.listedBy ?? [])].join(', ')}`);
    if (inActions) {
      console.log(`::warning title=${esc(`Missing in ${m.name}'s ORCID`)}::${esc(`${line} (signed as "${author}")`)}`);
    }
  }
}

const skipped = Object.values(articles).filter((r) => !r.authors?.length).length;
const noRecord = members.filter((m) => !m.hasRecord).map((m) => m.id);
console.log(
  `\n${missing.length ? `${missing.length} missing work(s) across ${byMember.size} member(s)` : 'Every member lists all their co-authored articles'}` +
    ` (${Object.keys(articles).length} articles checked${skipped ? `, ${skipped} without an author list skipped` : ''}).`,
);
if (noRecord.length) console.log(`No ORCID data for: ${noRecord.join(', ')} (run npm run fetch).`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = ['### ORCID check', ''];
  if (!missing.length) md.push('Every member lists all the articles they co-author. ✅');
  for (const [m, list] of byMember) {
    md.push(`**${m.name}** ([ORCID](https://orcid.org/${m.orcid})) is missing ${list.length}:`, '');
    for (const { key, author } of list) {
      const info = titles.get(key) ?? {};
      md.push(`- [${info.title ?? key}](${link(key)})${info.year ? ` (${info.year})` : ''}, signed as "${author}"`);
    }
    md.push('');
  }
  md.push('', 'A wrong match (someone else with a similar name) can be silenced with `notMine: true` under `works:` in `data/people/<id>.yaml`.');
  await appendFile(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
}

if (missing.length && process.argv.includes('--strict')) process.exit(1);
