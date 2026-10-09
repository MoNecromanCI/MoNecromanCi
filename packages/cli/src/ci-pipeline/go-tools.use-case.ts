import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { listGoModuleDirectories } from '../go-workspace'
import { GOLANGCI_LINT_VERSION } from '../workspace-overlay'
import { addToPath, type CiHost } from './ci-environment.client'
import type { CiDependencies, CiProcesses } from './phase.contract'

/**
 * The machine a phase runs on, so a test can describe another one.
 *
 * @remarks
 * `platform` and `architecture` pick the tool release to download; `home` is where a tool that mnci
 * installs itself (the Flutter SDK) lives.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface Machine {
  readonly platform:     NodeJS.Platform
  readonly architecture: string
  readonly home:         string
}

/**
 * The machine this process runs on.
 *
 * @remarks
 * Read when a phase starts, so a test never depends on it: it passes its own {@link Machine}.
 *
 * @param None - this function takes no parameters.
 * @returns The platform, the CPU architecture and the home directory.
 * @throws Never - these are always available.
 * @typeParam None - this function has no generic type parameters.
 */
export function currentMachine (): Machine {
  return { platform: process.platform, architecture: process.arch, home: homedir() }
}

/** Where `golangci-lint` is built from when no prebuilt release can be used. */
const GOLANGCI_LINT_MODULE = 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint'

/**
 * Downloads the workspace's Go module dependencies.
 *
 * @remarks
 * A workspace has Go projects when it has a `go.work` (the multi-module layout `mnci add go-*` creates, with no
 * root module) or a root `go.mod` (an adopted flat repository). A plain `go mod download` at the root fails in the
 * first layout, so each module the `go.work` lists is downloaded on its own with `go -C`. Without either file this
 * does nothing.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns 0 when there is no Go project or every download worked, otherwise the first failing status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
export function downloadGoModules (workspaceRoot: string, processes: CiProcesses, log: (message: string) => void): number {
  const modules = listGoModuleDirectories(workspaceRoot)
  if (modules === undefined) {
    log('No Go projects - skipping.')

    return 0
  }
  for (const directory of modules) {
    const status = processes.run('go', directory === '.' ? ['mod', 'download'] : ['-C', directory, 'mod', 'download'])
    if (status !== 0) {
      return status
    }
  }

  return 0
}

/**
 * The version a `golangci-lint --version` output reports.
 *
 * @param output - What the command printed.
 * @returns The version without a leading `v`, or `undefined` when none can be read.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function installedVersion (output: string): string | undefined {
  return /\bversion\s+v?(\d+\.\d+\.\d+)/.exec(output)?.[1]
}

/**
 * Installs `golangci-lint` at the pinned version, verifying the download against the release's checksums.
 *
 * @remarks
 * Skips when there is no Go project (no `go.work` and no root `go.mod`) or the pinned version is already installed. Otherwise it downloads the
 * prebuilt release for this OS and architecture (about a second, against about 70 compiling it),
 * checks its SHA-256 against the release's own checksum file, extracts it with the system `tar` and
 * puts the binary in `GOPATH/bin`. Anything that goes wrong (no prebuilt release for this platform, a
 * failed download, a checksum that is missing or does not match, an archive that will not extract)
 * falls back to `go install` at the same pinned version, so the linter's version never depends on
 * which path ran. A checksum mismatch is never accepted.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The process runner, the logger and the downloader.
 * @param machine - The machine, which picks the release.
 * @returns 0 when the linter is available afterwards, otherwise the fallback build's status.
 * @throws Never - every failure falls back.
 * @typeParam None - this function has no generic type parameters.
 */
export async function installGolangciLint (
  workspaceRoot: string,
  dependencies: Pick<CiDependencies, 'processes' | 'log' | 'fetchBytes'>,
  machine: Machine,
): Promise<number> {
  const { processes, log, fetchBytes } = dependencies
  if (listGoModuleDirectories(workspaceRoot) === undefined) {
    log('No Go projects - skipping.')

    return 0
  }
  const installed = processes.capture('golangci-lint', ['--version'])
  if (installed.status === 0 && installedVersion(installed.stdout) === GOLANGCI_LINT_VERSION) {
    log(`golangci-lint ${GOLANGCI_LINT_VERSION} already installed - skipping.`)

    return 0
  }
  if (installed.status === 0) {
    // One on PATH is not enough: a runner image or a devcontainer feature ships its own, and finding it used to
    // skip the pin, so the version CI verified depended on the machine (#241).
    log(`golangci-lint ${installedVersion(installed.stdout) ?? 'of an unknown version'} is on PATH, not the pinned ${GOLANGCI_LINT_VERSION} - installing the pin.`)
  }

  const version = GOLANGCI_LINT_VERSION
  const fallback = (reason: string): number => {
    log(`Prebuilt golangci-lint ${version} unavailable (${reason}) - building it with go install instead.`)

    return processes.run('go', ['install', `${GOLANGCI_LINT_MODULE}@v${version}`])
  }
  const platform = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[machine.platform as string]
  const architecture = { x64: 'amd64', arm64: 'arm64' }[machine.architecture]
  if (platform === undefined || architecture === undefined) {
    return fallback(`no prebuilt release for ${machine.platform}/${machine.architecture}`)
  }
  const gopath = processes.capture('go', ['env', 'GOPATH'])
  if (gopath.status !== 0) {
    return fallback('go env GOPATH failed')
  }

  const name = `golangci-lint-${version}-${platform}-${architecture}`
  const file = `${name}${platform === 'windows' ? '.zip' : '.tar.gz'}`
  const base = `https://github.com/golangci/golangci-lint/releases/download/v${version}/`
  let temporary: string | undefined
  try {
    const checksumFile = await fetchBytes(`${base}golangci-lint-${version}-checksums.txt`)
    const checksums = checksumFile.toString('utf8')
    const entry = checksums.split('\n').map(line => line.trim().split(' ').filter(Boolean)).find(parts => parts[1] === file)
    if (entry === undefined) {
      throw new Error(`${file} is not in the release checksums`)
    }
    const archive = await fetchBytes(base + file)
    if (createHash('sha256').update(archive).digest('hex') !== entry[0]) {
      throw new Error(`checksum mismatch for ${file}`)
    }

    temporary = mkdtempSync(join(tmpdir(), 'golangci-lint-'))
    const archivePath = join(temporary, file)
    writeFileSync(archivePath, archive)
    const tar = platform === 'windows' ? join(process.env.SystemRoot ?? '', 'System32', 'tar.exe') : 'tar'
    if (processes.run(tar, ['-xf', archivePath, '-C', temporary]) !== 0) {
      throw new Error(`could not extract ${file}`)
    }
    const executable = `golangci-lint${platform === 'windows' ? '.exe' : ''}`
    const bin = join(gopath.stdout.trim(), 'bin')
    mkdirSync(bin, { recursive: true })
    copyFileSync(join(temporary, name, executable), join(bin, executable))
    chmodSync(join(bin, executable), 0o755)
    log(`golangci-lint ${version} installed from its checksum-verified prebuilt release into ${bin}`)

    return 0
  } catch (error) {
    return fallback(error instanceof Error ? error.message : String(error))
  } finally {
    if (temporary !== undefined) {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}

/**
 * Puts `GOPATH/bin`, where `golangci-lint` lives, on `PATH` for the steps that follow.
 *
 * @remarks
 * Needed whether the linter was downloaded or built, since both put it in `GOPATH/bin`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param host - Where the phase is running.
 * @param environment - The process environment.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns Nothing; it skips when there is no Go project or `GOPATH` cannot be resolved.
 * @throws Error when the CI's PATH file cannot be appended to.
 * @typeParam None - this function has no generic type parameters.
 */
export function publishGoTools (
  workspaceRoot: string,
  host: CiHost,
  environment: NodeJS.ProcessEnv,
  processes: CiProcesses,
  log: (message: string) => void,
): void {
  if (listGoModuleDirectories(workspaceRoot) === undefined) {
    log('No Go projects - skipping.')

    return
  }
  const gopath = processes.capture('go', ['env', 'GOPATH'])
  if (gopath.status !== 0) {
    log('Could not resolve GOPATH - skipping.')

    return
  }
  addToPath(host, environment, join(gopath.stdout.trim(), 'bin'), log)
}
