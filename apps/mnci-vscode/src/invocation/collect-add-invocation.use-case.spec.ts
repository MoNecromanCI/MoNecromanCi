import type { CommandDescription, ProjectKindDescription } from '../cli-contracts'
import { collectAddInvocation, kindEntries } from './collect-add-invocation.use-case'
import { scriptedPrompter } from './testing/scripted-prompter.mock'

const KINDS: ProjectKindDescription[] = [
  { kind: 'go-app', language: 'go', label: 'Go app', description: 'A Go executable', flags: ['release'] },
  { kind: 'npm-lib', language: 'typescript', label: 'npm library', description: 'A published library', flags: ['scope', 'empty'] },
  { kind: 'python-vendor', language: 'python', label: 'Vendor a Python library', description: 'Copy a lib', flags: ['lib'], requiredFlags: ['lib'] },
]

const ADD: CommandDescription = {
  name:        'add',
  aliases:     [],
  group:       'projects',
  description: 'Add a project',
  arguments:   [],
  options:     [
    { name: 'scope', flags: '--scope <scope>', description: 'npm scope', takesValue: 'required', variadic: false, negated: false },
    { name: 'empty', flags: '--empty', description: 'no sample', takesValue: 'none', variadic: false, negated: false },
    { name: 'release', flags: '--release', description: 'release the app', takesValue: 'none', variadic: false, negated: false },
    { name: 'lib', flags: '--lib <name>', description: 'the library', takesValue: 'required', variadic: false, negated: false },
  ],
}

describe('kindEntries', () => {
  it('puts a heading before each language that has kinds, in a fixed order', () => {
    const entries = kindEntries(KINDS)

    expect(entries.map(entry => ('separator' in entry ? `# ${entry.separator}` : entry.value))).toEqual([
      '# TypeScript / JavaScript', 'npm-lib', '# Python', 'python-vendor', '# Go', 'go-app',
    ])
  })

  it('shows the label, the kind id and the description of each kind', () => {
    expect(kindEntries(KINDS)[1]).toEqual({ label: 'npm library', description: 'npm-lib', detail: 'A published library', value: 'npm-lib' })
  })
})

describe('collectAddInvocation', () => {
  it('asks the kind, the name, and offers only the flags that apply to that kind', async () => {
    const { prompter, entriesSeen } = scriptedPrompter(['npm-lib', 'ui', ['scope'], '@demo'])

    const result = await collectAddInvocation(ADD, KINDS, prompter)

    expect(result?.arguments).toEqual(['add', 'npm-lib', 'ui', '--scope', '@demo'])
    // The option list held scope and empty only: release and lib belong to other kinds.
    expect((entriesSeen[1] as Array<{ value: string }>).map(entry => entry.value)).toEqual(['scope', 'empty'])
  })

  it('asks a required flag without offering it, so the kind cannot be added without it', async () => {
    const { prompter, asked } = scriptedPrompter(['python-vendor', 'api', 'core'])

    const result = await collectAddInvocation(ADD, KINDS, prompter)

    expect(result?.arguments).toEqual(['add', 'python-vendor', 'api', '--lib', 'core'])
    expect(asked[1]).toMatch(/app that should vendor/)
    expect(asked).toHaveLength(3)
  })

  it('skips the option list when the kind has no optional flag', async () => {
    const { prompter, asked } = scriptedPrompter(['go-app', 'svc', []])

    const result = await collectAddInvocation(ADD, KINDS, prompter)

    expect(result?.arguments).toEqual(['add', 'go-app', 'svc'])
    expect(asked).toHaveLength(3)
  })

  it.each([
    ['the kind', [undefined]],
    ['the name', ['npm-lib', undefined]],
    ['the options', ['npm-lib', 'ui', undefined]],
  ])('does nothing when the user cancels %s', async (_step, answers) => {
    expect(await collectAddInvocation(ADD, KINDS, scriptedPrompter(answers).prompter)).toBeUndefined()
  })
})
