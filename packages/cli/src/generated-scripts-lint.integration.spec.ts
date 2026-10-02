/**
 * Lints the scripts mnci writes into a generated workspace's `tools/`, with the real
 * ESLint and the config a generated workspace has, under the path they are written to.
 *
 * @remarks
 * They live in mnci only as strings, which mnci's own lint never parses, while the
 * generated workspace's `eslint .` does. That gap shipped a regex with an unused
 * capturing group in `tools/vscode-extension.cjs`, and `mnci add vscode-extension`
 * left every workspace with a red `npm run lint` (#249).
 */

// The scaffolding barrel reaches the prompts, an ESM package Jest does not transform.
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CSHARP_VERSION_ACTIONS } from './project-scaffolding/csharp.use-case'
import { VSCODE_EXTENSION_SCRIPT, VSCODE_EXTENSION_SCRIPT_PATH } from './project-scaffolding/vscode-extension.use-case'
import { ESLINT_MNCI_CONFIG, ESLINT_MNCI_FILENAME, ESLINT_USER_CONFIG } from './workspace-overlay'

const REPO_ROOT = resolve(__dirname, '../../..')

/*
 * A stand-in workspace holding the two ESLint files mnci generates, and nothing else.
 * Inside this repository (test-output/ is ignored), never in the system temp folder:
 * the generated config imports @mnci/eslint-config, which resolves only by walking up
 * to this repository's node_modules. This repository's own config cannot stand in for
 * it, because it ignores tools/ while a generated workspace lints it.
 */
let workspace: string

beforeAll(() => {
  const parent = join(REPO_ROOT, 'packages/cli/test-output')
  mkdirSync(parent, { recursive: true })
  workspace = mkdtempSync(join(parent, 'generated-lint-'))
  writeFileSync(join(workspace, ESLINT_MNCI_FILENAME), ESLINT_MNCI_CONFIG)
  writeFileSync(join(workspace, 'eslint.config.mjs'), ESLINT_USER_CONFIG)
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

function lint (path: string, content: string): { status: number | null; output: string } {
  mkdirSync(join(workspace, 'tools'), { recursive: true })
  writeFileSync(join(workspace, path), content)
  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'node_modules/eslint/bin/eslint.js'), '--no-cache', path],
    { cwd: workspace, encoding: 'utf8' },
  )

  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('scripts mnci writes into tools/ pass the lint they will be linted by', () => {
  it.each([
    [VSCODE_EXTENSION_SCRIPT_PATH, VSCODE_EXTENSION_SCRIPT],
    ['tools/csharp-version-actions.cjs', CSHARP_VERSION_ACTIONS],
  ])('%s', (path, content) => {
    const result = lint(path, content)

    expect(result.output).toBe('')
    expect(result.status).toBe(0)
  })
})
