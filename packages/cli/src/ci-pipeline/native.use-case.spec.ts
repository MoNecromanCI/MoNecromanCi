// Reached through the overlay barrel (the target list), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNative } from './native.use-case'
import type { CiProcesses } from './phase.contract'

const BUILD = 'npx nx run-many -t lint,test,build-native,package-native --projects=tag:build:cgo'
const ASSETS = 'node tools/go-app-release.cjs assets --native'
const ON_MAIN: NodeJS.ProcessEnv = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main' }

let workspaceRoot: string

/** A recording runner; `statuses` overrides a command's exit status. */
function harness (statuses: Record<string, number> = {}): { commands: string[], processes: CiProcesses } {
  const commands: string[] = []
  const processes: CiProcesses = {
    run: (command, arguments_) => {
      const line = [command, ...arguments_].join(' ')
      commands.push(line)

      return statuses[line] ?? 0
    },
    capture: () => ({ status: 0, stdout: '' }),
  }

  return { commands, processes }
}

/** Runs the phase against the temporary workspace. */
function native (setup: ReturnType<typeof harness>, environment: NodeJS.ProcessEnv): number {
  return runNative(workspaceRoot, { processes: setup.processes, environment, log: () => {} })
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-native-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

/** Writes the Go release script the pipeline looks for. */
function seedReleaseScript (): void {
  mkdirSync(join(workspaceRoot, 'tools'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'tools', 'go-app-release.cjs'), '')
}

const LINUX_LEG: NodeJS.ProcessEnv = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux' }

describe('mnci ci native on a Linux agent (#269)', () => {
  it('installs the compiler and pkg-config before it builds', () => {
    const setup = harness()

    expect(native(setup, LINUX_LEG)).toBe(0)

    expect(setup.commands).toEqual(['sudo apt-get update', 'sudo apt-get install -y gcc pkg-config', BUILD])
  })

  it('adds the packages the workspace lists in nx.json, one argument each', () => {
    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ mnci: { native: { linuxPackages: ['libgtk-3-dev', 'libayatana-appindicator3-dev'] } } }))
    const setup = harness()

    native(setup, LINUX_LEG)

    expect(setup.commands[1]).toBe('sudo apt-get install -y gcc pkg-config libgtk-3-dev libayatana-appindicator3-dev')
  })

  it('never passes on a package name that could be read as an option', () => {
    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ mnci: { native: { linuxPackages: ['-o APT::Update::Pre-Invoke::=x', 'libgtk-3-dev'] } } }))
    const setup = harness()

    native(setup, LINUX_LEG)

    expect(setup.commands[1]).toBe('sudo apt-get install -y gcc pkg-config libgtk-3-dev')
  })

  it('recognises an Azure Linux agent too', () => {
    const setup = harness()

    native(setup, { TF_BUILD: 'True', AGENT_OS: 'Linux' })

    expect(setup.commands[0]).toBe('sudo apt-get update')
  })

  it('does not build when the install failed', () => {
    const setup = harness({ 'sudo apt-get update': 100 })

    expect(native(setup, LINUX_LEG)).toBe(100)

    expect(setup.commands).toEqual(['sudo apt-get update'])
  })

  it('leaves the package manager alone off CI, and on macOS and Windows legs', () => {
    for (const environment of [{}, { RUNNER_OS: 'macOS' }, { RUNNER_OS: 'Windows' }, { AGENT_OS: 'Darwin' }]) {
      const setup = harness()

      native(setup, environment)

      expect(setup.commands).toEqual([BUILD])
    }
  })
})

describe('mnci ci native (#269)', () => {
  it('lints, tests, builds and packages the native apps, and nothing else, off main', () => {
    const setup = harness()

    expect(native(setup, {})).toBe(0)

    expect(setup.commands).toEqual([BUILD])
  })

  it('surfaces a failing build and attaches nothing', () => {
    seedReleaseScript()
    const setup = harness({ [BUILD]: 4 })

    expect(native(setup, ON_MAIN)).toBe(4)

    expect(setup.commands).toEqual([BUILD])
  })

  it("attaches this OS's zip after a push to main, when the workspace has a releasable native app", () => {
    seedReleaseScript()
    const setup = harness()

    expect(native(setup, ON_MAIN)).toBe(0)

    expect(setup.commands).toEqual([BUILD, ASSETS])
  })

  it('attaches nothing on Azure, which has no GitHub Release: its leg publishes the zips as a pipeline artifact', () => {
    seedReleaseScript()
    const setup = harness()

    native(setup, { TF_BUILD: 'True', BUILD_REASON: 'IndividualCI', BUILD_SOURCEBRANCHNAME: 'main' })

    expect(setup.commands).toEqual([BUILD])
  })

  it('attaches nothing in a pull request, even with the script present', () => {
    seedReleaseScript()
    const setup = harness()

    native(setup, { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF_NAME: '12/merge' })

    expect(setup.commands).toEqual([BUILD])
  })

  it('attaches nothing without the release script: no native app is releasable', () => {
    const setup = harness()

    native(setup, ON_MAIN)

    expect(setup.commands).toEqual([BUILD])
  })

  it('surfaces a failed attach', () => {
    seedReleaseScript()
    const setup = harness({ [ASSETS]: 5 })

    expect(native(setup, ON_MAIN)).toBe(5)
  })
})
