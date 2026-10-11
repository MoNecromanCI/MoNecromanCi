/**
 * The worked example of an Angular app: a `greeting` feature (contract, use case, component, specs) composed by the
 * root component.
 *
 * @remarks
 * The Angular mapping of the vertical-slice rules, as for the React app: the feature is a folder with a barrel, the
 * root component only composes it, and Nx's 7 kB welcome page is gone. The template is inline so the component stays one
 * file. Paths are relative to the app's `src/`.
 *
 * @param name - The app's project name, shown in the greeting.
 * @returns The files to write, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function angularAppExampleFiles (name: string): Record<string, string> {
  return {
    ...angularAppShellFiles(),
    ...angularGreetingFiles('app'),
    'app/app.component.ts': [
      "import { Component } from '@angular/core'",
      "import { GreetingComponent } from '../greeting'",
      '',
      '@Component({',
      "  selector: 'app-root',",
      `  template: '<app-greeting name="${name}" />',`,
      '',
      '  imports: [GreetingComponent],',
      '})',
      'export class App {}',
      '',
    ].join('\n'),
    'app/app.component.spec.ts': [
      "import { TestBed } from '@angular/core/testing'",
      "import { App } from './app.component'",
      '',
      "describe('App', () => {",
      "  it('renders the greeting', async () => {",
      '    await TestBed.configureTestingModule({ imports: [App] }).compileComponents()',
      '    const fixture = TestBed.createComponent(App)',
      '    await fixture.whenStable()',
      '',
      `    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toContain('Hello, ${name}!')`,
      '  })',
      '})',
      '',
    ].join('\n'),
  }
}

/**
 * The Playwright spec of an Angular app's paired end-to-end project.
 *
 * @remarks
 * Checks what the app really renders: the greeting, or for `--empty` that the root element is attached.
 *
 * @param name - The app's project name.
 * @param empty - Whether the app is the bare variant.
 * @returns The spec's source.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function angularAppE2eSpec (name: string, empty = false): string {
  if (empty) {
    return [
      "import { expect, test } from '@playwright/test'",
      '',
      "test('renders the app', async ({ page }) => {",
      "  await page.goto('/')",
      "  await expect(page.locator('app-root')).toBeAttached()",
      '})',
      '',
    ].join('\n')
  }

  return [
    "import { expect, test } from '@playwright/test'",
    '',
    "test('shows the greeting', async ({ page }) => {",
    "  await page.goto('/')",
    `  await expect(page.getByText('Hello, ${name}!')).toBeVisible()`,
    '})',
    '',
  ].join('\n')
}

/**
 * What `mnci add angular-app --empty` writes: a root component with nothing in it.
 *
 * @remarks
 * No feature and no greeting; the one spec checks that the component is created, because a runner with no tests exits
 * non-zero.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function angularAppEmptyFiles (): Record<string, string> {
  return {
    ...angularAppShellFiles(),
    'app/app.component.ts': [
      "import { Component } from '@angular/core'",
      '',
      '@Component({',
      "  selector: 'app-root',",
      "  template: '',",
      '})',
      'export class App {}',
      '',
    ].join('\n'),
    'app/app.component.spec.ts': [
      "import { TestBed } from '@angular/core/testing'",
      "import { App } from './app.component'",
      '',
      "describe('App', () => {",
      "  it('is created', async () => {",
      '    await TestBed.configureTestingModule({ imports: [App] }).compileComponents()',
      '',
      '    expect(TestBed.createComponent(App).componentInstance).toBeTruthy()',
      '  })',
      '})',
      '',
    ].join('\n'),
  }
}

/**
 * The files every Angular app has, whatever its example: the application config, its routes and the bootstrap.
 *
 * @remarks
 * Named for their role (`app.config.ts`, `app.route.ts`) rather than Angular's own `app.routes.ts`, which the slice rules
 * do not know. `main.ts` awaits the bootstrap at the top level instead of chaining `.catch`, which the lint config forbids.
 *
 * @param None - this function takes no parameters.
 * @returns The files, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function angularAppShellFiles (): Record<string, string> {
  return {
    'app/app.config.ts': [
      "import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'",
      "import { provideRouter } from '@angular/router'",
      "import { appRoutes } from './app.route'",
      '',
      'export const appConfig: ApplicationConfig = {',
      '  providers: [provideBrowserGlobalErrorListeners(), provideRouter(appRoutes)],',
      '}',
      '',
    ].join('\n'),
    'app/app.route.ts': [
      "import type { Route } from '@angular/router'",
      '',
      'export const appRoutes: Route[] = []',
      '',
    ].join('\n'),
    'main.ts': [
      "import { bootstrapApplication } from '@angular/platform-browser'",
      "import { App } from './app/app.component'",
      "import { appConfig } from './app/app.config'",
      '',
      'try {',
      '  await bootstrapApplication(App, appConfig)',
      '} catch (error) {',
      '  console.error(error)',
      '}',
      '',
    ].join('\n'),
  }
}

/**
 * The `greeting` feature of an Angular project: contract, use case, component, specs and a barrel.
 *
 * @remarks
 * Shared by the app and the library kinds, which differ only in the selector prefix: `app` for an application, `lib` for a
 * library, the convention the generators themselves use.
 *
 * @param prefix - The component selector prefix.
 * @returns The files, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
function angularGreetingFiles (prefix: string): Record<string, string> {
  return {
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
      "import { greet } from './greet.use-case'",
      '',
      "describe('greet', () => {",
      "  it('greets by name', () => {",
      "    expect(greet('world')).toEqual({ message: 'Hello, world!' })",
      '  })',
      '})',
      '',
    ].join('\n'),
    'greeting/greeting.component.ts': [
      "import { Component, computed, input } from '@angular/core'",
      "import { greet } from './greet.use-case'",
      '',
      '@Component({',
      `  selector: '${prefix}-greeting',`,
      "  template: '<h1>{{ greeting().message }}</h1>',",
      '})',
      'export class GreetingComponent {',
      "  readonly name = input('world')",
      '  protected readonly greeting = computed(() => greet(this.name()))',
      '}',
      '',
    ].join('\n'),
    'greeting/index.ts': [
      "export { GreetingComponent } from './greeting.component'",
      "export { greet } from './greet.use-case'",
      "export type { Greeting } from './greeting.contract'",
      '',
    ].join('\n'),
  }
}

/**
 * The worked example of an Angular internal library: the `greeting` feature behind the package barrel.
 *
 * @remarks
 * The generator's `src/lib/<name>/` is replaced because `lib` is a technology bucket the slice rules forbid.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function angularLibExampleFiles (): Record<string, string> {
  return {
    'index.ts': ["export * from './greeting'", ''].join('\n'),
    ...angularGreetingFiles('lib'),
  }
}

/**
 * What `mnci add angular-internal-lib --empty` writes: a barrel with nothing exported.
 *
 * @remarks
 * Plus one spec that imports it, because a runner with no tests exits non-zero.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function angularLibEmptyFiles (): Record<string, string> {
  return {
    'index.ts':      ['export {}', ''].join('\n'),
    'index.spec.ts': [
      "import * as library from './index'",
      '',
      "describe('library', () => {",
      "  it('exports nothing yet', () => {",
      '    expect(Object.keys(library)).toEqual([])',
      '  })',
      '})',
      '',
    ].join('\n'),
  }
}
