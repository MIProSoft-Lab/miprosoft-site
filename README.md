# cv-online

A multilingual academic CV for GitHub Pages that keeps itself up to date from
[ORCID](https://orcid.org).

Every Monday (and on every push) a GitHub Action:

1. Downloads the public ORCID record and stores it in `data/orcid.json`
2. Adds author lists and venues from Crossref, and citation counts from OpenAlex
3. Commits the data if anything changed
4. Builds the site in every configured language, plus one PDF per language
5. Deploys to GitHub Pages

## Local development

Requires Node >= 22.23 (Astro 7).

```sh
npm install
npm run fetch
npm run dev
```

To test fetching the data from ORCID:

```sh
npm run fetch
```

## Journal Impact Factors

Journal articles show the JIF (Clarivate JCR) of their publication year, or the
latest available year. Enter the values by hand in `data/jcr.yaml`.

To fetch them automatically from the Clarivate Journals API instead, add an API
key with JCR access as the `CLARIVATE_API_KEY` repository secret (or run
`CLARIVATE_API_KEY=… npm run fetch:jcr` locally). It writes `data/jcr.json`;
values in `data/jcr.yaml` still take precedence.
