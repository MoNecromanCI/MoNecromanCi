import { Argument, Command, Option } from 'commander'
import { describeCommands } from './describe-commands.algorithm'

/** A small program with one command of every shape the catalog has to read. */
function sampleProgram (): Command {
  const program = new Command()
  program
    .command('add')
    .alias('a')
    .addArgument(new Argument('[kind]', 'project kind').choices(['x', 'y']))
    .argument('<name...>', 'names')
    .description('Add a thing')
    .option('-s, --scope <scope>', 'the scope')
    .option('--empty', 'no sample')
    .option('--no-install', 'skip the install')
    .addOption(new Option('--mode <mode>', 'a mode').choices(['fast', 'slow']).default('fast'))

  return program
}

describe('describeCommands', () => {
  it('reads name, aliases, description and group from the program', () => {
    const [add] = describeCommands(sampleProgram())

    expect(add).toMatchObject({ name: 'add', aliases: ['a'], description: 'Add a thing', group: 'projects' })
  })

  it('reads arguments with their choices, and whether each is required or variadic', () => {
    const [add] = describeCommands(sampleProgram())

    expect(add.arguments).toEqual([
      { name: 'kind', description: 'project kind', required: false, variadic: false, choices: ['x', 'y'] },
      { name: 'name', description: 'names', required: true, variadic: true, choices: undefined },
    ])
  })

  it('reads options: switches, value flags, negated switches, choices and defaults', () => {
    const [add] = describeCommands(sampleProgram())
    const byName = Object.fromEntries(add.options.map(option => [option.name, option]))

    expect(byName.scope).toMatchObject({ takesValue: 'required', short: '-s', negated: false })
    expect(byName.empty).toMatchObject({ takesValue: 'none', negated: false })
    expect(byName['no-install']).toMatchObject({ takesValue: 'none', negated: true })
    expect(byName.mode).toMatchObject({ choices: ['fast', 'slow'], defaultValue: 'fast' })
  })

  it('leaves the help command out', () => {
    const program = sampleProgram()
    program.command('help').description('x')

    expect(describeCommands(program).map(command => command.name)).toEqual(['add'])
  })

  it('refuses a command that has no group, so none can reach an editor ungrouped', () => {
    const program = new Command()
    program.command('mystery').description('?')

    expect(() => describeCommands(program)).toThrow(/mystery.*no group/)
  })

  it('produces something JSON can carry', () => {
    expect(() => JSON.stringify(describeCommands(sampleProgram()))).not.toThrow()
  })
})
