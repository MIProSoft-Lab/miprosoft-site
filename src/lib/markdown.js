// Markdown from the CMS (news posts, research lines, tools…) as HTML.
import { marked } from 'marked';
import { citationHtml } from './cite.js';
import { strings } from './i18n.js';

// Typographic apostrophes after a letter (l'equip -> l’equip, group's -> group’s,
// d'[ORCID](…) -> d’ORCID),
// as Astro's own Markdown does; code is left alone.
marked.use({
  walkTokens(token) {
    if (token.type === 'text' && !token.tokens) token.text = token.text.replace(/(\p{L})'(?=\p{L}|$)/gu, '$1’');
  },
});

// ```cite blocks become citation boxes (see cite.js), labelled in the language
// of the page being rendered. Rendering is synchronous, so a variable holds it;
// the counter keeps the boxes' ids apart when a page renders several texts.
let pageLang;
let cites = 0;
marked.use({
  renderer: {
    code({ text, lang }) {
      if (lang?.trim() !== 'cite') return false;
      return citationHtml(text, strings(pageLang).cite, cites++);
    },
  },
});

// `lang`: the page's language, for the texts of citation boxes.
export const markdown = (md, lang) => {
  if (!md) return '';
  pageLang = lang;
  return marked.parse(String(md), { async: false });
};
