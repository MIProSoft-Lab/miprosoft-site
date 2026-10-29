const ENTRY_TYPE = {
  journal: 'article',
  conference: 'inproceedings',
  book: 'book',
  thesis: 'phdthesis',
  preprint: 'misc',
  data: 'misc',
  other: 'misc',
};

const esc = (s) => String(s).replace(/([{}&%$#_])/g, '\\$1');

function key(w, used) {
  const author = (w.authors?.[0] ?? 'anon').split(/\s+/).pop().normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase();
  const word = (w.title.match(/[A-Za-z]{4,}/)?.[0] ?? 'work').toLowerCase();
  let k = `${author}${w.date?.year ?? ''}${word}`;
  for (let i = 2; used.has(k); i++) k = `${author}${w.date?.year ?? ''}${word}${i}`;
  used.add(k);
  return k;
}

export function toBibtex(works) {
  const used = new Set();
  return works
    .map((w) => {
      let type = ENTRY_TYPE[w.group] ?? 'misc';
      if (w.type === 'book-chapter') type = 'incollection';
      const venueField = { article: 'journal', inproceedings: 'booktitle', incollection: 'booktitle' }[type] ?? 'howpublished';
      const fields = [
        ['title', `{${esc(w.title)}}`],
        ['author', w.authors?.length ? esc(w.authors.join(' and ')) : null],
        [venueField, w.venue ? esc(w.venue) : null],
        ['year', w.date?.year],
        ['volume', w.volume],
        ['number', w.issue],
        ['pages', w.pages?.replace(/-/g, '--')],
        ['doi', w.doi],
        ['eprint', w.arxiv],
        ['url', w.doi ? null : w.url],
      ].filter(([, val]) => val != null && val !== '');
      return `@${type}{${key(w, used)},\n${fields.map(([k, val]) => `  ${k} = {${val}}`).join(',\n')}\n}`;
    })
    .join('\n\n') + '\n';
}
