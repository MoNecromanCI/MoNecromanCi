import { describeCommands } from './command-catalog'
import { buildProgram } from './main'
import { PROJECT_KINDS, PROJECT_KIND_CATALOG } from './project-scaffolding'

// The prompts library ships ESM only, which Jest cannot load; nothing here prompts.
jest.mock('@inquirer/prompts', () => ({}))

/** The kinds in alphabetical order, for comparing sets. */
function sortedKinds (kinds: readonly string[]): string[] {
  return kinds.toSorted((a, b) => a.localeCompare(b))
}

/** Runs the real program and returns what it printed to stdout, parsed. */
async function runJson (...arguments_: string[]): Promise<unknown> {
  const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    await buildProgram('9.9.9').parseAsync(['node', 'mnci', ...arguments_])

    return JSON.parse(write.mock.calls.map(call => String(call[0])).join(''))
  } finally {
    write.mockRestore()
  }
}

describe('the CLI contract an editor builds its menu from', () => {
  const described = describeCommands(buildProgram('9.9.9'))

  it('describes every command, each with a description and a group', () => {
    expect(described.map(command => command.name)).toEqual(
      expect.arrayContaining(['new', 'add', 'upgrade', 'doctor', 'sync', 'up', 'install', 'ci', 'commands', 'kinds', 'projects', 'info']),
    )
    for (const command of described) {
      expect(command.description.length).toBeGreaterThan(10)
      expect(command.group).toBeDefined()
    }
  })

  it('has a description for every option of every command', () => {
    for (const command of described) {
      for (const option of command.options) {
        expect({ command: command.name, option: option.name, described: option.description.length > 0 })
          .toEqual({ command: command.name, option: option.name, described: true })
      }
    }
  })

  it('has exactly one catalog entry per project kind `add` accepts', () => {
    expect(sortedKinds(PROJECT_KIND_CATALOG.map(entry => entry.kind))).toEqual(sortedKinds(PROJECT_KINDS))
  })

  it('names, for each kind, only flags that `add` really declares', () => {
    const add = described.find(command => command.name === 'add')
    const declared = new Set(add?.options.map(option => option.name))
    for (const entry of PROJECT_KIND_CATALOG) {
      for (const flag of entry.flags) {
        expect({ kind: entry.kind, flag, declared: declared.has(flag) }).toEqual({ kind: entry.kind, flag, declared: true })
      }
    }
  })

  it('requires, of each kind, only flags that it also offers', () => {
    for (const entry of PROJECT_KIND_CATALOG) {
      for (const flag of entry.requiredFlags) {
        expect({ kind: entry.kind, flag, offered: entry.flags.includes(flag) }).toEqual({ kind: entry.kind, flag, offered: true })
      }
    }
  })

  it('takes a project with -w in front of the package, as the CLI documents it, and with the flag repeated', () => {
    const install = buildProgram('9.9.9').commands.find(command => command.name() === 'install')
    const front = install?.parseOptions(['-w', 'web', 'zod'])
    const repeated = buildProgram('9.9.9').commands.find(command => command.name() === 'install')?.parseOptions(['zod', '-w', 'web', '-w', 'api'])

    expect(front?.operands).toEqual(['zod'])
    expect(install?.opts().workspace).toEqual(['web'])
    expect(repeated?.operands).toEqual(['zod'])
  })

  it('rejects a framework the CLI does not know, before anything is generated', () => {
    const add = buildProgram('9.9.9').commands.find(command => command.name() === 'add')

    expect(() => add?.exitOverride().configureOutput({ writeErr: () => {} }).parse(['node', 'add', 'node-app', 'x', '--framework', 'rails'])).toThrow(/rails|framework/i)
  })

  it('offers each add-only flag to at least one kind, so none is unreachable from a picker', () => {
    const add = described.find(command => command.name === 'add')
    const offered = new Set(PROJECT_KIND_CATALOG.flatMap(entry => entry.flags))
    const commandOptions = add?.options ?? []
    for (const option of commandOptions) {
      expect({ flag: option.name, offered: offered.has(option.name) }).toEqual({ flag: option.name, offered: true })
    }
  })

  it('prints the commands as one JSON document through `mnci commands --json`', async () => {
    const printed = await runJson('commands', '--json') as Array<{ name: string }>

    expect(printed.map(command => command.name)).toEqual(described.map(command => command.name))
  })

  it('prints the kinds as one JSON document through `mnci kinds --json`', async () => {
    const printed = await runJson('kinds', '--json') as Array<{ kind: string }>

    expect(printed.map(entry => entry.kind)).toEqual(PROJECT_KIND_CATALOG.map(entry => entry.kind))
  })
})
