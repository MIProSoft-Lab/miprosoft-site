import { defineConfig } from 'astro/config';
import { resolve, sep } from 'node:path';

// Reload the dev server when the config or anything under data/ changes.
const CONFIG_FILE = resolve(process.cwd(), 'site.config.yaml');
const DATA_DIR = resolve(process.cwd(), 'data') + sep;
const isData = (file) => resolve(file) === CONFIG_FILE || resolve(file).startsWith(DATA_DIR);

function reloadOnDataChange() {
  return {
    name: 'reload-on-data-change',
    configureServer(server) {
      server.watcher.add([CONFIG_FILE, DATA_DIR]);
      const onChange = (file) => {
        if (!isData(file)) return;
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.file?.endsWith('/src/lib/data.js')) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
    },
  };
}

// SITE_URL and BASE_PATH are set by the GitHub Pages workflow, so the same
// code works for a user site (you.github.io) and a project site (you.github.io/cv).
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  vite: { plugins: [reloadOnDataChange()] },
});
