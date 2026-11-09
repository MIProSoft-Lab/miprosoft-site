// Images kept next to an entry, in content/<dir>/<slug>/ (news posts, tools),
// so they can be resized and converted at build time.
import { getImage } from 'astro:assets';
import { markdown } from './markdown.js';

const images = import.meta.glob('/content/{news,tools}/*/*.{png,jpg,jpeg,webp,gif,avif,svg,PNG,JPG,JPEG,WEBP}', {
  eager: true,
  import: 'default',
});

// The image `name` next to content/<dir>/<slug>/index.yaml, or undefined.
export const imageOf = (dir, slug, name) =>
  name ? images[`/content/${dir}/${slug}/${String(name).replace(/^\.?\//, '')}`] : undefined;

// Markdown as HTML, with the images next to the entry resized and converted.
// Other images (e.g. /media/… from the CMS, or full URLs) are left as they are.
export async function renderMarkdown(md, dir, slug) {
  let text = String(md ?? '');
  for (const [match, alt, src] of text.matchAll(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
    const meta = imageOf(dir, slug, src);
    if (!meta) continue;
    const img = await getImage({ src: meta, width: Math.min(meta.width, 1400), format: 'webp' });
    text = text.replace(match, `![${alt}](${img.src})`);
  }
  return markdown(text);
}
