# miprosoft-site

A multilingual research group website for GitHub Pages that keeps itself up to
date from [ORCID](https://orcid.org), styled after the UIB's visual identity:
a home page with the group's figures, latest news, people and latest
publications; a page per member; the group's publications, with a filter by
author; multilingual news and blog posts; and the courses the group teaches.

Every Monday (and on every push) a GitHub Action:

1. Downloads the public ORCID record of every member into `data/orcid/<orcid>.json`
2. Enriches each unique article **once**, however many members list it, and
   stores the result in `data/works.json`: authors, venues and abstracts come
   from Crossref, SISTEDES and Semantic Scholar, and citations and open access
   from OpenAlex
3. Commits the data if anything changed
4. Builds the site in every configured language
5. Deploys to GitHub Pages

## Layout

| Path | What |
| --- | --- |
| `site.config.yaml` | Group name, description and institution, **members** (`id` + ORCID iD), languages, profile sections, features |
| `data/people/<id>.yaml` | Per-member content ORCID lacks: name variants, title, teaching, talks…, plus per-member overrides (selected works, hidden items) |
| `data/overrides.yaml` | Corrections to works (by DOI) applied for every member |
| `data/courses.yaml` | Courses the group currently teaches |
| `data/jcr.yaml` | Journal Impact Factors entered by hand |
| `data/orcid/<orcid>.json` | *Fetched.* One ORCID record per member, with references to their works |
| `data/works.json` | *Fetched.* One entry per article (by DOI, or handle for SISTEDES), shared by all members |

Pages:

- `/<lang>/`: home page: the group's figures, latest news, people and latest publications
- `/<lang>/people/`: all members
- `/<lang>/people/<id>/`: a member's profile
- `/<lang>/publications/`: the group's publications, each paper once, with a filter by author
- `/<lang>/news/` and `/<lang>/news/<slug>/`: news and blog posts
- `/<lang>/courses/`: courses the group currently teaches (hidden when there are none)

Members' names in author lists link to their profiles.

## News and blog posts

Each post is a folder in `src/content/news/` with one Markdown file per language:

```
src/content/news/new-website/
  en.md        date, kind, authors, image… + title and text in English
  ca.md        title and text in Catalan
  es.md        title and text in Spanish
  cover.jpg    optional picture
```

The folder name is the post's URL (`/en/news/new-website/`). The shared fields
go only in the default language's file (the first in `site.config.yaml`):

```yaml
---
date: 2026-11-02
kind: news            # news | blog
authors: [antonio-crespi, Guest Name]   # member ids link to their profiles
image: ./cover.jpg    # optional
imageAlt: What the picture shows
title: Our new website
summary: One or two sentences for the cards (optional: taken from the text otherwise).
---

The text, in Markdown.
```

The other languages only need `title` (and optionally `summary` and
`imageAlt`) plus the text. A post without a version in some language is shown
in that language's pages in the default language, with a notice. The home page
shows the three latest posts. Every post in the folder is published.

## Courses

The Courses tab lists `data/courses.yaml` in order. Each course has a title and,
optionally, a type (`master`, `postgraduate`, `short`, `workshop`, `online`),
summary, instructors (member ids link to their profiles), dates and/or a
schedule, format (`in-person`, `online`, `hybrid`), teaching languages, ECTS or
hours, institution and a link. Texts can be translated with `{ en: …, ca: …, es: … }`;
quote texts that contain commas or colons. The template is at the top of the
file. Remove a course when it is no longer offered; with no courses, the tab
disappears. The file starts with a sample course to replace.

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

## Journal Impact Factors

Journal articles show the JIF (Clarivate JCR) of their publication year, or the
latest available year. Enter the values by hand in `data/jcr.yaml`.

To fetch them automatically from the Clarivate Journals API instead, add an API
key with JCR access as the `CLARIVATE_API_KEY` repository secret (or run
`CLARIVATE_API_KEY=… npm run fetch:jcr` locally). It writes `data/jcr.json` for
the journals of all members; values in `data/jcr.yaml` still take precedence.

## Style

Colours follow the UIB's visual identity: institutional blue (Pantone 300 C,
`#0065BD`), black, and the light blue tint `#E7EDF7`, with a dark theme that
follows the system (or the toggle in the top bar). Everything is in
`src/styles/site.css`, with the colours as variables at the top.

The site uses UIB sans, the University of the Balearic Islands' institutional
typeface, © 2014 Damià Rotger Miró ([ductilct.com](https://www.ductilct.com)).
