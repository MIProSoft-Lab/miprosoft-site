// Content collections. See README.md, "News and blog posts".
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One folder per post, one Markdown file per language:
//   src/content/news/<slug>/en.md, ca.md, es.md
// The date, kind, authors and image go in the default language's
// file (the first in site.config.yaml) and apply to every language; the other
// files only need a title and the text, and may override the summary and alt text.
const news = defineCollection({
  loader: glob({ pattern: '*/*.md', base: './src/content/news' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string().optional(),
      date: z.coerce.date().optional(),
      kind: z.enum(['news', 'blog']).optional(),
      // Member ids (linked to their profiles) or any other name.
      authors: z.array(z.string()).optional(),
      // A picture next to the Markdown files, e.g. ./cover.jpg
      image: image().optional(),
      imageAlt: z.string().optional(),
    }),
});

export const collections = { news };
