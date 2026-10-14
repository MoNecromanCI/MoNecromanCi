/**
 * The port the paired Playwright project serves the built app on.
 *
 * @remarks
 * The project's config and the app's `preview` target both name it, so a bump is one edit; `--strictPort` makes a
 * clash fail loudly rather than serve on another port the tests do not look at.
 */
export const SVELTE_PREVIEW_PORT = 4300

/**
 * The Playwright test of a Svelte app: it opens the page and checks what the app renders.
 *
 * @remarks
 * The worked example renders `Hello, <name>!` in an `<h1>`; the bare app renders an empty root component that `main.ts`
 * mounts into `#app`, so the test checks that element is there.
 *
 * @param name - The app's project name, which the greeting uses.
 * @param empty - Whether the app is the bare variant.
 * @returns The test file's text.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function svelteAppE2eSpec (name: string, empty = false): string {
  if (empty) {
    return [
      "import { expect, test } from '@playwright/test'",
      '',
      "test('renders the app', async ({ page }) => {",
      "  await page.goto('/')",
      "  await expect(page.locator('#app')).toBeAttached()",
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
 * The files of the Playwright project paired with a Svelte app, which has no Nx generator to write them.
 *
 * @remarks
 * Shaped like what `@nx/react:app --e2eTestRunner=playwright` writes (a manifest with an implicit dependency, a
 * `playwright.config.mts` on `nxE2EPreset`, a tsconfig that extends the base), so the Playwright plugin infers its `e2e`
 * target and the lint and typecheck plugins infer theirs. The server is the app's own `preview` target, which builds
 * first. One browser: a second and third are a line each in the config, and each is another download.
 *
 * @param name - The Svelte app's project name.
 * @returns The files, by path relative to `apps/<name>-e2e`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function svelteE2eProjectFiles (name: string): Record<string, string> {
  const origin = `http://localhost:${SVELTE_PREVIEW_PORT}`

  return {
    'package.json': `${JSON.stringify({
      name:    `${name}-e2e`,
      version: '0.0.1',
      private: true,
      nx:      { implicitDependencies: [name] },
    }, undefined, 2)}\n`,
    'playwright.config.mts': [
      "import { defineConfig, devices } from '@playwright/test'",
      "import { nxE2EPreset } from '@nx/playwright/preset'",
      "import { workspaceRoot } from '@nx/devkit'",
      '',
      '// Set BASE_URL to point the tests at a deployed copy of the app instead of the local preview.',
      `const baseURL = process.env['BASE_URL'] || '${origin}'`,
      '',
      'export default defineConfig({',
      "  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),",
      '  use: {',
      '    baseURL,',
      "    trace: 'on-first-retry',",
      '  },',
      '  webServer: {',
      `    command:             'npx nx run ${name}:preview',`,
      `    url:                 '${origin}',`,
      '    reuseExistingServer: true,',
      '    cwd:                 workspaceRoot,',
      '  },',
      '  projects: [',
      "    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },",
      '  ],',
      '})',
      '',
    ].join('\n'),
    'tsconfig.json': `${JSON.stringify({
      extends:         '../../tsconfig.base.json',
      compilerOptions: { allowJs: true, outDir: 'out-tsc/playwright', sourceMap: false, types: ['node'] },
      include:         ['**/*.ts', '**/*.js', 'playwright.config.mts', 'src/**/*.spec.ts', 'src/**/*.d.ts'],
      exclude:         ['out-tsc', 'test-output'],
    }, undefined, 2)}\n`,
  }
}
