// Reached through the overlay barrel (readMnciConfig, the registry helpers), which loads the
// prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRelease } from './release.use-case'
import type { CaptureResult } from '../nx-workspace'
import type { CiProcesses } from './phase.contract'

let workspaceRoot: string

interface Harness {
  commands:  string[]
  logged:    string[]
  processes: CiProcesses
}

/**
 * A recording runner. `runStatuses` overrides a run command's exit status;
 * `captures` overrides a captured command's result. By default `git rev-parse`
 * reports a full clone and `npm whoami` succeeds.
 */
function harness (
  runStatuses: Record<string, number> = {},
  captures: Record<string, CaptureResult> = {},
): Harness {
  const commands: string[] = []
  const logged: string[] = []
  const processes: CiProcesses = {
    run: (command, arguments_) => {
      const line = [command, ...arguments_].join(' ')
      commands.push(line)

      return runStatuses[line] ?? 0
    },
    capture: (command, arguments_) => {
      const line = [command, ...arguments_].join(' ')
      const override = captures[line]
      if (override !== undefined) {
        return override
      }
      if (line.startsWith('git rev-parse')) {
        return { status: 0, stdout: 'false' }
      }
      if (line.startsWith('npm whoami')) {
        return { status: 0, stdout: 'ci-user' }
      }

      return { status: 1, stdout: '' }
    },
  }

  return { commands, logged, processes }
}

/** Runs the phase with the recording runner and a controllable environment + PyPI probe. */
async function release (
  setup: Harness,
  environment: NodeJS.ProcessEnv = {},
  fetchStatus: (url: string) => Promise<number> = async () => 200,
): Promise<number> {
  return runRelease(workspaceRoot, {
    processes: setup.processes,
    environment,
    log:       (message) => { setup.logged.push(message) },
    fetchStatus,
  })
}

/** Writes a file under the workspace, making its directory first. */
function seed (relative: string, content = '{}'): void {
  const path = join(workspaceRoot, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

/** Whether `npx nx release …` was run. */
function released (setup: Harness): boolean {
  return setup.commands.some(line => line.startsWith('npx nx release'))
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-release-'))
  seed('nx.json') // a public-npm workspace by default (no persisted registry)
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('mnci ci release: preflights (#269)', () => {
  it('refuses to release from a shallow clone and never tags', async () => {
    const setup = harness({}, { 'git rev-parse --is-shallow-repository': { status: 0, stdout: 'true' } })

    const status = await release(setup)

    expect(status).toBe(1)
    expect(setup.logged.some(line => line.includes('shallow clone'))).toBe(true)
    expect(released(setup)).toBe(false)
  })

  it('refuses when the shallow check itself cannot run', async () => {
    const setup = harness({}, { 'git rev-parse --is-shallow-repository': { status: 128, stdout: '' } })

    expect(await release(setup)).toBe(1)
    expect(released(setup)).toBe(false)
  })

  it('fails when an npm workspace has no NODE_AUTH_TOKEN', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness()

    const status = await release(setup, {})

    expect(status).toBe(1)
    expect(setup.logged.some(line => line.includes('NPM_TOKEN is empty or unset'))).toBe(true)
    expect(released(setup)).toBe(false)
  })

  it('fails when npm whoami rejects the token', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness({}, { 'npm whoami --registry=https://registry.npmjs.org/': { status: 1, stdout: 'E401' } })

    expect(await release(setup, { NODE_AUTH_TOKEN: 'tok' })).toBe(1)
    expect(setup.logged.some(line => line.includes('the registry rejected it'))).toBe(true)
  })

  it('fails when PYPI_TOKEN is missing or malformed', async () => {
    seed('python-packages/core/pyproject.toml', '[project]\nname = "core"\n')
    const noToken = harness()

    expect(await release(noToken, {})).toBe(1)
    expect(noToken.logged.some(line => line.includes('PYPI_TOKEN is empty or unset'))).toBe(true)

    const badShape = harness()
    expect(await release(badShape, { PYPI_TOKEN: 'not-a-pypi-token' })).toBe(1)
    expect(badShape.logged.some(line => line.includes('begins with pypi-'))).toBe(true)
  })

  it('notes the PyPI projects a release would create, without failing', async () => {
    seed('python-packages/core/pyproject.toml', '[project]\nname = "brand-new-pkg"\n')
    const setup = harness()

    const status = await release(setup, { PYPI_TOKEN: 'pypi-abc' }, async () => 404)

    expect(status).toBe(0)
    expect(setup.logged.some(line => line.includes('may CREATE') && line.includes('brand-new-pkg'))).toBe(true)
    expect(released(setup)).toBe(true)
  })
})

describe('mnci ci release: the release command (#269)', () => {
  it('skips cleanly when nothing is releasable', async () => {
    const setup = harness()

    const status = await release(setup)

    expect(status).toBe(0)
    expect(setup.logged.some(line => line.includes('Nothing to release'))).toBe(true)
    expect(released(setup)).toBe(false)
  })

  it('runs nx release for a packaged workspace with proven auth', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness()

    const status = await release(setup, { NODE_AUTH_TOKEN: 'tok' })

    expect(status).toBe(0)
    expect(setup.commands).toContain('npx nx release --yes')
  })

  it('passes an exact RELEASE_SPECIFIER through to nx release', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness()

    await release(setup, { NODE_AUTH_TOKEN: 'tok', RELEASE_SPECIFIER: '1.2.3' })

    expect(setup.commands).toContain('npx nx release 1.2.3 --yes')
  })

  it('rejects an invalid RELEASE_SPECIFIER', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness()

    expect(await release(setup, { NODE_AUTH_TOKEN: 'tok', RELEASE_SPECIFIER: 'latest' })).toBe(1)
    expect(setup.logged.some(line => line.includes('is invalid'))).toBe(true)
    expect(released(setup)).toBe(false)
  })

  it('rejects a bump keyword when more than one package is releasable', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    seed('packages/ui/package.json', JSON.stringify({ name: '@x/ui' }))
    const setup = harness()

    expect(await release(setup, { NODE_AUTH_TOKEN: 'tok', RELEASE_SPECIFIER: 'minor' })).toBe(1)
    expect(setup.logged.some(line => line.includes('under-bumps interdependent packages'))).toBe(true)
  })

  it('surfaces the nx release exit status', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness({ 'npx nx release --yes': 2 })

    expect(await release(setup, { NODE_AUTH_TOKEN: 'tok' })).toBe(2)
  })
})

describe('mnci ci release: after the release (#269, #259)', () => {
  it('pushes the release tags once nx release has succeeded, when no GitHub Release does it', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness()

    expect(await release(setup, { NODE_AUTH_TOKEN: 'tok' })).toBe(0)

    expect(setup.commands.at(-1)).toBe('git push origin --tags')
  })

  it('attaches no Go zips and pushes the tags, when nx release does not push its own', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    seed('tools/go-app-release.cjs', '')
    seed('nx.json', JSON.stringify({ release: { git: { push: false } } }))
    const setup = harness()

    await release(setup, { NODE_AUTH_TOKEN: 'tok' })

    // No Release exists with Azure in the mix, so there is nothing to attach to: the tag push is all there is.
    expect(setup.commands.slice(-2)).toEqual(['npx nx release --yes', 'git push origin --tags'])
  })

  it('attaches the Go zips to the GitHub Release nx release created, and leaves the tag push to nx release', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    seed('tools/go-app-release.cjs', '')
    seed('nx.json', JSON.stringify({ release: { git: { push: true } } }))
    const setup = harness()

    await release(setup, { NODE_AUTH_TOKEN: 'tok' })

    expect(setup.commands.slice(-2)).toEqual(['npx nx release --yes', 'node tools/go-app-release.cjs assets'])
  })

  it('skips the Go step in a workspace with no releasable Go app, and still pushes the tags', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness()

    await release(setup, { NODE_AUTH_TOKEN: 'tok' })

    expect(setup.commands.some(command => command.includes('go-app-release'))).toBe(false)
    expect(setup.commands).toContain('git push origin --tags')
  })

  it('pushes nothing when nx release failed: the tags it made are not published', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness({ 'npx nx release --yes': 2 })

    expect(await release(setup, { NODE_AUTH_TOKEN: 'tok' })).toBe(2)

    expect(setup.commands).not.toContain('git push origin --tags')
  })

  it('still pushes the tags of the packages that published when only some failed to publish', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    const setup = harness({}, { 'git tag --points-at HEAD': { status: 0, stdout: '@x/sdk@1.0.1\n@x/bad@0.0.6\n' } })
    setup.processes.tee = async (command, arguments_) => {
      setup.commands.push([command, ...arguments_].join(' '))

      return { status: 1, output: 'Failed tasks:\n- @x/bad:nx-release-publish\n' }
    }

    expect(await release(setup, { NODE_AUTH_TOKEN: 'tok' })).toBe(1)

    expect(setup.commands).toContain('git push origin refs/tags/@x/sdk@1.0.1')
    expect(setup.commands).not.toContain('git push origin --tags')
  })

  it('fails the run when attaching the Go zips failed', async () => {
    seed('packages/sdk/package.json', JSON.stringify({ name: '@x/sdk' }))
    seed('tools/go-app-release.cjs', '')
    seed('nx.json', JSON.stringify({ release: { git: { push: true } } }))
    const setup = harness({ 'node tools/go-app-release.cjs assets': 3 })

    expect(await release(setup, { NODE_AUTH_TOKEN: 'tok' })).toBe(3)
  })
})

/** A go-lib project, which `nx release` excludes. */
function goLibrary (): void {
  seed('packages/tty/project.json', JSON.stringify({ name: 'tty', tags: ['type:go-lib'] }))
}

/** The git commands the harness answered through `capture`, in order. */
function gitCaptures (setup: Harness, captures: Record<string, CaptureResult>): string[] {
  const asked: string[] = []
  const original = setup.processes.capture
  setup.processes.capture = (command, arguments_) => {
    const line = [command, ...arguments_].join(' ')
    if (command === 'git' && captures[line] !== undefined) {
      asked.push(line)

      return captures[line]
    }

    return original(command, arguments_)
  }

  return asked
}

describe('mnci ci release: Go libraries (#359)', () => {
  const OK: CaptureResult = { status: 0, stdout: '' }
  const LOG = 'git log --format=%s\u{1F}%b\u{1E} -- packages/tty'

  it('tags and pushes a go-lib after nx release, even in a workspace with nothing else to release', async () => {
    goLibrary()
    const setup = harness()
    const asked = gitCaptures(setup, {
      'git tag --list packages/tty/v*':      OK,
      [LOG]:                                 { status: 0, stdout: 'feat: first\u{1F}\u{1E}' },
      'git tag packages/tty/v0.0.1':         OK,
      'git push origin packages/tty/v0.0.1': OK,
    })

    expect(await release(setup, { NODE_AUTH_TOKEN: 'x' })).toBe(0)
    expect(asked).toEqual(['git tag --list packages/tty/v*', LOG, 'git tag packages/tty/v0.0.1', 'git push origin packages/tty/v0.0.1'])
  })

  it('does not touch git for tags in a workspace with no go-lib', async () => {
    const setup = harness()
    const asked = gitCaptures(setup, {})

    await release(setup)

    expect(asked).toEqual([])
  })

  it('fails the run, saying why, when tagging fails', async () => {
    goLibrary()
    const setup = harness()
    gitCaptures(setup, { 'git tag --list packages/tty/v*': { status: 128, stdout: '' } })

    expect(await release(setup)).toBe(1)
    expect(setup.logged.join('\n')).toContain('Releasing the Go libraries failed')
  })

  it('tags nothing, and does not run, when nx release itself failed', async () => {
    seed('packages/lib/package.json')
    goLibrary()
    const setup = harness({ 'npx nx release --yes': 1 })
    const asked = gitCaptures(setup, { 'git tag --list packages/tty/v*': OK })

    expect(await release(setup, { NODE_AUTH_TOKEN: 'x' })).not.toBe(0)
    expect(asked).toEqual([])
  })
})

describe('mnci ci release: publish credentials (#269)', () => {
  it('wires the public PyPI token into TWINE_* for a Python release', async () => {
    seed('python-packages/core/pyproject.toml', '[project]\nname = "core"\n')
    const setup = harness()
    const environment: NodeJS.ProcessEnv = { PYPI_TOKEN: 'pypi-abc' }

    await release(setup, environment, async () => 200)

    expect(environment.TWINE_USERNAME).toBe('__token__')
    expect(environment.TWINE_PASSWORD).toBe('pypi-abc')
    expect(environment.TWINE_NON_INTERACTIVE).toBe('1')
  })

  it('wires the base64 PAT into TWINE_* for an Azure Artifacts Python release', async () => {
    seed('nx.json', JSON.stringify({ mnci: { registry: { kind: 'azure-artifacts', organization: 'org', project: 'proj', artifactsFeed: 'feed' } } }))
    seed('python-packages/core/pyproject.toml', '[project]\nname = "core"\n')
    const setup = harness()
    const pat = Buffer.from('secret').toString('base64')
    const environment: NodeJS.ProcessEnv = { PAT: pat }

    await release(setup, environment)

    expect(environment.TWINE_USERNAME).toBe('AzureArtifacts')
    expect(environment.TWINE_PASSWORD).toBe('secret')
    expect(released(setup)).toBe(true)
  })

  it('fails an Azure Artifacts release when PAT is empty', async () => {
    seed('nx.json', JSON.stringify({ mnci: { registry: { kind: 'azure-artifacts', organization: 'org', project: 'proj', artifactsFeed: 'feed' } } }))
    seed('python-packages/core/pyproject.toml', '[project]\nname = "core"\n')
    const setup = harness()

    expect(await release(setup, {})).toBe(1)
    expect(setup.logged.some(line => line.includes('PAT is empty'))).toBe(true)
    expect(released(setup)).toBe(false)
  })
})
