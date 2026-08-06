// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', 'assets/**', 'references/**', 'eslint.config.js'] },

  // Base
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Language options - Node.js scripts
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project rules
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off', // handled by @typescript-eslint
    },
  },

  // Prettier — must be last
  prettierConfig
);
