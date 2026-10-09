/**
 * Where the integration tests of an extension live.
 *
 * @remarks
 * Beside `src` and not in it: the slice lint rejects a `src/test`.
 */
export const VSCODE_INTEGRATION_DIRECTORY = 'integration'

/**
 * Where `tsc` writes the compiled integration tests.
 *
 * @remarks
 * `.vscode-test.mjs` runs the files found here.
 */
export const VSCODE_INTEGRATION_OUTPUT = 'out-integration'

/**
 * The packages the integration tests need, installed in the root as dev tooling.
 *
 * @remarks
 * `@vscode/test-cli` runs the tests (downloading a real VS Code into `.vscode-test/` on first use), `@vscode/test-electron` is
 * what it drives, and `mocha` is the runner the extension host loads.
 */
export const VSCODE_INTEGRATION_PACKAGES = ['@vscode/test-cli', '@vscode/test-electron', 'mocha', '@types/mocha'] as const

/**
 * The sample integration test: the extension activates in a real VS Code and its sample command is registered.
 *
 * @remarks
 * Written against the real `vscode` module, which exists only inside the extension host, so unlike the unit spec it needs no stub.
 * The command id is the one `src/main.ts` registers.
 *
 * @param name - The project name, which prefixes the command id.
 * @returns The file content.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeIntegrationSample (name: string): string {
  return `import * as assert from 'node:assert'
import * as vscode from 'vscode'

suite('${name} in a real VS Code', () => {
  test('registers its sample command', async () => {
    // Running the command activates the extension if it is not yet; it is listed once it has.
    await vscode.commands.executeCommand('${name}.hello')
    const commands = await vscode.commands.getCommands(true)

    assert.ok(commands.includes('${name}.hello'))
  })
})
`
}

/**
 * The `integration/tsconfig.json`: compiles the tests to CommonJS, which is what the extension host loads.
 *
 * @remarks
 * Extends the workspace base three levels up (`integration`, the project, `apps`) and turns off what a build needs but a test run does not (`composite`, declarations).
 *
 * @param none - takes no parameters.
 * @returns The file content.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeIntegrationTsconfig (): string {
  return `${JSON.stringify({
    extends:         '../../../tsconfig.base.json',
    compilerOptions: {
      composite:           false,
      declaration:         false,
      declarationMap:      false,
      emitDeclarationOnly: false,
      noEmit:              false,
      module:              'node16',
      moduleResolution:    'node16',
      rootDir:             '.',
      outDir:              `../${VSCODE_INTEGRATION_OUTPUT}`,
      types:               ['node', 'mocha', 'vscode'],
    },
    include: ['*.ts'],
  }, null, 2)}\n`
}

/**
 * The `.vscode-test.mjs` that `vscode-test` reads: which files to run, with mocha's `tdd` interface (`suite`/`test`).
 *
 * @remarks
 * The files are the compiled ones in the output folder, not the TypeScript sources.
 *
 * @param none - takes no parameters.
 * @returns The file content.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeTestConfig (): string {
  return `import { defineConfig } from '@vscode/test-cli'

export default defineConfig({
  files: '${VSCODE_INTEGRATION_OUTPUT}/**/*.integration.js',
  mocha: { ui: 'tdd', timeout: 20_000 },
})
`
}

/**
 * The `test:integration` target: build, then run the tests in a real VS Code.
 *
 * @remarks
 * Not part of the verify target list (`lint,typecheck,test,build`), so a pull request never downloads VS Code. The script checks
 * for a display first and names `xvfb-run` when a Linux machine has none, instead of letting Electron crash with a dump.
 *
 * @param name - The project name.
 * @returns The `nx:run-commands` target object.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function vscodeIntegrationTarget (name: string): Record<string, unknown> {
  return {
    executor:  'nx:run-commands',
    dependsOn: ['build'],
    cache:     false,
    options:   { command: `node tools/vscode-extension.cjs integration apps/${name}` },
  }
}
