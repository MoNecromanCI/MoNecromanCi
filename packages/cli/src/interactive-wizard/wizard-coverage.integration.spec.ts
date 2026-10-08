import { describeCommands, type CommandDescription, type OptionDescription } from '../command-catalog'
import { buildProgram } from '../main'
import { PROJECT_KINDS } from '../project-scaffolding'
import { ADOPT_GLOBAL_OPTIONS, ADOPT_STEPS } from './adopt-steps.config'
import { applicableOptions } from './applicable-options.policy'
import { buildArgv } from './build-argv.algorithm'
import { wizardMenu } from './interactive-wizard.use-case'

// The prompts library ships ESM only, which Jest cannot load; nothing here prompts.
jest.mock('@inquirer/prompts', () => ({}))

/** A value that satisfies an option, for checking the program accepts the line the wizard builds. */
function plausibleValue (option: OptionDescription): boolean | string | string[] {
  if (option.takesValue === 'none') {
    return true
  }
  if (option.choices !== undefined) {
    return option.choices[0]
  }

  return option.repeatable ? ['a=b'] : 'x'
}

describe('the wizard reaches every command and option the program has', () => {
  const program = buildProgram('9.9.9')
  const commands = describeCommands(program)

  it('lists every command in its menu, so a new command cannot be unreachable', () => {
    const offered = wizardMenu(commands, true).map(choice => choice.value)

    expect(offered.toSorted((a, b) => a.localeCompare(b))).toEqual(commands.map(command => command.name).toSorted((a, b) => a.localeCompare(b)))
  })

  it('puts every adopt flag in exactly one step, or among the flags every step shares', () => {
    const adopt = commands.find(command => command.name === 'adopt') as CommandDescription
    const claimed = [...ADOPT_STEPS.flatMap(step => [...step.switch === undefined ? [] : [step.switch], ...step.options]), ...ADOPT_GLOBAL_OPTIONS]

    for (const option of adopt.options) {
      expect(claimed.filter(name => name === option.name)).toHaveLength(1)
    }
    for (const name of claimed) {
      expect(adopt.options.map(option => option.name)).toContain(name)
    }
  })

  it('offers every add flag for some kind, or for all of them', () => {
    const add = commands.find(command => command.name === 'add') as CommandDescription
    const reachable = new Set(PROJECT_KINDS.flatMap(kind => applicableOptions(add, { kind }).map(option => option.name)))

    for (const option of add.options) {
      expect(reachable).toContain(option.name)
    }
  })

  it('builds, for every option of every command, a line the program itself accepts', () => {
    for (const command of commands) {
      const real = program.commands.find(candidate => candidate.name() === command.name)

      for (const option of command.options) {
        const argv = buildArgv(command, { arguments: [], options: { [option.name]: plausibleValue(option) } })
        const parsed = real?.parseOptions(argv.slice(1))

        expect({ command: command.name, option: option.name, unknown: parsed?.unknown }).toEqual({ command: command.name, option: option.name, unknown: [] })
      }
    }
  })
})
