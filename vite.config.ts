import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

/**
 * Versioniert den Cache des Service Workers: Nach dem Build wird __BUILD__ in sw.js durch einen
 * Hash über alle erzeugten Dateinamen ersetzt. Jede neue Version bekommt so einen eigenen Cache,
 * und der Service Worker räumt beim Aktivieren die alten ab.
 */
function serviceWorkerVersion(): Plugin {
  let outDir = 'dist';
  const hash = createHash('sha256');
  return {
    name: 'sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle).sort()) hash.update(name);
    },
    closeBundle() {
      const file = join(outDir, 'sw.js');
      if (!existsSync(file)) return;
      const version = hash.digest('hex').slice(0, 10);
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD__', version));
    },
  };
}

export default defineConfig({
  // Relative Pfade: der Build läuft in jedem Unterverzeichnis (z. B. GitHub Pages)
  base: './',
  plugins: [serviceWorkerVersion()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
