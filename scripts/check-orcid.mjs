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
// With --issues, members with a `github:` user in site.config.yaml get a GitHub
// issue assigned to them instead (see "GitHub issues" below); needs
// GITHUB_TOKEN and GITHUB_REPOSITORY. --dry-run shows what it would do.
//
// Usage: node scripts/check-orcid.mjs [--strict] [--issues [--dry-run]]

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

async function loadMember({ id, orcid, github }) {
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
    // GitHub user to assign the issue to (`github:` in site.config.yaml).
    github: github ? String(github).trim().replace(/^@/, '') : null,
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
const describe = (key) => {
  const info = titles.get(key) ?? {};
  return { title: info.title ?? key, year: info.year, listedBy: [...(info.listedBy ?? [])] };
};
const inActions = process.env.GITHUB_ACTIONS === 'true';
// Annotation messages must escape %, \r and \n.
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const byMember = new Map(members.map((m) => [m, []]));
for (const x of missing) byMember.get(x.member).push(x);

// ---------- GitHub issues ----------
// With --issues, every member with a `github:` user in site.config.yaml gets one
// open issue (label "orcid") listing what is missing from their ORCID, assigned
// to them. The issue is updated when the list changes (with a comment when
// something new is missing) and closed when nothing is missing any more.
// --dry-run prints what would change without writing anything.

const LABEL = 'orcid';
const marker = (id) => `<!-- orcid-check:${id} -->`;
const keysOf = (body) => new Set(body?.match(/<!-- orcid-keys: (.*?) -->/)?.[1].split(' ').filter(Boolean) ?? []);

const dryRun = process.argv.includes('--dry-run');
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

async function gh(method, path, body) {
  if (dryRun && method !== 'GET') {
    console.log(`  [dry run] ${method} ${path}${body?.title ? `: ${body.title}` : ''}`);
    if (body?.body) console.log(body.body.replace(/^/gm, '  | '));
    return { number: '(new)', html_url: '(dry run)', assignees: [] };
  }
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`${method} ${path}: HTTP ${res.status} ${data?.message ?? ''}`), { status: res.status });
  return data;
}

function issueBody(m, list) {
  const lines = [
    marker(m.id),
    `<!-- orcid-keys: ${list.map((x) => x.key).join(' ')} -->`,
    `@${m.github}, these articles list you as an author but are not in your ORCID record ` +
      `([${m.orcid}](https://orcid.org/${m.orcid})), so they do not appear on your profile on the group's website:`,
    '',
  ];
  for (const { key, author } of list) {
    const { title, year, listedBy } = describe(key);
    lines.push(`- [ ] [${title}](${link(key)})${year ? ` (${year})` : ''}: signed as "${author}"` +
      (listedBy.length ? `, already in the ORCID of ${listedBy.join(', ')}` : ''));
  }
  lines.push(
    '',
    '**How to fix it:** in ORCID, go to *Works → Add → Search & link* (Crossref Metadata Search or Scopus), ' +
      'or *Add DOI* and paste the DOI. This issue is updated by the weekly check and closes itself once everything is in your ORCID.',
    '',
    `If an article is not yours (someone with a similar name), add it to \`data/people/${m.id}.yaml\`:`,
    '',
    '```yaml',
    'works:',
    `  - doi: ${list.find((x) => x.key.startsWith('doi:'))?.key.slice(4) ?? '10.1234/abcd'}`,
    '    notMine: true',
    '```',
    '',
    '<sub>Opened by `scripts/check-orcid.mjs`.</sub>',
  );
  return lines.join('\n');
}

async function syncIssues() {
  if (!repo || (!token && !dryRun)) throw new Error('--issues needs GITHUB_REPOSITORY and GITHUB_TOKEN');
  const open = token
    ? await gh('GET', `/repos/${repo}/issues?labels=${LABEL}&state=open&per_page=100`)
    : [];
  if (!dryRun) {
    await gh('POST', `/repos/${repo}/labels`, { name: LABEL, color: 'a6ce39', description: 'Works missing from a member’s ORCID' })
      .catch((err) => { if (err.status !== 422) throw err; }); // 422: it already exists
  }

  for (const [m, list] of byMember) {
    if (!m.github) continue;
    const issue = open.find((i) => i.body?.includes(marker(m.id)));
    const title = `Missing in ${m.name}'s ORCID: ${list.length} work${list.length === 1 ? '' : 's'}`;

    if (!list.length) {
      if (issue) {
        console.log(`${m.id}: everything is in ORCID now, closing #${issue.number}`);
        await gh('POST', `/repos/${repo}/issues/${issue.number}/comments`, { body: 'Everything is in your ORCID now, thanks! 🎉' });
        await gh('PATCH', `/repos/${repo}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
      }
      continue;
    }

    const body = issueBody(m, list);
    if (!issue) {
      let created;
      try {
        created = await gh('POST', `/repos/${repo}/issues`, { title, body, labels: [LABEL], assignees: [m.github] });
      } catch (err) {
        if (err.status !== 422) throw err;
        // The user cannot be assigned (no access to the repository, or a typo).
        console.log(`::warning title=${esc(`Cannot assign ${m.github}`)}::${esc(`${m.id}: GitHub user "${m.github}" cannot be assigned issues in ${repo}; the issue mentions them instead.`)}`);
        created = await gh('POST', `/repos/${repo}/issues`, { title, body, labels: [LABEL] });
      }
      console.log(`${m.id}: opened ${created.html_url} for @${m.github}`);
      m.issue = created.html_url;
      continue;
    }

    m.issue = issue.html_url;
    const before = keysOf(issue.body);
    const added = list.filter((x) => !before.has(x.key));
    if (issue.body === body && issue.title === title) {
      console.log(`${m.id}: ${issue.html_url} is up to date`);
      continue;
    }
    await gh('PATCH', `/repos/${repo}/issues/${issue.number}`, { title, body });
    if (!issue.assignees?.some((a) => a.login.toLowerCase() === m.github.toLowerCase())) {
      await gh('POST', `/repos/${repo}/issues/${issue.number}/assignees`, { assignees: [m.github] });
    }
    // Editing the body notifies nobody, so new findings get a comment.
    if (added.length) {
      await gh('POST', `/repos/${repo}/issues/${issue.number}/comments`, {
        body: `@${m.github}, ${added.length} more article${added.length === 1 ? ' is' : 's are'} missing:\n\n` +
          added.map(({ key }) => `- [${describe(key).title}](${link(key)})`).join('\n'),
      });
    }
    console.log(`${m.id}: updated ${issue.html_url} (${added.length} new)`);
  }
}

// ---------- Report ----------

const useIssues = process.argv.includes('--issues');
if (useIssues) {
  try {
    await syncIssues();
  } catch (err) {
    // Fall back to warnings for everyone.
    console.log(`::error title=Could not update the ORCID issues::${esc(err.message)}`);
    for (const m of members) m.github = null;
  }
}

for (const [m, list] of byMember) {
  if (!list.length) continue;
  const tracked = useIssues && m.github;
  console.log(`\n${m.name} (${m.id}, https://orcid.org/${m.orcid}) is missing ${list.length} work(s) in ORCID` +
    (tracked ? `, tracked in ${m.issue}` : '') + ':');
  for (const { key, author } of list) {
    const { title, year, listedBy } = describe(key);
    const line = `${title}${year ? ` (${year})` : ''}: ${link(key)}`;
    console.log(`  - ${line}\n      signed as "${author}", listed by ${listedBy.join(', ')}`);
    // Members with an issue are already notified; the rest only get a warning.
    if (inActions && !tracked) {
      console.log(`::warning title=${esc(`Missing in ${m.name}'s ORCID`)}::${esc(`${line} (signed as "${author}")`)}`);
    }
  }
}

const skipped = Object.values(articles).filter((r) => !r.authors?.length).length;
const noRecord = members.filter((m) => !m.hasRecord).map((m) => m.id);
const affected = [...byMember.values()].filter((l) => l.length).length;
console.log(
  `\n${missing.length ? `${missing.length} missing work(s) across ${affected} member(s)` : 'Every member lists all their co-authored articles'}` +
    ` (${Object.keys(articles).length} articles checked${skipped ? `, ${skipped} without an author list skipped` : ''}).`,
);
if (noRecord.length) console.log(`No ORCID data for: ${noRecord.join(', ')} (run npm run fetch).`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = ['### ORCID check', ''];
  if (!missing.length) md.push('Every member lists all the articles they co-author. ✅');
  for (const [m, list] of byMember) {
    if (!list.length) continue;
    const tracked = !useIssues ? '' : m.github && m.issue ? ` ([issue](${m.issue}), @${m.github})` : ' (no GitHub user: warning only)';
    md.push(`**${m.name}** ([ORCID](https://orcid.org/${m.orcid}))${tracked} is missing ${list.length}:`, '');
    for (const { key, author } of list) {
      const { title, year } = describe(key);
      md.push(`- [${title}](${link(key)})${year ? ` (${year})` : ''}, signed as "${author}"`);
    }
    md.push('');
  }
  md.push('', 'A wrong match (someone else with a similar name) can be silenced with `notMine: true` under `works:` in `data/people/<id>.yaml`.');
  await appendFile(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
}

if (missing.length && process.argv.includes('--strict')) process.exit(1);
