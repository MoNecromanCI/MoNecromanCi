import type { CliLocation } from './cli-location.contract'
import { runMnciJson } from './run-mnci-json.client'

/** A "CLI" that is node running a script: the mnci arguments are appended and ignored by `-e`. */
function nodeScript (script: string): CliLocation {
  return { command: process.execPath, prefix: ['-e', script], source: 'setting' }
}

describe('runMnciJson', () => {
  // The shared preset installs fake timers; this runs real child processes and a real kill timer.
  beforeAll(() => {
    jest.useRealTimers()
  })

  it('parses the one document the CLI prints', async () => {
    const result = await runMnciJson<{ a: number }>(nodeScript('console.log(JSON.stringify({ a: 1 }))'), ['kinds', '--json'], process.cwd())

    expect(result).toEqual({ value: { a: 1 }, exitCode: 0 })
  })

  it('returns the document even when the exit code is non-zero, as doctor does when a check fails', async () => {
    const result = await runMnciJson<{ failed: number }>(
      nodeScript('console.log(JSON.stringify({ failed: 2 })); process.exitCode = 1'),
      ['doctor', '--json'],
      process.cwd(),
    )

    expect(result).toEqual({ value: { failed: 2 }, exitCode: 1 })
  })

  it('rejects with the CLI\'s own message when it prints no JSON', async () => {
    await expect(
      runMnciJson(nodeScript("console.error('No nx.json found here.'); process.exitCode = 1"), ['projects', '--json'], process.cwd()),
    ).rejects.toThrow(/projects --json failed \(exit 1\): No nx\.json found here\./)
  })

  it('says the CLI is too old, and how to update it, when it rejects --json', async () => {
    const old = nodeScript("console.error(\"error: unknown option '--json'\"); process.exitCode = 1")

    await expect(runMnciJson(old, ['commands', '--json'], process.cwd())).rejects.toThrow(/older than 4\.32\.0.*npm install --global @mnci\/cli@latest/s)
  })

  it('does not blame the version for another failure', async () => {
    await expect(
      runMnciJson(nodeScript("console.error('No nx.json found here.'); process.exitCode = 1"), ['projects', '--json'], process.cwd()),
    ).rejects.not.toThrow(/older than/)
  })

  it('rejects when the command cannot be started', async () => {
    await expect(
      runMnciJson({ command: 'definitely-not-a-real-command-mnci', prefix: [], source: 'setting' }, ['info'], process.cwd()),
    ).rejects.toThrow(/Could not start/)
  })

  it('kills a CLI that does not answer in time', async () => {
    await expect(
      runMnciJson(nodeScript('setTimeout(() => {}, 30000)'), ['doctor', '--json'], process.cwd(), 300),
    ).rejects.toThrow(/did not answer within/)
  })

  it('runs in the directory it is given', async () => {
    const result = await runMnciJson<{ cwd: string }>(nodeScript('console.log(JSON.stringify({ cwd: process.cwd() }))'), [], process.cwd())

    expect(result.value.cwd.toLowerCase()).toBe(process.cwd().toLowerCase())
  })
})
