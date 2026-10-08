// The real prompter imports @inquirer/prompts, which ships ESM only and which Jest cannot load.
// These specs answer through the Prompter interface, so nothing here prompts.
jest.mock('@inquirer/prompts', () => ({}))

import { Command } from 'commander'
import { describeCommands, type CommandDescription } from '../command-catalog'
import { fileExists } from '../file-system'
import { runInteractive, wizardMenu } from './interactive-wizard.use-case'
import type { Prompter } from './prompter.contract'

jest.mock('../file-system', () => ({ fileExists: jest.fn() }))
jest.mock('../terminal', () => ({ logger: { info: jest.fn() } }))

const mockFileExists = jest.mocked(fileExists)

/** A small program with the commands the wizard's own behaviour needs. */
function program (): { program: Command, ran: string[][] } {
  const ran: string[][] = []
  const root = new Command().exitOverride()
  root.command('new').description('Create a new monorepo. More text.').argument('[name]', 'workspace name').option('--yes', 'accept defaults').action(() => undefined)
  root.command('doctor').description('Check this workspace').option('--json', 'print json').action(() => undefined)
  root.command('adopt').description('Read an existing repository').option('--tags', 'baseline tags').option('--json', 'print json').action(() => undefined)
  jest.spyOn(root, 'parseAsync').mockImplementation(async (argv) => {
    ran.push([...argv ?? []])

    return root
  })

  return { program: root, ran }
}

/** A prompter that answers from a script, in order. */
function scripted (answers: (string | string[] | boolean)[]): Prompter {
  const next = (): string | string[] | boolean => answers.shift() as string | string[] | boolean

  return {
    select:   async () => next() as string,
    checkbox: async () => next() as string[],
    input:    async () => next() as string,
    confirm:  async () => next() as boolean,
  }
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('wizardMenu', () => {
  const commands = describeCommands(program().program)

  it('lists every command, under sections, with adopt under Workspace', () => {
    const menu = wizardMenu(commands, false)

    expect(menu.map(choice => choice.value).toSorted((a, b) => a.localeCompare(b))).toEqual(['adopt', 'doctor', 'new'])
    expect(menu.find(choice => choice.value === 'adopt')?.group).toBe('Workspace')
  })

  it('opens with Projects inside a workspace, and with Workspace outside one', () => {
    const described = [
      { name: 'new', group: 'workspace', description: 'Create a new monorepo' },
      { name: 'add', group: 'projects', description: 'Add a project' },
    ] as CommandDescription[]

    expect(wizardMenu(described, true)[0].group).toBe('Projects')
    expect(wizardMenu(described, false)[0].group).toBe('Workspace')
  })

  it('shows only the first sentence of a description', () => {
    const entry = wizardMenu(commands, false).find(choice => choice.value === 'new')

    expect(entry?.name).toContain('Create a new monorepo')
    expect(entry?.name).not.toContain('More text')
  })
})

describe('runInteractive', () => {
  it('asks the arguments and options of the chosen command, shows the line, and runs it through the program', async () => {
    mockFileExists.mockReturnValue(false)
    const { program: root, ran } = program()

    await runInteractive(root, scripted(['new', 'my-repo', ['yes'], true]), '/nowhere')

    expect(ran).toEqual([['new', 'my-repo', '--yes']])
  })

  it('asks which adopt step, sets its switch, and offers only that step\'s own options', async () => {
    mockFileExists.mockReturnValue(true)
    const { program: root, ran } = program()

    await runInteractive(root, scripted(['adopt', 'tags', [], true]), '/repo')

    expect(ran).toEqual([['adopt', '--tags']])
  })

  it('runs nothing when the person declines the final question', async () => {
    mockFileExists.mockReturnValue(false)
    const { program: root, ran } = program()

    await runInteractive(root, scripted(['doctor', [], false]), '/nowhere')

    expect(ran).toEqual([])
  })
})
