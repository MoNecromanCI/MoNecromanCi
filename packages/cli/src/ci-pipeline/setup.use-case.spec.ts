// Reached through the overlay barrel (pinned tool versions), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Machine } from './go-tools.use-case'
import type { CiProcesses } from './phase.contract'
import { runSetup } from './setup.use-case'

const VERSION = '2.14.0'
const LINUX: Machine = { platform: 'linux', architecture: 'x64', home: '' }

let workspaceRoot: string
let home: string
let gopath: string

interface Harness {
  commands:  string[]
  logged:    string[]
  fetched:   string[]
  processes: CiProcesses
}

/** Options for a harness: what commands answer, and what the downloader serves. */
interface HarnessOptions {
  runStatuses?: Record<string, number>
  captures?:    Record<string, number>
  downloads?:   Record<string, Buffer | Error>
}

/**
 * A recording runner. `tar` really extracts nothing, so it plants the file the phase expects.
 * `go env GOPATH` answers the temporary GOPATH; every other capture answers 1 (not installed).
 */
function harness (options: HarnessOptions = {}): Harness {
  const commands: string[] = []
  const processes: CiProcesses = {
    run: (command, arguments_) => {
      const line = [command, ...arguments_].join(' ')
      commands.push(line)
      if (command.endsWith('tar') || command.endsWith('tar.exe')) {
        const [, archive, , target] = arguments_
        const name = /golangci-lint-[\d.]+-\w+-\w+/.exec(archive)?.[0] ?? ''
        mkdirSync(join(target, name), { recursive: true })
        writeFileSync(join(target, name, command === 'tar' ? 'golangci-lint' : 'golangci-lint.exe'), 'binary')
      }

      return options.runStatuses?.[line] ?? 0
    },
    capture: (command, arguments_) => {
      const line = [command, ...arguments_].join(' ')
      commands.push(`capture: ${line}`)
      if (line === 'go env GOPATH') {
        return { status: options.captures?.[line] ?? 0, stdout: `${gopath}\n` }
      }

      return { status: options.captures?.[line] ?? 1, stdout: '' }
    },
  }

  return { commands, logged: [], fetched: [], processes }
}

/** Serves the golangci-lint release for `file`, with a checksum file that lists it under `sum`. */
function release (file: string, archive: Buffer, sum = createHash('sha256').update(archive).digest('hex')): Record<string, Buffer> {
  const base = `https://github.com/golangci/golangci-lint/releases/download/v${VERSION}/`

  return {
    [`${base}golangci-lint-${VERSION}-checksums.txt`]: Buffer.from(`${sum}  ${file}\n0000  something-else.tar.gz\n`),
    [base + file]:                                     archive,
  }
}

/** Runs the phase with the recording runner. */
async function setup (
  recorder: Harness,
  environment: NodeJS.ProcessEnv = {},
  machine: Machine | undefined = undefined,
  downloads: Record<string, Buffer | Error> = {},
): Promise<number> {
  return runSetup(workspaceRoot, {
    processes:  recorder.processes,
    environment,
    log:        message => { recorder.logged.push(message) },
    fetchBytes: async url => {
      recorder.fetched.push(url)
      const served = downloads[url]
      if (served === undefined || served instanceof Error) {
        throw served ?? new Error(`HTTP 404 for ${url}`)
      }

      return served
    },
  }, machine ?? { ...LINUX, home })
}

/** Writes a file under the workspace. */
function seed (relative: string, contents = ''): void {
  mkdirSync(dirname(join(workspaceRoot, relative)), { recursive: true })
  writeFileSync(join(workspaceRoot, relative), contents)
}

/** Commands that ran, without the `capture:` probes, with path separators normalised. */
function ran (recorder: Harness): string[] {
  return recorder.commands.filter(command => !command.startsWith('capture:')).map(command => command.replaceAll('\\', '/'))
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-setup-'))
  home = mkdtempSync(join(tmpdir(), 'mnci-home-'))
  gopath = mkdtempSync(join(tmpdir(), 'mnci-gopath-'))
})

afterEach(() => {
  for (const directory of [workspaceRoot, home, gopath]) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('mnci ci setup: a workspace with no projects to set up (#269)', () => {
  it('does nothing, says so for each language, and passes', async () => {
    const recorder = harness()

    expect(await setup(recorder)).toBe(0)

    expect(ran(recorder)).toEqual([])
    for (const language of ['Python', 'Go', 'Flutter']) {
      expect(recorder.logged).toContain(`No ${language} projects - skipping.`)
    }
  })
})

describe('mnci ci setup: Python (#269)', () => {
  it('installs the fixed toolchain from requirements-dev.txt', async () => {
    seed('requirements-dev.txt')
    const recorder = harness()

    await setup(recorder)

    expect(ran(recorder)).toContain('python3 -m pip install -r requirements-dev.txt')
  })

  it('calls the interpreter `python` on Windows, where python.org registers no python3', async () => {
    seed('requirements-dev.txt')
    const recorder = harness()

    await setup(recorder, {}, { platform: 'win32', architecture: 'x64', home })

    expect(ran(recorder)[0]).toBe('python -m pip install -r requirements-dev.txt')
  })

  it('installs every project in one pip run: libraries and apps editable, function apps from requirements', async () => {
    seed('apps/api/pyproject.toml')
    seed('python-packages/core/pyproject.toml')
    seed('libs/shared/pyproject.toml')
    seed('apps/fn/requirements.txt')
    const recorder = harness()

    await setup(recorder)

    expect(ran(recorder)).toEqual([
      'python3 -m pip install --quiet -e apps/api -e python-packages/core -e libs/shared -r apps/fn/requirements.txt',
    ])
  })

  it('stops at the first failing step, running nothing after it', async () => {
    seed('requirements-dev.txt')
    seed('go.mod')
    const recorder = harness({ runStatuses: { 'python3 -m pip install -r requirements-dev.txt': 7 } })

    expect(await setup(recorder)).toBe(7)

    expect(ran(recorder)).toEqual(['python3 -m pip install -r requirements-dev.txt'])
    expect(recorder.logged).toContain('Setup stopped at: Install Python dependencies (ruff, pytest, build, twine)')
  })
})

describe('mnci ci setup: Go (#269)', () => {
  it('downloads the modules of a workspace with a root go.mod', async () => {
    seed('go.mod')
    const recorder = harness({ captures: { 'golangci-lint --version': 0 } })

    await setup(recorder)

    expect(ran(recorder)).toContain('go mod download')
  })

  it('downloads each module a go.work lists, since a root go mod download fails with no root module (#405)', async () => {
    seed('go.work', 'go 1.24\n\nuse (\n\t./apps/cli\n\t./libs/core\n)\n')
    const recorder = harness({ captures: { 'golangci-lint --version': 0 } })

    await setup(recorder)

    expect(ran(recorder)).toEqual(expect.arrayContaining(['go -C ./apps/cli mod download', 'go -C ./libs/core mod download']))
    expect(ran(recorder)).not.toContain('go mod download')
  })

  it('installs golangci-lint in a multi-module workspace, which has a go.work and no root go.mod (#405)', async () => {
    seed('go.work', 'use ./apps/cli\n')
    const recorder = harness()

    await setup(recorder)

    expect(recorder.fetched.length).toBeGreaterThan(0)
    expect(recorder.logged).not.toContain('No Go projects - skipping.')
  })

  it('stops at the first module whose download fails', async () => {
    seed('go.work', 'use (\n./a\n./b\n)\n')
    const recorder = harness({ captures: { 'golangci-lint --version': 0 }, runStatuses: { 'go -C ./a mod download': 3 } })

    await setup(recorder)

    expect(ran(recorder)).not.toContain('go -C ./b mod download')
  })

  it('leaves golangci-lint alone when it is already installed', async () => {
    seed('go.mod')
    const recorder = harness({ captures: { 'golangci-lint --version': 0 } })

    await setup(recorder)

    expect(recorder.fetched).toEqual([])
    expect(recorder.logged).toContain('golangci-lint already installed - skipping.')
  })

  it('installs the prebuilt release after verifying its checksum, into GOPATH/bin', async () => {
    seed('go.mod')
    const file = `golangci-lint-${VERSION}-linux-amd64.tar.gz`
    const recorder = harness()

    const downloads = release(file, Buffer.from('archive'))

    expect(await setup(recorder, {}, { ...LINUX, home }, downloads)).toBe(0)

    expect(existsSync(join(gopath, 'bin', 'golangci-lint'))).toBe(true)
    expect(recorder.logged.some(line => line.includes('installed from its checksum-verified prebuilt release'))).toBe(true)
    expect(ran(recorder).some(command => command.startsWith('go install'))).toBe(false)
  })

  it('requests the Windows zip and the .exe on Windows', async () => {
    seed('go.mod')
    const file = `golangci-lint-${VERSION}-windows-amd64.zip`
    const recorder = harness()

    await setup(recorder, {}, { platform: 'win32', architecture: 'x64', home }, release(file, Buffer.from('archive')))

    expect(recorder.fetched.some(url => url.endsWith(file))).toBe(true)
    expect(existsSync(join(gopath, 'bin', 'golangci-lint.exe'))).toBe(true)
  })

  it('never accepts a checksum mismatch: it builds the linter at the same version instead', async () => {
    seed('go.mod')
    const file = `golangci-lint-${VERSION}-linux-amd64.tar.gz`
    const recorder = harness()

    await setup(recorder, {}, { ...LINUX, home }, release(file, Buffer.from('archive'), 'deadbeef'))

    expect(recorder.logged.some(line => line.includes('checksum mismatch'))).toBe(true)
    expect(ran(recorder)).toContain(`go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v${VERSION}`)
    expect(existsSync(join(gopath, 'bin', 'golangci-lint'))).toBe(false)
  })

  it.each([
    ['the release is missing from the checksums', (file: string) => release(`other-${file}`, Buffer.from('archive')), /is not in the release checksums/],
    ['the download fails', () => ({}) as Record<string, Error>, /HTTP 404/],
  ])('falls back to go install when %s', async (_label, downloads, reason) => {
    seed('go.mod')
    const recorder = harness()

    await setup(recorder, {}, { ...LINUX, home }, downloads(`golangci-lint-${VERSION}-linux-amd64.tar.gz`))

    expect(recorder.logged.some(line => reason.test(line))).toBe(true)
    expect(ran(recorder)).toContain(`go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v${VERSION}`)
  })

  it('falls back to go install, and leaves no temporary files, when the archive cannot be extracted', async () => {
    seed('go.mod')
    const file = `golangci-lint-${VERSION}-linux-amd64.tar.gz`
    const recorder = harness({ runStatuses: {} })
    const failing: CiProcesses = { ...recorder.processes, run: (command, arguments_) => (command === 'tar' ? 1 : recorder.processes.run(command, arguments_)) }

    await runSetup(workspaceRoot, {
      processes: failing, environment: {}, log: message => { recorder.logged.push(message) }, fetchBytes: async url => release(file, Buffer.from('a'))[url],
    }, { ...LINUX, home })

    expect(recorder.logged.some(line => line.includes(`could not extract ${file}`))).toBe(true)
    expect(ran(recorder)).toContain(`go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v${VERSION}`)
  })

  it('builds the linter when there is no prebuilt release for this platform', async () => {
    seed('go.mod')
    const recorder = harness()

    await setup(recorder, {}, { platform: 'freebsd', architecture: 'x64', home })

    expect(recorder.logged.some(line => line.includes('no prebuilt release for freebsd/x64'))).toBe(true)
    expect(recorder.fetched).toEqual([])
  })

  it('puts GOPATH/bin on the next steps\' PATH through GITHUB_PATH on GitHub', async () => {
    seed('go.mod')
    const pathFile = join(home, 'github-path')
    writeFileSync(pathFile, '')
    const recorder = harness({ captures: { 'golangci-lint --version': 0 } })

    await setup(recorder, { GITHUB_ACTIONS: 'true', GITHUB_PATH: pathFile })

    expect(readFileSync(pathFile, 'utf8')).toBe(`${join(gopath, 'bin')}\n`)
  })

  it('publishes it with the logging command on Azure', async () => {
    seed('go.mod')
    const recorder = harness({ captures: { 'golangci-lint --version': 0 } })

    await setup(recorder, { TF_BUILD: 'True' })

    expect(recorder.logged).toContain(`##vso[task.prependpath]${join(gopath, 'bin')}`)
  })

  it('does not touch PATH on a developer machine', async () => {
    seed('go.mod')
    const recorder = harness({ captures: { 'golangci-lint --version': 0 } })

    await setup(recorder)

    expect(recorder.logged).toContain('Not running in a CI that reads a PATH file - skipping.')
  })
})

describe('mnci ci setup: Flutter (#269)', () => {
  it('leaves an SDK that is already on PATH alone', async () => {
    seed('pubspec.yaml')
    const recorder = harness({ captures: { 'flutter --version': 0 } })

    await setup(recorder)

    expect(ran(recorder).some(command => command.startsWith('git clone'))).toBe(false)
    expect(recorder.logged).toContain('Flutter SDK already on PATH - skipping.')
  })

  it('clones the pinned SDK into the home directory, outside the workspace, when the runner has none', async () => {
    seed('pubspec.yaml')
    const recorder = harness()

    await setup(recorder)

    const sdk = join(home, '.mnci-flutter-3.44.8').replaceAll('\\', '/')
    expect(ran(recorder)).toContain(`git clone --depth 1 --branch 3.44.8 https://github.com/flutter/flutter.git ${sdk}`)
  })

  it('reuses an SDK an earlier run left in place, and publishes its bin to PATH', async () => {
    seed('pubspec.yaml')
    mkdirSync(join(home, '.mnci-flutter-3.44.8'), { recursive: true })
    const pathFile = join(home, 'github-path')
    writeFileSync(pathFile, '')
    const recorder = harness()

    await setup(recorder, { GITHUB_ACTIONS: 'true', GITHUB_PATH: pathFile })

    expect(ran(recorder).some(command => command.startsWith('git clone'))).toBe(false)
    expect(readFileSync(pathFile, 'utf8')).toBe(`${join(home, '.mnci-flutter-3.44.8', 'bin')}\n`)
  })

  it('does not publish a PATH entry for an SDK it did not install', async () => {
    seed('pubspec.yaml')
    const recorder = harness({ captures: { 'flutter --version': 0 } })

    await setup(recorder)

    expect(recorder.logged).toContain('Flutter SDK was not installed by mnci (already on PATH) - skipping.')
  })

  it('resolves the Dart dependencies of the whole workspace with one pub get, last', async () => {
    seed('pubspec.yaml')
    const recorder = harness({ captures: { 'flutter --version': 0 } })

    await setup(recorder)

    expect(ran(recorder).at(-1)).toBe('flutter pub get')
  })
})

describe('mnci ci setup: the order (#269)', () => {
  it('runs Python, then Go, then Flutter, as the pipeline did', async () => {
    seed('requirements-dev.txt')
    seed('go.mod')
    seed('pubspec.yaml')
    const recorder = harness({ captures: { 'golangci-lint --version': 0, 'flutter --version': 0 } })

    await setup(recorder)

    expect(ran(recorder)).toEqual(['python3 -m pip install -r requirements-dev.txt', 'go mod download', 'flutter pub get'])
  })
})
