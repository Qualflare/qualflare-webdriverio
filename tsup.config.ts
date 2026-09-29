import { createRequire } from 'node:module';

import { defineConfig } from 'tsup';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  // Three entries, three subpaths. `runtime` must stay free of @wdio/reporter:
  // it is what a spec file imports for qualflare.*(), and see
  // src/runtime/store.ts for why its state lives on globalThis.
  entry: {
    index: 'src/index.ts',
    service: 'src/service-entry.ts',
    runtime: 'src/runtime/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  splitting: false,
  shims: false,
  define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
});
