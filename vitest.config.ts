import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Archify is pinned source material. Its upstream test suite has a distinct
    // fixture contract and is exercised through the wrapper's validation gates.
    exclude: [...configDefaults.exclude, 'vendor/archify/**'],
  },
});
