import { buildArguments } from './build-arguments.algorithm'

describe('buildArguments', () => {
  it('starts with the command and lists the positionals in order', () => {
    expect(buildArguments('add', ['react-app', 'web'], [])).toEqual(['add', 'react-app', 'web'])
  })

  it('drops a positional the user left blank', () => {
    expect(buildArguments('add', ['npm-lib', ''], [])).toEqual(['add', 'npm-lib'])
  })

  it('writes a switch as the bare flag and a value flag with its value', () => {
    expect(buildArguments('add', ['npm-lib', 'x'], [{ name: 'empty' }, { name: 'scope', value: '@demo' }])).toEqual([
      'add', 'npm-lib', 'x', '--empty', '--scope', '@demo',
    ])
  })

  it('writes a negated switch as it is named', () => {
    expect(buildArguments('up', [], [{ name: 'no-install' }])).toEqual(['up', '--no-install'])
  })

  it('puts every value of a variadic flag after it', () => {
    expect(buildArguments('install', ['zod'], [{ name: 'workspace', value: ['a', 'b'] }])).toEqual(['install', 'zod', '--workspace', 'a', 'b'])
  })

  it('writes a repeatable flag once per value, as the CLI takes it', () => {
    expect(buildArguments('install', ['zod'], [{ name: 'workspace', value: ['a', 'b'], repeat: true }])).toEqual(['install', 'zod', '--workspace', 'a', '--workspace', 'b'])
  })

  it('keeps options after the positionals, so a flag can never swallow a package name', () => {
    const argumentsList = buildArguments('install', ['zod', 'dayjs'], [{ name: 'workspace', value: ['web'] }])

    expect(argumentsList.indexOf('--workspace')).toBeGreaterThan(argumentsList.indexOf('dayjs'))
  })
})
