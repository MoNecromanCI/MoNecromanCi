/**
 * The Vite and Vitest configuration of an `html-app`.
 *
 * @remarks
 * The template's own `vite.config.ts` holds nothing; this one adds the test block (jsdom, so a spec can build the page
 * with `document.body.innerHTML` and drive it with jQuery). Imported from `vitest/config` so `test` type-checks.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `vite.config.ts`.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function htmlViteConfig (): string {
  return [
    "import { defineConfig } from 'vitest/config'",
    '',
    'export default defineConfig({',
    '  test: {',
    "    environment: 'jsdom',",
    "    include:     ['src/**/*.{test,spec}.ts'],",
    '  },',
    '})',
    '',
  ].join('\n')
}

/**
 * The page of an `html-app`: plain HTML with the elements the greeting handler binds to.
 *
 * @remarks
 * No framework and no template language: this file is the markup, and `src/main.ts` is the one script. A bare app
 * keeps the same shell with an empty `main`.
 *
 * @param name - The project name, used as the title and heading.
 * @param empty - Write the bare shell, with no form.
 * @returns The text of `index.html`.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function htmlAppIndexPage (name: string, empty = false): string {
  const body = empty
    ? ['    <main id="app"></main>']
    : [
        '    <main id="app">',
        `      <h1>${name}</h1>`,
        '      <form id="greeting-form">',
        '        <label for="name">Your name</label>',
        '        <input id="name" type="text" autocomplete="off" />',
        '        <button type="submit">Greet</button>',
        '      </form>',
        '      <p id="greeting" aria-live="polite"></p>',
        '    </main>',
      ]

  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${name}</title>`,
    '  </head>',
    '  <body>',
    ...body,
    '    <script type="module" src="/src/main.ts"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * The worked example of an `html-app`: a `greeting` feature behind a barrel, wired to the page with jQuery.
 *
 * @remarks
 * The roles are the ones every other kind uses, with no new one. The DOM binding is a `.handler.ts`: it adapts what
 * the page delivers (a submitted form), decodes it, calls one use case and shapes the response (the text of an
 * element), which is what that role is. `greet` is a use case with its spec; the contract is the data it returns. The
 * handler's spec builds the page in jsdom and drives it through jQuery. Paths are relative to the app's `src/`.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path under `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function htmlAppExampleFiles (): Record<string, string> {
  return {
    'main.ts': [
      "import $ from 'jquery'",
      "import { bindGreeting } from './greeting'",
      "import './style.css'",
      '',
      "bindGreeting($('#app'))",
      '',
    ].join('\n'),
    'style.css': [
      'body {',
      '  font-family: system-ui, sans-serif;',
      '  margin: 2rem auto;',
      '  max-width: 32rem;',
      '}',
      '',
      '#greeting {',
      '  font-size: 1.25rem;',
      '}',
      '',
    ].join('\n'),
    'greeting/greeting.contract.ts': [
      '/** What greeting someone returns. */',
      'export interface Greeting {',
      '  readonly message: string',
      '}',
      '',
    ].join('\n'),
    'greeting/greet.use-case.ts': [
      "import type { Greeting } from './greeting.contract'",
      '',
      '/** Greets a name; a blank one is greeted as a stranger. */',
      'export function greet (name: string): Greeting {',
      '  const trimmed = name.trim()',
      '',
      "  return { message: 'Hello, ' + (trimmed === '' ? 'stranger' : trimmed) + '!' }",
      '}',
      '',
    ].join('\n'),
    'greeting/greet.use-case.spec.ts': [
      "import { describe, expect, it } from 'vitest'",
      "import { greet } from './greet.use-case'",
      '',
      "describe('greet', () => {",
      "  it('greets a name', () => {",
      "    expect(greet('Ada')).toEqual({ message: 'Hello, Ada!' })",
      '  })',
      '',
      "  it('greets a blank name as a stranger', () => {",
      "    expect(greet('   ').message).toBe('Hello, stranger!')",
      '  })',
      '})',
      '',
    ].join('\n'),
    'greeting/greeting.handler.ts': [
      "import { greet } from './greet.use-case'",
      '',
      '/**',
      ' * Wires the greeting form under `root`: submitting it shows the greeting for the name typed.',
      ' */',
      'export function bindGreeting (root: JQuery): void {',
      "  root.find('#greeting-form').on('submit', event => {",
      '    event.preventDefault()',
      "    const typed = root.find('#name').val()",
      "    root.find('#greeting').text(greet(typeof typed === 'string' ? typed : '').message)",
      '  })',
      '}',
      '',
    ].join('\n'),
    'greeting/greeting.handler.spec.ts': [
      "import $ from 'jquery'",
      "import { beforeEach, describe, expect, it } from 'vitest'",
      "import { bindGreeting } from './greeting.handler'",
      '',
      "describe('bindGreeting', () => {",
      '  beforeEach(() => {',
      '    document.body.innerHTML = [',
      "      '<main id=\"app\">',",
      "      '<form id=\"greeting-form\"><input id=\"name\" /></form>',",
      "      '<p id=\"greeting\"></p>',",
      "      '</main>',",
      "    ].join('')",
      '  })',
      '',
      "  it('shows the greeting for the typed name when the form is submitted', () => {",
      "    const root = $('#app')",
      '    bindGreeting(root)',
      "    root.find('#name').val('Ada')",
      "    root.find('#greeting-form').trigger('submit')",
      '',
      "    expect(root.find('#greeting').text()).toBe('Hello, Ada!')",
      '  })',
      '})',
      '',
    ].join('\n'),
    'greeting/index.ts': [
      "export * from './greeting.contract'",
      "export * from './greet.use-case'",
      "export * from './greeting.handler'",
      '',
    ].join('\n'),
  }
}

/**
 * What `mnci add html-app --empty` writes: an entry point that does nothing.
 *
 * @remarks
 * The page is an empty `main` ({@link htmlAppIndexPage}), so the app builds and serves as it is. There is no spec: the
 * `test` target passes with no tests, and the first feature folder is the first thing you add (#330).
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path under `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function htmlAppEmptyFiles (): Record<string, string> {
  return {
    'main.ts': 'export {}\n',
  }
}
