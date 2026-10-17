// Lint for the bugs the type checker lets through, not for style: a promise
// nobody awaits (a Playwright call that races the next one, a write that
// fails silently), a promise passed where a callback's result is ignored,
// and an await on something that is not a promise. Formatting and taste are
// not linted; CODING_STANDARDS.md holds the judgement calls.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.input/**', 'test/**/__actual__/**'] },
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.check.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
    },
  },
);
