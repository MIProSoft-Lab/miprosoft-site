// Recognizes members in author lists, to highlight them and link to their profiles.

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.\s]+/g, ' ').trim().toLowerCase();

// `people`: [{ id, nameVariants, familyName, givenNames }]. Returns a function
// author => the matching person, or undefined.
//
// An exact name variant wins over a loose match: a matching first initial plus
// the first family name, so that "J. S. Carberry" matches Carberry and
// "Antonio Crespí" matches Crespí Tobeña.
export function authorMatcher(people) {
  const exact = new Map();
  for (const p of people) for (const v of p.nameVariants ?? []) if (!exact.has(norm(v))) exact.set(norm(v), p);
  const loose = people
    .map((p) => ({ p, family: norm(p.familyName ?? '').split(' ')[0], initial: norm(p.givenNames ?? '').charAt(0) }))
    .filter((x) => x.family && x.initial);
  return (author) => {
    const a = norm(author);
    if (exact.has(a)) return exact.get(a);
    const tokens = a.split(' ');
    return loose.find((x) => a.charAt(0) === x.initial && tokens.slice(1).includes(x.family))?.p;
  };
}
