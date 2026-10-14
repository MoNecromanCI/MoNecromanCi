import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists } from '../file-system'
import { runCapture } from '../nx-workspace'
import { logger } from '../terminal'
import { NPM_VERSION } from '../workspace-overlay'
import type { CompleteLockfileDependencies } from './complete-lockfile.use-case'

/** The packages whose version an upgrade's own output depends on. */
const MNCI_PACKAGES = ['@mnci/cli', '@mnci/eslint-config']

/**
 * Which of mnci's packages the workspace's manifest declares.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The declared names, in a fixed order.
 * @throws Never - an unreadable or invalid manifest declares none.
 * @typeParam None - this function has no generic type parameters.
 */
function declaredMnciPackages (workspaceRoot: string): string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as {
      dependencies?:    Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = { ...manifest.dependencies, ...manifest.devDependencies }

    return MNCI_PACKAGES.filter(name => declared[name] !== undefined)
  } catch {
    return []
  }
}

/**
 * Moves the locked `@mnci/cli` and `@mnci/eslint-config` to the newest version their range allows.
 *
 * @remarks
 * Both are declared as a range across the major (`>=4.0.0 <5.0.0`), so a lockfile that pins 4.44.0 satisfies it for ever:
 * `npm install` and `npm ci` keep it. An upgrade run through `npx @mnci/cli@latest` writes the NEW pipeline and scripts
 * (`mnci lint`, `mnci ci verify`), which the old locked CLI does not have, so CI failed on a command that did not exist
 * (found on LoreMaster, 4.44.0 locked while upgrading to 4.110.2). `npm update <names> --package-lock-only` by the pinned
 * npm moves exactly those two entries and installs nothing. Skipped when there is no `package-lock.json` or neither
 * package is declared, and a failure only warns with the command to run by hand.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param dependencies - The process runner and the logger; the real ones by default.
 * @returns True when the lockfile changed.
 * @throws Never - a failing npm is a warning.
 * @typeParam None - this function has no generic type parameters.
 */
export function updateMnciPackagesInLockfile (workspaceRoot: string, dependencies?: CompleteLockfileDependencies): boolean {
  const { capture, log } = dependencies ?? { capture: runCapture, log: logger }
  const lockfile = join(workspaceRoot, 'package-lock.json')
  const names = declaredMnciPackages(workspaceRoot)
  if (names.length === 0 || !fileExists(lockfile)) {
    return false
  }
  const before = readFileSync(lockfile, 'utf8')
  const result = capture(
    'npx',
    ['--yes', `npm@${NPM_VERSION}`, 'update', ...names, '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    workspaceRoot,
  )
  if (result.status !== 0) {
    log.warn(`could not move ${names.join(' and ')} in package-lock.json; CI would keep the locked versions. Run: npx npm@${NPM_VERSION} update ${names.join(' ')} --package-lock-only`)

    return false
  }
  const changed = readFileSync(lockfile, 'utf8') !== before
  if (changed) {
    log.detail(`package-lock.json now locks the newest ${names.join(' and ')} their range allows, which the upgraded scripts and pipeline call`)
  }

  return changed
}
