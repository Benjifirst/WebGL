import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative Pfade: der Build läuft in jedem Unterverzeichnis (z. B. GitHub Pages)
  base: './',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
