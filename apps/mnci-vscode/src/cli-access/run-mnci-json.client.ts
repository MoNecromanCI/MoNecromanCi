import spawn from 'cross-spawn'
import type { CliLocation } from './cli-location.contract'

/**
 * What a `--json` invocation of the CLI returned.
 *
 * @remarks
 * `exitCode` is kept because `doctor --json` exits non-zero when a check failed and still
 * prints its whole report: a non-zero exit with a document is an answer, not an error.
 * @typeParam T - The shape of the parsed document.
 */
export interface CliJsonResult<T> {
  readonly value:    T
  readonly exitCode: number
}

/** Long enough for `doctor`, which runs `nx sync:check`. */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Runs the mnci CLI with `--json` and parses the one document it prints.
 *
 * @remarks
 * Resolves with the parsed document whenever stdout holds one, whatever the exit code.
 * Rejects when stdout is not JSON (the CLI failed before it could answer), carrying stderr
 * and stdout so the message says why.
 *
 * @param location - Which CLI to start.
 * @param arguments_ - The mnci arguments, including `--json`.
 * @param cwd - The directory to run in (the workspace root).
 * @param timeoutMs - How long to wait before killing it.
 * @returns The parsed document and the exit code.
 * @throws Error when the process cannot start, times out, or prints no JSON.
 * @typeParam T - The shape the caller expects; it is not checked here.
 */
export function runMnciJson<T> (
  location: CliLocation,
  arguments_: readonly string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CliJsonResult<T>> {
  return new Promise((resolve, reject) => {
    const child = spawn(location.command, [...location.prefix, ...arguments_], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env:   { ...process.env, NO_COLOR: '1' },
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', error => {
      clearTimeout(timer)
      reject(new Error(`Could not start ${location.command}: ${error.message}`))
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`mnci ${arguments_.join(' ')} did not answer within ${Math.round(timeoutMs / 1000)}s`))

        return
      }
      try {
        resolve({ value: JSON.parse(stdout) as T, exitCode: code ?? 1 })
      } catch {
        const output = (stderr.trim() || stdout.trim()).slice(0, 800)
        reject(new Error(`mnci ${arguments_.join(' ')} failed (exit ${code ?? 'none'})${output ? `: ${output}` : ''}`))
      }
    })
  })
}
