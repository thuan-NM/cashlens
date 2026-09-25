// @ts-check
import { node } from '@repo/eslint-config/node';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig(
  {
    ignores: ['eslint.config.mjs'],
  },
  node({
    tsconfigRootDir: import.meta.dirname,
    globals: { ...globals.node, ...globals.jest },
  }),
  {
    // API-specific rule choices.
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
