import tseslint from 'typescript-eslint';
import globals from 'globals';

// Лёгкий конфиг без type-checking (надёжнее в автономной сборке); типобезопасность даёт tsc.
export default tseslint.config({
  files: ['src/**/*.ts'],
  ignores: ['dist', '.output', '.wxt', 'node_modules'],
  extends: [...tseslint.configs.recommended],
  languageOptions: {
    globals: { ...globals.browser, ...globals.webextensions },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
});
