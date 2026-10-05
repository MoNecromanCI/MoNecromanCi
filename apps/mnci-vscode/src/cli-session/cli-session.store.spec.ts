import type { CliLocation } from '../cli-access'
import { CliSession, type CliSessionDependencies } from './cli-session.store'

const LOCATION: CliLocation = { command: 'mnci', prefix: [], source: 'path' }

/** A session whose CLI answers from a table, and which records what it was asked. */
function session (workspaceRoot: string | undefined, answers: Record<string, unknown> = {}): { subject: CliSession, calls: string[], locate: jest.Mock } {
  const calls: string[] = []
  const locate = jest.fn(() => LOCATION)
  const run = jest.fn((_location: CliLocation, arguments_: readonly string[], cwd: string) => {
    calls.push(`${arguments_.join(' ')} @ ${cwd}`)

    return Promise.resolve({ value: answers[arguments_[0]] ?? [], exitCode: 0 })
  }) as unknown as CliSessionDependencies['run']

  return { subject: new CliSession({ workspaceRoot, fallbackDirectory: '/home', locate, run }), calls, locate }
}

describe('CliSession', () => {
  it('asks the CLI once however many views ask at the same time', async () => {
    const { subject, calls } = session('/ws', { commands: [{ name: 'add' }] })

    const [first, second] = await Promise.all([subject.commands(), subject.commands()])

    expect(first).toBe(second)
    expect(calls).toEqual(['commands --json @ /ws'])
  })

  it('runs commands that need no workspace from the fallback directory', async () => {
    const { subject, calls } = session(undefined)

    await subject.kinds()
    await subject.info()

    expect(calls).toEqual(['kinds --json @ /home', 'info --json @ /home'])
  })

  it('has no projects, and does not ask, when no workspace is open', async () => {
    const { subject, calls } = session(undefined)

    expect(await subject.projects()).toEqual([])
    expect(calls).toEqual([])
  })

  it('refuses to run doctor without a workspace, with a message that says what to do', async () => {
    await expect(session(undefined).subject.doctor()).rejects.toThrow(/Open a folder/)
  })

  it('never caches doctor: a check must be current', async () => {
    const { subject, calls } = session('/ws', { doctor: { findings: [], passed: 0, failed: 0 } })

    await subject.doctor()
    await subject.doctor()

    expect(calls).toHaveLength(2)
  })

  it('locates the CLI once until a refresh', () => {
    const { subject, locate } = session('/ws')

    subject.location()
    subject.location()

    expect(locate).toHaveBeenCalledTimes(1)
  })

  it('forgets every answer on refresh, locates again, and tells the listeners', async () => {
    const { subject, calls, locate } = session('/ws')
    const listener = jest.fn()
    subject.onDidChange(listener)
    await subject.projects()

    subject.refresh()
    await subject.projects()

    expect(calls).toHaveLength(2)
    // Once for the first answer, once more because the refresh forgot where the CLI was.
    expect(locate).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying a listener that unsubscribed', () => {
    const { subject } = session('/ws')
    const listener = jest.fn()
    const unsubscribe = subject.onDidChange(listener)

    unsubscribe()
    subject.refresh()

    expect(listener).not.toHaveBeenCalled()
  })
})
