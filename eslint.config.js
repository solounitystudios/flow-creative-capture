// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // apps/** is a separate workspace package (Capture Studio Shell) with
    // its own eslint config, own tsconfig, and its own `npm run lint`.
    // Never let the core engine's project-service-based lint reach into
    // it -- those files aren't part of this tsconfig's program.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'apps/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Pass timestamps explicitly; do not read wall-clock time inside domain/provenance/crypto logic.' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'src/simulator/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
);
