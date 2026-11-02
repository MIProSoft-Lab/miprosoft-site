// Markdown from the CMS (news posts, research lines, tools…) as HTML.
import { marked } from 'marked';

// Typographic apostrophes after a letter (l'equip -> l’equip, group's -> group’s,
// d'[ORCID](…) -> d’ORCID),
// as Astro's own Markdown does; code is left alone.
marked.use({
  walkTokens(token) {
    if (token.type === 'text' && !token.tokens) token.text = token.text.replace(/(\p{L})'(?=\p{L}|$)/gu, '$1\u2019');
  },
});

export const markdown = (md) => (md ? marked.parse(String(md), { async: false }) : '');
