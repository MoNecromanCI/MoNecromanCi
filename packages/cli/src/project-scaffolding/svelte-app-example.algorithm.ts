/**
 * The `vite.config.ts` of a Svelte app: the Svelte plugin, and Vitest in a DOM.
 *
 * @remarks
 * `svelteTesting()` makes component tests resolve Svelte's browser build and cleans up between tests; without it
 * `@testing-library/svelte` renders the server build and every component test fails. The config is imported from
 * `vitest/config` so its `test` block is typed.
 *
 * @param None - this function takes no parameters.
 * @returns The file contents.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function svelteViteConfig (): string {
  return [
    "import { svelte } from '@sveltejs/vite-plugin-svelte'",
    "import { svelteTesting } from '@testing-library/svelte/vite'",
    "import { defineConfig } from 'vitest/config'",
    '',
    'export default defineConfig({',
    '  plugins: [svelte(), svelteTesting()],',
    '  test:    {',
    "    environment: 'jsdom',",
    "    include:     ['src/**/*.{test,spec}.ts'],",
    '  },',
    '})',
    '',
  ].join('\n')
}

/** The entry file, which mounts the root component. */
const MAIN = [
  "import { mount } from 'svelte'",
  "import App from './app/app.component.svelte'",
  '',
  "const target = document.getElementById('app')",
  'if (target === null) {',
  "  throw new Error('index.html has no #app element to mount into')",
  '}',
  '',
  'mount(App, { target })',
  '',
].join('\n')

/**
 * The worked example of a Svelte app: a `greeting` feature (contract, use case, component, specs) composed by the root
 * component.
 *
 * @remarks
 * The Svelte mapping of the vertical-slice rules, as for the React, Angular and Vue apps: the feature is a folder with a
 * barrel and the root component only composes it. Single-file components are named for their role,
 * `<name>.component.svelte`. Paths are relative to the app's `src/`.
 *
 * @param name - The app's project name, shown in the greeting.
 * @returns The files to write, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function svelteAppExampleFiles (name: string): Record<string, string> {
  return {
    'main.ts':                       MAIN,
    'greeting/greeting.contract.ts': [
      '/** What greeting someone returns. */',
      'export interface Greeting {',
      '  message: string',
      '}',
      '',
    ].join('\n'),
    'greeting/greet.use-case.ts': [
      "import type { Greeting } from './greeting.contract'",
      '',
      '/** Greets someone by name: a worked example of a use case. Replace it with your own. */',
      'export function greet (name: string): Greeting {',
      '  return { message: `Hello, ${name}!` }',
      '}',
      '',
    ].join('\n'),
    'greeting/greet.use-case.spec.ts': [
      "import { describe, expect, it } from 'vitest'",
      "import { greet } from './greet.use-case'",
      '',
      "describe('greet', () => {",
      "  it('greets by name', () => {",
      "    expect(greet('world')).toEqual({ message: 'Hello, world!' })",
      '  })',
      '})',
      '',
    ].join('\n'),
    'greeting/greeting.component.svelte': [
      '<script lang="ts">',
      "  import { greet } from './greet.use-case'",
      '',
      '  const { name }: { name: string } = $props()',
      '  const greeting = $derived(greet(name))',
      '</script>',
      '',
      '<h1>{greeting.message}</h1>',
      '',
    ].join('\n'),
    'greeting/index.ts': [
      "export { default as GreetingComponent } from './greeting.component.svelte'",
      "export { greet } from './greet.use-case'",
      "export type { Greeting } from './greeting.contract'",
      '',
    ].join('\n'),
    'app/app.component.svelte': [
      '<script lang="ts">',
      "  import { GreetingComponent } from '../greeting'",
      '</script>',
      '',
      `<GreetingComponent name="${name}" />`,
      '',
    ].join('\n'),
    'app/app.component.spec.ts': [
      "import { render, screen } from '@testing-library/svelte'",
      "import { describe, expect, it } from 'vitest'",
      "import AppComponent from './app.component.svelte'",
      '',
      "describe('App', () => {",
      "  it('renders the greeting', () => {",
      '    render(AppComponent)',
      '',
      `    expect(screen.getByRole('heading').textContent).toBe('Hello, ${name}!')`,
      '  })',
      '})',
      '',
    ].join('\n'),
  }
}

/**
 * What `mnci add svelte-app --empty` writes: a root component with nothing in it.
 *
 * @remarks
 * No feature and no greeting; the one spec checks that the component renders, because a runner with no tests exits
 * non-zero.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function svelteAppEmptyFiles (): Record<string, string> {
  return {
    'main.ts':                   MAIN,
    'app/app.component.svelte':  '<div></div>\n',
    'app/app.component.spec.ts': [
      "import { render } from '@testing-library/svelte'",
      "import { describe, expect, it } from 'vitest'",
      "import AppComponent from './app.component.svelte'",
      '',
      "describe('App', () => {",
      "  it('renders', () => {",
      '    expect(render(AppComponent).container).toBeTruthy()',
      '  })',
      '})',
      '',
    ].join('\n'),
  }
}
