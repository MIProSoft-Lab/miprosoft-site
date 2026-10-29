import { defineConfig } from 'astro/config';
import { resolve } from 'node:path';

const DATA_FILES = ['data/orcid.json', 'data/manual.yaml', 'data/overrides.yaml', 'cv.config.yaml'].map((f) =>
  resolve(process.cwd(), f),
);

function reloadOnDataChange() {
  return {
    name: 'reload-on-data-change',
    configureServer(server) {
      server.watcher.add(DATA_FILES);
      const onChange = (file) => {
        if (!DATA_FILES.includes(resolve(file))) return;
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
