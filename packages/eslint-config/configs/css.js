import css from '@eslint/css'

/** CSS, via ESLint's own official CSS language plugin. */
export default [
  {
    name:     'mnci/css',
    files:    ['**/*.css'],
    plugins:  { css },
    language: 'css/css',
    rules:    {
      'css/no-empty-blocks':       'error',
      'css/no-duplicate-imports':  'error',
      'css/no-invalid-at-rules':   'error',
      'css/no-invalid-properties': 'error',
    },
  },
  {
    // A framework's front-end assets (a Laravel app's `resources/css`) are Tailwind 4 sources: `@theme`, `@source` and
    // `@utility` are not CSS at-rules the validator knows, so the whole skeleton failed its own lint.
    name:  'mnci/css-framework-assets',
    files: ['**/resources/css/**/*.css'],
    rules: { 'css/no-invalid-at-rules': 'off' },
  },
]
