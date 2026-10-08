import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import spawn from 'cross-spawn'

/**
 * One project's start command, running.
 *
 * @remarks
 * `exited` resolves with the exit status once the process and its children are gone.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface RunningProject {
  /** Stops the project and everything it started. */
  stop:   () => void
  /** The exit status, once it has stopped. */
  exited: Promise<number>
}

/**
 * Starts `nx run <project>:<target>` and hands its output, a line at a time, to a listener.
 *
 * @remarks
 * The only place the dev command touches a process. A project's dev server starts children of its own (Nx, then
 * the server), so stopping one has to stop the tree: `taskkill /T` on Windows, and on other systems a signal to the
 * process group, which is why the child is started detached there.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param project - The project's name.
 * @param target - The Nx target to run.
 * @param onLine - Receives each line the project prints.
 * @returns The running project.
 * @throws Never - a process that cannot start exits with a status instead.
 * @typeParam None - this function has no generic type parameters.
 */
export function spawnProject (workspaceRoot: string, project: string, target: string, onLine: (line: string) => void): RunningProject {
  const windows = process.platform === 'win32'
  const child = spawn('npx', ['nx', 'run', `${project}:${target}`], { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows })
  for (const stream of [child.stdout, child.stderr]) {
    if (stream !== null) {
      createInterface({ input: stream }).on('line', onLine)
    }
  }
  const exited = new Promise<number>(resolve => {
    child.on('error', () => { resolve(1) })
    child.on('close', code => { resolve(code ?? 1) })
  })
  const stop = (): void => {
    if (child.pid === undefined || child.exitCode !== null) {
      return
    }
    if (windows) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    }
  }

  return { stop, exited }
}
