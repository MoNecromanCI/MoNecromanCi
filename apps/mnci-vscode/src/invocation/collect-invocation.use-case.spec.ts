import type { CommandDescription } from '../cli-contracts'
import { collectInvocation, words } from './collect-invocation.use-case'
import { scriptedPrompter } from './testing/scripted-prompter.mock'

/** A command description with just what a test needs. */
function command (overrides: Partial<CommandDescription>): CommandDescription {
  return { name: 'x', aliases: [], group: 'workspace', description: 'd', arguments: [], options: [], ...overrides }
}

describe('words', () => {
  it('splits on any whitespace and drops empties', () => {
    expect(words('  zod   dayjs\t@types/node ')).toEqual(['zod', 'dayjs', '@types/node'])
  })
})

describe('collectInvocation', () => {
  it('runs a command with nothing to ask straight away', async () => {
    const { prompter, asked } = scriptedPrompter([])

    expect(await collectInvocation(command({ name: 'doctor' }), prompter)).toEqual({ arguments: ['doctor'], cwd: undefined })
    expect(asked).toEqual([])
  })

  it('offers an argument the CLI named the choices of as a pick list', async () => {
    const ci = command({ name: 'ci', arguments: [{ name: 'phase', description: 'which phase', required: true, variadic: false, choices: ['verify', 'pack'] }] })
    const { prompter, entriesSeen } = scriptedPrompter(['pack'])

    expect(await collectInvocation(ci, prompter)).toEqual({ arguments: ['ci', 'pack'], cwd: undefined })
    expect(entriesSeen[0]).toEqual([{ label: 'verify', value: 'verify' }, { label: 'pack', value: 'pack' }])
  })

  it('lets an optional choice be skipped', async () => {
    const add = command({ name: 'add', arguments: [{ name: 'kind', description: 'k', required: false, variadic: false, choices: ['a'] }] })
    const { prompter } = scriptedPrompter([''])

    const result = await collectInvocation(add, prompter)

    expect(result?.arguments).toEqual(['add'])
  })

  it('asks the options in a list, then each chosen one for its value', async () => {
    const sync = command({
      name:    'sync',
      options: [
        { name: 'check', flags: '--check', description: 'report only', takesValue: 'none', variadic: false, negated: false },
        { name: 'ecosystem', flags: '--ecosystem <name>', description: 'one ecosystem', takesValue: 'required', variadic: false, negated: false, choices: ['npm', 'pip'] },
      ],
    })
    const { prompter } = scriptedPrompter([['check', 'ecosystem'], 'pip'])

    const result = await collectInvocation(sync, prompter)

    expect(result?.arguments).toEqual(['sync', '--check', '--ecosystem', 'pip'])
  })

  it('asks several values for a repeatable option and writes the flag once per value', async () => {
    const install = command({
      name:    'install',
      options: [{ name: 'workspace', flags: '-w, --workspace <project>', description: 'target', takesValue: 'required', variadic: false, repeatable: true, negated: false }],
    })
    const { prompter } = scriptedPrompter([['workspace'], 'web api'])

    const result = await collectInvocation(install, prompter)

    expect(result?.arguments).toEqual(['install', '--workspace', 'web', '--workspace', 'api'])
  })

  it('stops, running nothing, when the user cancels any question', async () => {
    const add = command({ name: 'add', arguments: [{ name: 'name', description: 'n', required: true, variadic: false }] })

    expect(await collectInvocation(add, scriptedPrompter([undefined]).prompter)).toBeUndefined()
  })

  it('stops when the user cancels the option list', async () => {
    const up = command({ name: 'up', options: [{ name: 'yes', flags: '-y, --yes', description: 'all', takesValue: 'none', variadic: false, negated: false }] })

    expect(await collectInvocation(up, scriptedPrompter([undefined]).prompter)).toBeUndefined()
  })

  it('asks `new` where to create the workspace and runs it there', async () => {
    const created = command({ name: 'new', arguments: [{ name: 'name', description: 'workspace name', required: false, variadic: false }] })
    const { prompter } = scriptedPrompter(['demo', 'C:/dev'])

    expect(await collectInvocation(created, prompter)).toEqual({ arguments: ['new', 'demo'], cwd: 'C:/dev' })
  })

  it('does not create a workspace when the folder dialog is cancelled', async () => {
    const created = command({ name: 'new', arguments: [{ name: 'name', description: 'n', required: false, variadic: false }] })

    expect(await collectInvocation(created, scriptedPrompter(['demo', undefined]).prompter)).toBeUndefined()
  })
})
