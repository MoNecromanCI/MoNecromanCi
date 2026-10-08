// askCommand reads the kind catalog through the project-scaffolding barrel, which transitively loads
// @inquirer/prompts: ESM-only, and unparseable by jest as CJS. Nothing here exercises a prompt.
jest.mock('@inquirer/prompts', () => ({}))

import type { CommandDescription, OptionDescription } from '../command-catalog'
import { askCommand } from './ask-command.use-case'
import type { Prompter, PromptChoice } from './prompter.contract'

/** An option with sensible defaults. */
function option (name: string, change: Partial<OptionDescription> = {}): OptionDescription {
  return { name, flags: `--${name}`, description: `the ${name}`, takesValue: 'none', variadic: false, repeatable: false, negated: false, ...change }
}

/** A command with sensible defaults. */
function command (name: string, change: Partial<CommandDescription> = {}): CommandDescription {
  return { name, aliases: [], group: 'workspace', description: name, arguments: [], options: [], ...change }
}

/** A prompter that answers from a script and records what each question offered. */
function scripted (answers: (string | string[] | boolean)[]): { prompter: Prompter, offered: PromptChoice[][] } {
  const offered: PromptChoice[][] = []
  const next = (): string | string[] | boolean => answers.shift() as string | string[] | boolean

  return {
    offered,
    prompter: {
      select: async (_message, choices) => {
        offered.push([...choices])

        return next() as string
      },
      checkbox: async (_message, choices) => {
        offered.push([...choices])

        return next() as string[]
      },
      input:   async () => next() as string,
      confirm: async () => next() as boolean,
    },
  }
}

describe('askCommand', () => {
  it('asks a closed argument as a pick and an optional one as text, leaving an empty answer out', async () => {
    const add = command('add', { arguments: [{ name: 'kind', description: 'the kind', required: false, variadic: false, choices: ['npm-lib', 'react-app'] }, { name: 'name', description: 'the name', required: false, variadic: false }] })
    const { prompter, offered } = scripted(['npm-lib', '', []])

    const answers = await askCommand(add, prompter)

    expect(answers.arguments).toEqual(['npm-lib'])
    expect(offered[0].map(choice => choice.value)).toEqual(['', 'npm-lib', 'react-app'])
  })

  it('offers an add kind only its own flags, and every flag no kind claims', async () => {
    const add = command('add', {
      arguments: [{ name: 'kind', description: 'the kind', required: true, variadic: false, choices: ['npm-lib', 'go-app'] }],
      options:   [option('scope', { takesValue: 'required' }), option('empty'), option('cgo'), option('unclaimed-by-any-kind')],
    })
    const { prompter, offered } = scripted(['npm-lib', []])

    await askCommand(add, prompter)

    expect(offered[1].map(choice => choice.value)).toEqual(['scope', 'empty', 'unclaimed-by-any-kind'])
  })

  it('sets the switch of the chosen adopt step and offers that step\'s own options', async () => {
    const adopt = command('adopt', { options: [option('toolchain'), option('nx', { takesValue: 'required' }), option('tags'), option('json')] })
    const { prompter, offered } = scripted(['toolchain', ['nx'], '23.3.0'])

    const answers = await askCommand(adopt, prompter)

    expect(answers.options).toEqual({ toolchain: true, nx: '23.3.0' })
    expect(offered[1].map(choice => choice.value)).toEqual(['nx', 'json'])
  })

  it('asks every value of a repeatable option until an empty answer', async () => {
    const adopt = command('adopt', { options: [option('kinds'), option('kind', { takesValue: 'required', repeatable: true })] })
    const { prompter } = scripted(['kinds', ['kind'], 'apps/a=node-app', 'libs/b=npm-lib', ''])

    const answers = await askCommand(adopt, prompter)

    expect(answers.options).toEqual({ kinds: true, kind: ['apps/a=node-app', 'libs/b=npm-lib'] })
  })

  it('picks a value from the choices an option allows', async () => {
    const choosy = command('x', { options: [option('registry', { takesValue: 'required', choices: ['npm', 'azure-artifacts'] })] })
    const { prompter } = scripted([['registry'], 'azure-artifacts'])

    const answers = await askCommand(choosy, prompter)

    expect(answers.options).toEqual({ registry: 'azure-artifacts' })
  })

  it('asks nothing about options when the command has none', async () => {
    const { prompter, offered } = scripted([])

    expect(await askCommand(command('doctor'), prompter)).toEqual({ arguments: [], options: {} })
    expect(offered).toEqual([])
  })
})
