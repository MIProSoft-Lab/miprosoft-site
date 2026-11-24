import { defineConfig } from 'astro/config';
import { resolve, sep } from 'node:path';
import sitemap from './src/integrations/sitemap.mjs';

// Reload the dev server when the config, data/ or content/ (edited by the CMS)
// changes. The loaders in src/lib/ read those files when first imported, so
// every module is invalidated for them to be read again.
const CONFIG_FILE = resolve(process.cwd(), 'site.config.yaml');
const WATCHED_DIRS = ['data', 'content'].map((d) => resolve(process.cwd(), d) + sep);
const isData = (file) => resolve(file) === CONFIG_FILE || WATCHED_DIRS.some((d) => resolve(file).startsWith(d));

function reloadOnDataChange() {
  return {
    name: 'reload-on-data-change',
    configureServer(server) {
      server.watcher.add([CONFIG_FILE, ...WATCHED_DIRS]);
      const onChange = (file) => {
        if (!isData(file)) return;
        server.moduleGraph.invalidateAll();
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);

      // Runs after every plugin has set up the server, so this goes first.
      return () => {
        // The content editor lives in public/admin/index.html. The built site
        // serves it at /admin/, but the dev server only at /admin/index.html:
        // serve it at /admin/ too, and send /admin there (the editor loads its
        // config.yml relative to its URL, so it needs the trailing slash). Put
        // first, before Astro's own handling of URLs without a trailing slash.
        const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
        server.middlewares.stack.unshift({
          route: '',
          handle(req, res, next) {
            const [path, query = ''] = (req.url ?? '').split('?');
            if (path === `${base}/admin`) {
              res.writeHead(301, { Location: `${base}/admin/${query ? `?${query}` : ''}` });
              return res.end();
            }
            if (path === `${base}/admin/`) req.url = `${base}/admin/index.html${query ? `?${query}` : ''}`;
            next();
          },
        });
      };
    },
  };
}

// SITE_URL and BASE_PATH are set by the GitHub Pages workflow, so the same
// code works for a user site (you.github.io) and a project site (you.github.io/cv).
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  integrations: [sitemap()],
  vite: { plugins: [reloadOnDataChange()] },
});
