import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-constant-condition': ['error', { checkLoops: false }],
  eqeqeq: 'error',
};

export default [
  {
    // Worker-код: рантайм-глобалы Cloudflare Workers.
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.worker, HTMLRewriter: 'readonly' },
    },
    rules,
  },
  {
    // Тесты и скрипты: node + node:test (импортируется явно).
    files: ['test/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules,
  },
];
