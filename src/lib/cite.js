// Citation boxes in Markdown (news, tools, research lines): a ```cite block
// becomes a box with the reference in several formats (IEEE, APA, Chicago,
// BibTeX, RIS), as tabs, each with a button to copy it.
//
// The block holds either a DOI of one of the group's publications (taken from
// the members' ORCID records), or a BibTeX entry, for anything else:
//
//   ```cite
//   doi:10.1002/cae.21990
//   ```
//
//   ```cite
//   @phdthesis{crespi2027prm,
//     author = {Crespí Tobeña, Antonio},
//     title  = {A Process Reference Model for Machine Learning Applications},
//     school = {Universitat de les Illes Balears},
//     year   = {2027}
//   }
//   ```
//
// A reference is turned into one shape (`ref` below), and each format is
// written from it. The styles follow their usual English conventions in every
// language, as references do in papers.
import { group, members } from './data.js';
import { authorMatcher } from './authors.js';

// ---------- Reading a reference ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cleanDoi = (d) => String(d ?? '').trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, '');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (m) => {
  if (m == null || m === '') return null;
  if (/^\d+$/.test(String(m))) return Number(m) >= 1 && Number(m) <= 12 ? Number(m) : null;
  const i = MONTHS.indexOf(String(m).trim().slice(0, 3).toLowerCase());
  return i >= 0 ? i + 1 : null;
};

// LaTeX accents and symbols that BibTeX entries often use, as Unicode.
const ACCENTS = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', c: '̧', u: '̆', v: '̌', H: '̋', k: '̨' };
const SYMBOLS = { o: 'ø', O: 'Ø', ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ' };
function delatex(s) {
  return String(s ?? '')
    .replace(/\\([`'^"~=.]|[cuvHk](?=[\s{]))\s*\{?\\?([a-zA-Z])\}?/g, (m, a, ch) => (ch + ACCENTS[a]).normalize('NFC'))
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|[oOlLij])(?![a-zA-Z])\s?/g, (m, s) => SYMBOLS[s])
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/~/g, ' ')
    .replace(/\\[a-zA-Z]+\s*/g, '') // other commands (\emph, \textit…): keep their text
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Splits `s` on `sep` (a regular expression) outside braces.
function splitTop(s, sep) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (depth === 0) {
      const m = s.slice(i).match(sep);
      if (m && m.index === 0) { parts.push(s.slice(start, i)); i += m[0].length - 1; start = i + 1; }
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// One BibTeX entry: { type, key, fields } (field names in lower case), or null.
export function parseBibtex(src) {
  const head = src.match(/@\s*(\w+)\s*\{\s*([^,\s]*)\s*,/);
  if (!head) return null;
  const fields = {};
  let i = head.index + head[0].length;
  while (i < src.length) {
    const m = src.slice(i).match(/^[\s,]*([\w:.-]+)\s*=\s*/);
    if (!m) break;
    i += m[0].length;
    let value = '';
    if (src[i] === '{') {
      let depth = 0, j = i;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) break;
      }
      value = src.slice(i + 1, j);
      i = j + 1;
    } else if (src[i] === '"') {
      const j = src.indexOf('"', i + 1);
      value = src.slice(i + 1, j);
      i = j + 1;
    } else {
      const v = src.slice(i).match(/^[^,}\s]+/)?.[0] ?? '';
      value = v;
      i += v.length;
    }
    fields[m[1].toLowerCase()] = value;
  }
  return { type: head[1].toLowerCase(), key: head[2], fields };
}

// A BibTeX name ("Crespí Tobeña, Antonio", "Antonio {Crespí Tobeña}",
// "Ludwig van Beethoven") as { given, family }.
function bibName(raw) {
  const parts = splitTop(raw, /^,/);
  if (parts.length >= 2) return { family: delatex(parts[0]), given: delatex(parts.slice(1).reverse().join(' ')) };
  const tokens = splitTop(raw, /^\s+/);
  if (tokens.length === 1) return { family: delatex(tokens[0]), given: '' };
  // "von" part: the first lower-case word before the last one starts the family name.
  let i = tokens.findIndex((t, k) => k < tokens.length - 1 && /^[a-z]/.test(t));
  if (i <= 0) i = tokens.length - 1;
  return { family: delatex(tokens.slice(i).join(' ')), given: delatex(tokens.slice(0, i).join(' ')) };
}

// A name as it is written in a publication's author list ("Antoni-Lluís
// Mesquida", "Antonio Crespí Tobeña") as { given, family }. Members' family
// names come from ORCID, so that double surnames stay whole; for anyone else
// the last word, with any particles before it ("de", "van"…), is the family name.
const isMember = authorMatcher(members);
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function plainName(raw) {
  const name = String(raw).trim();
  if (name.includes(',')) return bibName(name);
  const tokens = name.split(/\s+/);
  const member = isMember(name);
  if (member?.familyName) {
    const first = fold(member.familyName.split(/\s+/)[0]);
    const i = tokens.findIndex((t, k) => k > 0 && fold(t) === first);
    if (i > 0) return { given: tokens.slice(0, i).join(' '), family: tokens.slice(i).join(' ') };
  }
  let i = tokens.length - 1;
  while (i > 1 && /^(de|del|della|di|da|van|von|der|den|la|le|du|dos|das|i|y)$/i.test(tokens[i - 1])) i--;
  return { given: tokens.slice(0, i).join(' '), family: tokens.slice(i).join(' ') };
}

// The reference all formats are written from.
//   kind: article | inproceedings | incollection | book | phdthesis |
//         mastersthesis | techreport | misc
function fromBibtex({ type, key, fields: f }) {
  const kinds = { conference: 'inproceedings', inbook: 'incollection', thesis: 'phdthesis', report: 'techreport', online: 'misc', electronic: 'misc', unpublished: 'misc' };
  const kind = ['article', 'inproceedings', 'incollection', 'book', 'phdthesis', 'mastersthesis', 'techreport', 'misc'].includes(type) ? type : kinds[type] ?? 'misc';
  const names = (s) => (s ? splitTop(s, /^\s+and\s+/i).map(bibName) : []);
  return {
    kind,
    key,
    authors: names(f.author),
    editors: names(f.editor),
    title: delatex(f.title),
    container: delatex(f.journal || f.journaltitle || f.booktitle || f.howpublished || ''),
    year: delatex(f.year || f.date?.slice(0, 4) || ''),
    month: monthOf(delatex(f.month)),
    volume: delatex(f.volume),
    number: delatex(f.number || f.issue),
    pages: delatex(f.pages).replace(/\s*[-–]+\s*/, '–'),
    publisher: delatex(f.publisher),
    address: delatex(f.address || f.location),
    school: delatex(f.school || f.institution || f.organization),
    doi: cleanDoi(f.doi),
    url: f.url ? f.url.trim() : '',
  };
}

// "COMPUTER APPLICATIONS IN ENGINEERING EDUCATION" -> "Computer Applications in
// Engineering Education" (some ORCID records hold venues in capitals).
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'de', 'del', 'la', 'el', 'en', 'i', 'y']);
const titleCase = (s) =>
  /\p{Ll}/u.test(s) ? s : s.toLowerCase().replace(/[\p{L}\p{N}]+/gu, (w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));

const WORK_KINDS = {
  'journal-article': 'article', review: 'article', 'magazine-article': 'article',
  'conference-paper': 'inproceedings', 'conference-abstract': 'inproceedings', 'conference-poster': 'inproceedings', 'conference-output': 'inproceedings',
  'book-chapter': 'incollection', 'encyclopedia-entry': 'incollection',
  book: 'book', 'edited-book': 'book',
  'dissertation-thesis': 'phdthesis',
  report: 'techreport', 'working-paper': 'techreport',
};
function fromWork(w) {
  return {
    kind: WORK_KINDS[w.type] ?? (w.venue ? 'article' : 'misc'),
    key: '',
    authors: (w.authors ?? []).map(plainName),
    editors: [],
    title: w.title ?? '',
    container: titleCase(w.venue ?? ''),
    year: w.date?.year ? String(w.date.year) : '',
    month: w.date?.month ?? null,
    volume: w.volume ?? '',
    number: w.issue ?? '',
    pages: (w.pages ?? '').replace(/\s*[-–]+\s*/, '–'),
    publisher: '',
    address: '',
    school: '',
    doi: cleanDoi(w.doi),
    url: w.doi ? '' : w.url ?? '',
  };
}

const worksByDoi = new Map(group.works.filter((w) => w.doi).map((w) => [cleanDoi(w.doi).toLowerCase(), w]));

// The reference in a ```cite block, or an error message.
export function readCitation(text) {
  const src = String(text ?? '').trim();
  if (src.startsWith('@')) {
    const entry = parseBibtex(src);
    if (!entry?.fields.title) return { error: 'the BibTeX entry could not be read (it needs at least a title)' };
    return { ref: fromBibtex(entry), bibtex: src };
  }
  const doi = cleanDoi(src);
  if (/^10\.\S+\/\S+$/.test(doi)) {
    const work = worksByDoi.get(doi.toLowerCase());
    if (!work) return { error: `no publication of the group has the DOI ${doi}; paste its BibTeX instead` };
    return { ref: fromWork(work) };
  }
  return { error: 'write a DOI of one of the group’s publications, or a BibTeX entry' };
}

// ---------- Writing it in each format ----------

// "Antoni-Lluís" -> "A.-L.", "Maria del Carmen" -> "M. C.", "J. S." -> "J. S."
const initials = (given) =>
  given.split(/\s+/).filter((g) => /^\p{Lu}/u.test(g))
    .map((g) => g.split('-').map((p) => `${p.charAt(0)}.`).join('-'))
    .join(' ');
const list = (names, and, { serial = true } = {}) =>
  names.length <= 2 ? names.join(` ${and} `) : `${names.slice(0, -1).join(', ')}${serial ? ',' : ''} ${and} ${names.at(-1)}`;
const end = (s) => (/[.?!]$/.test(s) ? s : `${s}.`);
const doiUrl = (r) => (r.doi ? `https://doi.org/${r.doi}` : r.url);
const link = (u) => `<a href="${esc(u)}">${esc(u)}</a>`;
const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

// IEEE Reference Guide.
function ieee(r) {
  const names = r.authors.map((a) => [initials(a.given), a.family].filter(Boolean).join(' '));
  const who = names.length > 6 ? `${names[0]} <i>et al.</i>` : list(names.map(esc), 'and');
  const date = [r.month ? MONTH_ABBR[r.month - 1] : '', r.year].filter(Boolean).join(' ');
  const pages = r.pages ? (/[–,]/.test(r.pages) ? `pp. ${esc(r.pages)}` : `p. ${esc(r.pages)}`) : '';
  const quoted = `“${esc(r.title)},”`;
  const parts = [];
  switch (r.kind) {
    case 'article':
      parts.push(quoted, [`<i>${esc(r.container)}</i>`, r.volume && `vol. ${esc(r.volume)}`, r.number && `no. ${esc(r.number)}`, pages, date].filter(Boolean).join(', '));
      break;
    case 'inproceedings':
      parts.push(quoted, [`in <i>${esc(r.container)}</i>`, esc(r.address), date, pages].filter(Boolean).join(', '));
      break;
    case 'incollection':
      parts.push(quoted, `in <i>${esc(r.container)}</i>,`, [r.address && r.publisher ? `${esc(r.address)}: ${esc(r.publisher)}` : esc(r.publisher || r.address), date, pages].filter(Boolean).join(', '));
      break;
    case 'book':
      parts.push(`<i>${esc(r.title)}</i>.`, [r.address && r.publisher ? `${esc(r.address)}: ${esc(r.publisher)}` : esc(r.publisher || r.address), date].filter(Boolean).join(', '));
      break;
    case 'phdthesis':
    case 'mastersthesis':
      parts.push(quoted, [r.kind === 'phdthesis' ? 'Ph.D. dissertation' : 'M.S. thesis', esc(r.school), esc(r.address), date].filter(Boolean).join(', '));
      break;
    case 'techreport':
      parts.push(quoted, [esc(r.school), esc(r.address), r.number ? `Tech. Rep. ${esc(r.number)}` : 'Tech. Rep.', date].filter(Boolean).join(', '));
      break;
    default:
      parts.push(quoted, [esc(r.container), date].filter(Boolean).join(', '));
  }
  let out = `${who}, ${parts.join(' ')}`.replace(/,\s*$/, '');
  out = end(out);
  if (r.doi) out += ` doi: <a href="https://doi.org/${esc(r.doi)}">${esc(r.doi)}</a>.`;
  else if (r.url) out += ` [Online]. Available: ${link(r.url)}`;
  return out;
}

// APA, 7th edition.
function apa(r) {
  const names = r.authors.map((a) => [a.family, initials(a.given)].filter(Boolean).join(', '));
  const who = names.length > 20
    ? `${names.slice(0, 19).map(esc).join(', ')}, … ${esc(names.at(-1))}`
    : names.length <= 1 ? esc(names[0] ?? '') : `${names.slice(0, -1).map(esc).join(', ')}, &amp; ${esc(names.at(-1))}`;
  const head = `${who} (${esc(r.year || 'n.d.')}).`;
  const pages = r.pages ? esc(r.pages) : '';
  let body;
  switch (r.kind) {
    case 'article':
      body = `${esc(end(r.title))} <i>${esc(r.container)}</i>${r.volume ? `, <i>${esc(r.volume)}</i>` : ''}${r.number ? `(${esc(r.number)})` : ''}${pages ? `, ${pages}` : ''}.`;
      break;
    case 'inproceedings':
    case 'incollection':
      body = `${esc(end(r.title))} In <i>${esc(r.container)}</i>${pages ? ` (pp. ${pages})` : ''}.${r.publisher ? ` ${esc(end(r.publisher))}` : ''}`;
      break;
    case 'book':
      body = `<i>${esc(end(r.title))}</i>${r.publisher ? ` ${esc(end(r.publisher))}` : ''}`;
      break;
    case 'phdthesis':
    case 'mastersthesis':
      body = `<i>${esc(r.title)}</i> [${r.kind === 'phdthesis' ? 'Doctoral dissertation' : 'Master’s thesis'}${r.school ? `, ${esc(r.school)}` : ''}].`;
      break;
    case 'techreport':
      body = `<i>${esc(r.title)}</i>${r.number ? ` (Report No. ${esc(r.number)})` : ''}.${r.school ? ` ${esc(end(r.school))}` : ''}`;
      break;
    default:
      body = `<i>${esc(end(r.title))}</i>${r.container ? ` ${esc(end(r.container))}` : ''}`;
  }
  const u = doiUrl(r);
  return `${head} ${body}${u ? ` ${link(u)}` : ''}`;
}

// Chicago Manual of Style, 17th edition, bibliography.
function chicago(r) {
  const names = r.authors.map((a, i) => (i === 0 ? [a.family, a.given].filter(Boolean).join(', ') : [a.given, a.family].filter(Boolean).join(' ')));
  const who = names.length > 10 ? `${names.slice(0, 7).map(esc).join(', ')}, et al.`
    : names.length === 2 ? `${esc(names[0])}, and ${esc(names[1])}` : list(names.map(esc), 'and');
  const quoted = `“${esc(end(r.title))}”`;
  const place = [r.address && r.publisher ? `${esc(r.address)}: ${esc(r.publisher)}` : esc(r.publisher || r.address), esc(r.year)].filter(Boolean).join(', ');
  let body;
  switch (r.kind) {
    case 'article':
      body = `${quoted} <i>${esc(r.container)}</i>${r.volume ? ` ${esc(r.volume)}` : ''}${r.number ? `, no. ${esc(r.number)}` : ''}${r.year ? ` (${esc(r.year)})` : ''}${r.pages ? `: ${esc(r.pages)}` : ''}.`;
      break;
    case 'inproceedings':
    case 'incollection':
      body = `${quoted} In <i>${esc(r.container)}</i>${r.pages ? `, ${esc(r.pages)}` : ''}.${place ? ` ${place}.` : ''}`;
      break;
    case 'book':
      body = `<i>${esc(end(r.title))}</i>${place ? ` ${place}.` : ''}`;
      break;
    case 'phdthesis':
    case 'mastersthesis':
      body = `${quoted} ${[r.kind === 'phdthesis' ? 'PhD diss.' : 'Master’s thesis', esc(r.school), esc(r.year)].filter(Boolean).join(', ')}.`;
      break;
    case 'techreport':
      body = `<i>${esc(end(r.title))}</i>${r.number ? ` Report ${esc(r.number)}.` : ''} ${[r.address && r.school ? `${esc(r.address)}: ${esc(r.school)}` : esc(r.school || r.address), esc(r.year)].filter(Boolean).join(', ')}.`;
      break;
    default:
      body = `${quoted} ${[esc(r.container), esc(r.year)].filter(Boolean).join(', ')}.`;
  }
  const u = doiUrl(r);
  return `${who ? `${end(who)} ` : ''}${body}${u ? ` ${link(u)}.` : ''}`;
}

// BibTeX: the entry as written in the block, or one written from the reference.
const texEscape = (s) => String(s).replace(/([&%$#_])/g, '\\$1');
function keyOf(r) {
  const family = fold(r.authors[0]?.family ?? 'anon').split(/\s+/)[0].replace(/[^a-z]/g, '');
  const word = fold(r.title).split(/\s+/).find((w) => w.length > 3 && !/^(the|with|from|into|about|towards?)$/.test(w))?.replace(/[^a-z0-9]/g, '') ?? '';
  return `${family}${r.year}${word}`;
}
function bibtex(r) {
  const name = (a) => (a.given ? `${a.family}, ${a.given}` : a.family);
  const fields = [
    ['author', r.authors.map(name).join(' and ')],
    ['editor', r.editors.map(name).join(' and ')],
    ['title', r.title],
    [{ article: 'journal', inproceedings: 'booktitle', incollection: 'booktitle' }[r.kind] ?? 'howpublished', r.container],
    ['school', ['phdthesis', 'mastersthesis'].includes(r.kind) ? r.school : ''],
    ['institution', r.kind === 'techreport' ? r.school : ''],
    ['publisher', r.publisher],
    ['address', r.address],
    ['year', r.year],
    ['month', r.month ? MONTHS[r.month - 1] : ''],
    ['volume', r.volume],
    ['number', r.number],
    ['pages', r.pages.replace('–', '--')],
    ['doi', r.doi],
    ['url', r.url],
  ].filter(([, v]) => v);
  const width = Math.max(...fields.map(([k]) => k.length));
  const line = ([k, v]) => `  ${k.padEnd(width)} = ${k === 'month' ? v : `{${k === 'url' || k === 'doi' ? v : texEscape(v)}}`}`;
  return `@${r.kind}{${r.key || keyOf(r)},\n${fields.map(line).join(',\n')}\n}`;
}

// RIS, for reference managers (Zotero, Mendeley, EndNote…).
function ris(r) {
  const type = { article: 'JOUR', inproceedings: 'CPAPER', incollection: 'CHAP', book: 'BOOK', phdthesis: 'THES', mastersthesis: 'THES', techreport: 'RPRT' }[r.kind] ?? 'GEN';
  const [sp, ep] = r.pages.split('–');
  const lines = [
    ['TY', type],
    ...r.authors.map((a) => ['AU', a.given ? `${a.family}, ${a.given}` : a.family]),
    ...r.editors.map((a) => ['ED', a.given ? `${a.family}, ${a.given}` : a.family]),
    ['TI', r.title],
    [r.kind === 'article' ? 'JO' : 'T2', r.container],
    ['PY', r.year],
    ['DA', r.year && r.month ? `${r.year}/${String(r.month).padStart(2, '0')}` : ''],
    ['VL', r.volume],
    ['IS', r.number],
    ['SP', sp],
    ['EP', ep],
    ['PB', r.publisher || (['phdthesis', 'mastersthesis', 'techreport'].includes(r.kind) ? r.school : '')],
    ['CY', r.address],
    ['DO', r.doi],
    ['UR', r.url || (r.doi ? `https://doi.org/${r.doi}` : '')],
    ['ER', ''],
  ].filter(([k, v]) => v || k === 'ER');
  return lines.map(([k, v]) => `${k}  - ${v}`).join('\n').trimEnd();
}

// ---------- The box ----------

export const FORMATS = [
  { id: 'ieee', label: 'IEEE', html: ieee },
  { id: 'apa', label: 'APA', html: apa },
  { id: 'chicago', label: 'Chicago', html: chicago },
  { id: 'bibtex', label: 'BibTeX', code: (r, src) => src || bibtex(r) },
  { id: 'ris', label: 'RIS', code: ris },
];

const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36).replace('-', 'n');

// The HTML of a ```cite block. `t` holds the interface texts (t.cite) of the
// page's language; `n` tells boxes with the same reference on a page apart.
// Without JavaScript, every format is shown, one after another, under its name.
export function citationHtml(text, t, n = 0) {
  const { ref, bibtex: src, error } = readCitation(text);
  if (error) {
    console.warn(`[cite] ${error}:\n${text}`);
    return `<pre class="cite-error"><code>${esc(text)}</code></pre>\n`;
  }
  const id = `cite-${hash(text)}-${n}`;
  const tabs = FORMATS.map((f, i) =>
    `<button type="button" role="tab" id="${id}-${f.id}-tab" aria-controls="${id}-${f.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${f.label}</button>`).join('');
  const panels = FORMATS.map((f) => {
    const content = f.html ? `<p class="cite-text">${f.html(ref)}</p>` : `<pre class="cite-code"><code>${esc(f.code(ref, src))}</code></pre>`;
    return `<div class="cite-panel" role="tabpanel" id="${id}-${f.id}" aria-labelledby="${id}-${f.id}-tab"><p class="cite-panel-label">${f.label}</p>${content}</div>`;
  }).join('');
  return `<div class="cite" data-cite>
<div class="cite-head"><p class="cite-title">${esc(t.title)}</p><div class="cite-tabs" role="tablist" aria-label="${esc(t.formats)}">${tabs}</div></div>
${panels}
<button type="button" class="cite-copy" data-copied="${esc(t.copied)}" data-failed="${esc(t.copyFailed)}"><span aria-live="polite">${esc(t.copy)}</span></button>
</div>\n`;
}
