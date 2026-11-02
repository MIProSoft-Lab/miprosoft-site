// Shared by the fetch scripts and the site.
//
// Members' ORCID records only hold references to their works (title, type,
// date, DOI…). Everything fetched about a work (authors, abstract, citations,
// open access…) is stored once per article in data/works.json, keyed by
// articleKey(), so a paper co-authored by several members is fetched once.

export const SISTEDES_HANDLE = /hdl\.handle\.net\/(11705\/[^?#\s]+)/;

// "doi:10.1016/j.future.2026.108873", "hdl:11705/JISBD/2025/101", or null for
// works that have nothing to enrich them from.
export function articleKey(w) {
  if (w.doi) return `doi:${w.doi.toLowerCase()}`;
  const handle = w.url?.match(SISTEDES_HANDLE)?.[1];
  return handle ? `hdl:${handle}` : null;
}

// The ORCID record of a member is stored in data/orcid/<orcid>.json.
export const orcidFile = (orcid) => `data/orcid/${String(orcid).trim()}.json`;
export const personFile = (id) => `data/people/${id}.yaml`;
