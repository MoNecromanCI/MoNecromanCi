import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists } from '../file-system'
import { runCapture, type CaptureResult } from '../nx-workspace'
import { logger } from '../terminal'
import { NPM_VERSION } from '../workspace-overlay'

/**
 * What {@link completeLockfile} needs from outside.
 *
 * @remarks
 * Both are parameters so a test needs no npm and no network.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CompleteLockfileDependencies {
  /** Runs a command and returns its outcome; the real one by default. */
  capture: (command: string, arguments_: string[], cwd: string) => CaptureResult
  /** Where progress is said. */
  log:     { detail: (message: string) => void, warn: (message: string) => void }
}

/**
 * Reads a file, or an empty string when there is none.
 *
 * @param path - Absolute path.
 * @returns The text.
 * @throws Never - an unreadable file is empty.
 * @typeParam None - this function has no generic type parameters.
 */
function readOrEmpty (path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Has the pinned npm complete the workspace's `package-lock.json`.
 *
 * @remarks
 * A lockfile written by an OLDER npm than the one CI pins can be rejected by CI's `npm ci` with
 * `Missing: @emnapi/core@... from lock file` (#295). The writer is whatever npm the developer has: the 11.6.2 bundled
 * with Node 24.12, or the older one Dependabot uses. Measured: a lockfile from npm 11.6.2 installed under 11.6.2 and
 * failed under 11.21.0, and `npm install --package-lock-only` by the newer npm added exactly the four missing
 * entries and moved no version, after which `npm ci` passed.
 *
 * So after a command that wrote the lockfile, this runs that same command through `npx npm@<pin>`. It is idempotent:
 * a lockfile that is already complete comes back byte for byte. It is skipped when the workspace has no
 * `package-lock.json` (another package manager), and a failure only warns, since the workspace is usable without it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The process runner and the logger; the real ones by default.
 * @returns True when the lockfile was changed.
 * @throws Never - a failing npm is a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function completeLockfile (workspaceRoot: string, dependencies?: CompleteLockfileDependencies): boolean {
  const { capture, log } = dependencies ?? { capture: runCapture, log: logger }
  const lockfile = join(workspaceRoot, 'package-lock.json')
  if (!fileExists(lockfile)) {
    return false
  }
  const before = readOrEmpty(lockfile)
  const result = capture(
    'npx',
    ['--yes', `npm@${NPM_VERSION}`, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    workspaceRoot,
  )
  if (result.status !== 0) {
    log.warn(`could not have npm ${NPM_VERSION} complete package-lock.json; if CI's npm ci reports "Missing ... from lock file", run: npx npm@${NPM_VERSION} install --package-lock-only`)

    return false
  }
  const changed = readOrEmpty(lockfile) !== before
  if (changed) {
    log.detail(`package-lock.json completed by npm ${NPM_VERSION}, the version CI installs, so its npm ci accepts it`)
  }

  return changed
}
