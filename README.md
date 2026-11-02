# cv-online

A multilingual research group site for GitHub Pages that keeps itself up to
date from [ORCID](https://orcid.org). Each member gets a CV page, a PDF and a
BibTeX file. A group page lists the members.

Every Monday (and on every push) a GitHub Action:

1. Downloads the public ORCID record of every member into `data/orcid/<orcid>.json`
2. Enriches each unique article **once**, however many members list it, and
   stores the result in `data/works.json`: authors, venues and abstracts come
   from Crossref, SISTEDES and Semantic Scholar, and citations and open access
   from OpenAlex
3. Commits the data if anything changed
4. Builds the site in every configured language, plus one PDF per member and language
5. Deploys to GitHub Pages

## Layout

| Path | What |
| --- | --- |
| `site.config.yaml` | Group name, **members** (`id` + ORCID iD), languages, CV sections, features |
| `data/people/<id>.yaml` | Per-member content ORCID lacks: name variants, title, teaching, talks…, plus per-member overrides (selected works, hidden items) |
| `data/overrides.yaml` | Corrections to works (by DOI) applied for every member |
| `data/jcr.yaml` | Journal Impact Factors entered by hand |
| `data/orcid/<orcid>.json` | *Fetched.* One ORCID record per member, with references to their works |
| `data/works.json` | *Fetched.* One entry per article (by DOI, or handle for SISTEDES), shared by all members |

Pages:

- `/<lang>/`: group home page with the list of members
- `/<lang>/people/<id>/`: a member's CV
- `/people/<id>/cv-<lang>.pdf` and `/people/<id>/publications.bib`: a member's PDF and BibTeX
- `/publications.bib`: the whole group's publications, each paper once

## Adding a member

1. Add `{ id: jane-doe, orcid: 0000-0000-0000-0000 }` under `members` in `site.config.yaml`
2. Optionally create `data/people/jane-doe.yaml` (copy an existing one as a template)
3. Run `npm run fetch`: only the articles that are not already in `data/works.json` are fetched

When a member is removed, the next fetch deletes their ORCID record and any
articles no remaining member lists.

## Fetching

Article metadata that rarely changes (authors, venue, pages, abstracts) is kept
from earlier runs and refetched only after `fetch.refreshDays` (30 by default).
Citations and open-access status are refreshed on every run, in batches.

```sh
npm run fetch                 # ORCID records + new or stale articles + citations
npm run fetch -- --refresh    # refetch all article metadata now
npm run fetch -- --no-enrich  # ORCID records only
```

Optional API keys (as environment variables locally, or repository secrets in
CI): `OPENALEX_API_KEY` and `SEMANTIC_SCHOLAR_API_KEY`. Without a key, both
APIs have tight shared rate limits.

## Local development

Requires Node >= 22.23 (Astro 7).

```sh
npm install
npm run fetch
npm run dev
```

To render the PDFs locally, build, start `npx astro preview` and run
`CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run pdf`
(set `PREVIEW_URL` if the preview is not on `http://localhost:4321`).

## Journal Impact Factors

Journal articles show the JIF (Clarivate JCR) of their publication year, or the
latest available year. Enter the values by hand in `data/jcr.yaml`.

To fetch them automatically from the Clarivate Journals API instead, add an API
key with JCR access as the `CLARIVATE_API_KEY` repository secret (or run
`CLARIVATE_API_KEY=… npm run fetch:jcr` locally). It writes `data/jcr.json` for
the journals of all members; values in `data/jcr.yaml` still take precedence.

## Typeface

The site uses UIB sans, the University of the Balearic Islands' institutional
typeface, © 2014 Damià Rotger Miró ([ductilct.com](https://www.ductilct.com)).
