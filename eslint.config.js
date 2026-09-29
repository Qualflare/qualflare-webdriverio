// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test/integration/fixtures/**',
      'examples/**',
      // The dogfood suite: a standalone WebdriverIO project that loads the
      // reporter from built dist/, exactly like the fixtures above. Outside
      // tsconfig's include, so type-aware linting cannot parse it.
      'e2e/**',
      'coverage/**',
      // Plain JS, not part of the TS project graph — no type-aware linting
      // needed for the flat config file itself.
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // A dedicated tsconfig for linting: tsconfig.json's own `include`
        // deliberately covers only `src` (the published package), but
        // ESLint also needs to type-check test/*.ts and the root-level
        // *.config.ts files.
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
