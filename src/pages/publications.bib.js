// BibTeX of the whole group's publications, each paper once.
import { group } from '../lib/data.js';
import { toBibtex } from '../lib/bibtex.js';

export function GET() {
  return new Response(toBibtex(group.works), {
    headers: { 'Content-Type': 'application/x-bibtex; charset=utf-8' },
  });
}
