import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
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
 * The root `go.mod` is what marks a workspace as having Go projects; without one this does nothing.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param processes - The process runner.
 * @param log - The logger.
 * @returns 0 when there is no Go project (no root `go.mod`) or the download worked, otherwise its status.
 * @throws Never - a failing command is a status.
 * @typeParam None - this function has no generic type parameters.
 */
export function downloadGoModules (workspaceRoot: string, processes: CiProcesses, log: (message: string) => void): number {
  if (!existsSync(join(workspaceRoot, 'go.mod'))) {
    log('No Go projects - skipping.')

    return 0
  }

  return processes.run('go', ['mod', 'download'])
}

/**
 * Installs `golangci-lint` at the pinned version, verifying the download against the release's checksums.
 *
 * @remarks
 * Skips when there is no Go project or the linter is already installed. Otherwise it downloads the
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
  if (!existsSync(join(workspaceRoot, 'go.mod'))) {
    log('No Go projects - skipping.')

    return 0
  }
  if (processes.capture('golangci-lint', ['--version']).status === 0) {
    log('golangci-lint already installed - skipping.')

    return 0
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
  if (!existsSync(join(workspaceRoot, 'go.mod'))) {
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
