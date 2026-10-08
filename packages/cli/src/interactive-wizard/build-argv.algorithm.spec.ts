import type { CommandDescription, OptionDescription } from '../command-catalog'
import { buildArgv, formatCommandLine } from './build-argv.algorithm'

/** An option with sensible defaults. */
function option (name: string, change: Partial<OptionDescription> = {}): OptionDescription {
  return { name, flags: `--${name}`, description: '', takesValue: 'none', variadic: false, repeatable: false, negated: false, ...change }
}

const command: CommandDescription = {
  name:        'adopt',
  aliases:     [],
  group:       'workspace',
  description: '',
  arguments:   [],
  options:     [option('tags'), option('nx', { takesValue: 'required' }), option('kind', { takesValue: 'required', repeatable: true }), option('no-cache', { negated: true })],
}

describe('buildArgv', () => {
  it('writes a switch as its flag, a value as flag and value, and a repeatable once per value', () => {
    expect(buildArgv(command, { arguments: [], options: { tags: true, nx: '23.3.0', kind: ['apps/a=node-app', 'libs/b=npm-lib'] } })).toEqual([
      'adopt', '--tags', '--nx', '23.3.0', '--kind', 'apps/a=node-app', '--kind', 'libs/b=npm-lib',
    ])
  })

  it('puts the positional arguments straight after the command and skips a switch answered no', () => {
    expect(buildArgv({ ...command, name: 'add' }, { arguments: ['npm-lib', 'core'], options: { tags: false } })).toEqual(['add', 'npm-lib', 'core'])
  })

  it('writes a negated switch by its own name, which already carries the no-', () => {
    expect(buildArgv(command, { arguments: [], options: { 'no-cache': true } })).toEqual(['adopt', '--no-cache'])
  })

  it('refuses an option the command does not have, so a typo cannot drop a choice', () => {
    expect(() => buildArgv(command, { arguments: [], options: { missing: true } })).toThrow('has no option --missing')
  })
})

describe('formatCommandLine', () => {
  it('shows what would be typed, quoting an argument with a space', () => {
    expect(formatCommandLine(['new', 'my repo', '--yes'])).toBe('mnci new "my repo" --yes')
  })
})
