// BibTeX of one member's publications: /people/<id>/publications.bib
import { members, memberById } from '../../../lib/data.js';
import { toBibtex } from '../../../lib/bibtex.js';

export function getStaticPaths() {
  return members.map((m) => ({ params: { id: m.id } }));
}

export function GET({ params }) {
  return new Response(toBibtex(memberById.get(params.id).works), {
    headers: { 'Content-Type': 'application/x-bibtex; charset=utf-8' },
  });
}
