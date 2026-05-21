module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script'
  },
  extends: ['eslint:recommended'],
  rules: {
    indent: ['error', 2, { SwitchCase: 1 }],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
    eqeqeq: ['error', 'smart'],
    'no-trailing-spaces': 'error',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off'
  },
  overrides: [
    {
      files: ['src/**/*.js'],
      parserOptions: { sourceType: 'module' },
      env: { browser: true, serviceworker: true }
    },
    {
      files: ['src/sw.js'],
      env: { browser: false, serviceworker: true }
    },
    {
      files: ['test/**/*.js'],
      env: { node: true, browser: false },
      // Tests in this directory mock browser globals onto globalThis and then
      // assert against the same names. Whitelist the ones we install so the
      // bare references don't trip no-undef.
      globals: {
        document: 'readonly',
        window: 'readonly',
        Blob: 'readonly',
        URL: 'readonly'
      }
    }
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'dist-web/',
    'src-tauri/target/',
    'package-lock.json'
  ]
};
