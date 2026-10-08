import { runCapture } from '../nx-workspace'

/**
 * Refuses a directory that is not a clean git work tree.
 *
 * @remarks
 * Every adoption step that changes files is one diff to review or discard, which only holds when it starts
 * from a committed state. Used by each such step, so the refusal reads the same everywhere.
 *
 * @param repositoryRoot - Absolute path to the repository.
 * @param capture - Runs a command and returns what it printed; the real one by default.
 * @returns Nothing.
 * @throws Error when the directory is not inside a git work tree, or has uncommitted changes.
 * @typeParam None - this function has no generic type parameters.
 */
export function requireCleanWorkingTree (repositoryRoot: string, capture: (command: string, arguments_: string[], cwd: string) => { status: number, stdout: string } = runCapture): void {
  if (capture('git', ['rev-parse', '--is-inside-work-tree'], repositoryRoot).status !== 0) {
    throw new Error('This directory is not a git repository. Every adoption step is one diff to review, so it needs git.')
  }
  if (capture('git', ['status', '--porcelain'], repositoryRoot).stdout.trim() !== '') {
    throw new Error('The working tree has uncommitted changes. Commit or stash them, so this step is one diff you can review or discard.')
  }
}
