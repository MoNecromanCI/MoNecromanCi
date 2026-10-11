import {
  removeCargoWorkspaceMember,
  removeGoWorkUse,
  removeMavenModule,
  removePathAliases,
  removeProjectScripts,
  removePubspecWorkspaceMember,
} from './workspace-entries.algorithm'

describe('removeGoWorkUse', () => {
  const block = ['go 1.27', '', 'use (', '\t./apps/api', '\t./libs/util', ')', ''].join('\n')

  it('drops one module of a use block and keeps the others', () => {
    expect(removeGoWorkUse(block, 'apps/api')).toBe(['go 1.27', '', 'use (', '\t./libs/util', ')', ''].join('\n'))
  })

  it('drops a single-line use', () => {
    expect(removeGoWorkUse('go 1.27\n\nuse ./apps/api\n', 'apps/api')).toBe('go 1.27\n\n')
  })

  it('leaves the text alone for a module it does not list, and does not match a prefix', () => {
    expect(removeGoWorkUse(block, 'apps/ap')).toBe(block)
    expect(removeGoWorkUse(block, 'apps/other')).toBe(block)
  })
})

describe('removePubspecWorkspaceMember', () => {
  const pubspec = ['name: ws', 'workspace:', '  - apps/shop', '  - packages/ui', 'environment:', '  sdk: ^3.0.0', ''].join('\n')

  it('drops one item of the workspace list', () => {
    expect(removePubspecWorkspaceMember(pubspec, 'apps/shop')).toBe(['name: ws', 'workspace:', '  - packages/ui', 'environment:', '  sdk: ^3.0.0', ''].join('\n'))
  })

  it('only touches the workspace list', () => {
    const other = ['name: ws', 'dependencies:', '  - apps/shop', ''].join('\n')

    expect(removePubspecWorkspaceMember(other, 'apps/shop')).toBe(other)
  })
})

describe('removeCargoWorkspaceMember', () => {
  const cargo = ['[workspace]', 'resolver = "2"', 'members = [', "\t'apps/hello',", "\t'libs/kit',", ']', ''].join('\n')

  it('drops one member of a multi-line array', () => {
    expect(removeCargoWorkspaceMember(cargo, 'apps/hello')).toBe(['[workspace]', 'resolver = "2"', 'members = [', "\t'libs/kit',", ']', ''].join('\n'))
  })

  it('drops a member of a one-line array', () => {
    expect(removeCargoWorkspaceMember('members = ["apps/hello", "libs/kit"]\n', 'apps/hello')).toBe('members = ["libs/kit"]\n')
  })

  it('is unchanged for a crate it does not list', () => {
    expect(removeCargoWorkspaceMember(cargo, 'apps/none')).toBe(cargo)
  })
})

describe('removeProjectScripts', () => {
  it('removes every script of the project and nothing that merely shares a prefix', () => {
    const result = removeProjectScripts({ 'web:qa': 'a', 'web:build': 'b', 'web2:qa': 'c', 'web-e2e:qa': 'd', 'format': 'e' }, 'web')

    expect(result.removed).toEqual(['web:qa', 'web:build'])
    expect(result.scripts).toEqual({ 'web2:qa': 'c', 'web-e2e:qa': 'd', 'format': 'e' })
  })
})

describe('removePathAliases', () => {
  it('removes the aliases that point only into the project', () => {
    const result = removePathAliases({ '@org/kit': ['libs/kit/src/index.ts'], '@org/other': ['libs/other/src/index.ts'] }, 'libs/kit')

    expect(result.removed).toEqual(['@org/kit'])
    expect(result.paths).toEqual({ '@org/other': ['libs/other/src/index.ts'] })
  })

  it('does not match a sibling that shares a prefix', () => {
    expect(removePathAliases({ '@org/kit2': ['libs/kit2/src/index.ts'] }, 'libs/kit').removed).toEqual([])
  })
})

describe('removeMavenModule', () => {
  const pom = ['<modules>', '    <module>apps/hello</module>', '    <module>apps/hello2</module>', '  </modules>', ''].join('\n')

  it('drops the exact module line and keeps a module that merely starts with the same name', () => {
    expect(removeMavenModule(pom, 'apps/hello')).toBe(['<modules>', '    <module>apps/hello2</module>', '  </modules>', ''].join('\n'))
  })

  it('leaves a pom that does not list the module unchanged', () => {
    expect(removeMavenModule(pom, 'libs/kit')).toBe(pom)
  })
})
