import { cv } from '../lib/data.js';
import { toBibtex } from '../lib/bibtex.js';

export function GET() {
  return new Response(toBibtex(cv.works), {
    headers: { 'Content-Type': 'application/x-bibtex; charset=utf-8' },
  });
}
