import { rubyEmptyFiles, rubyExampleFiles, rubyGemspec, rubyModule, rubySnake } from './ruby-example.algorithm'

describe('rubySnake and rubyModule', () => {
  it('spell a project name the way Ruby requires and names it', () => {
    expect(rubySnake('my-tool')).toBe('my_tool')
    expect(rubyModule('my-tool')).toBe('MyTool')
    expect(rubySnake('3d-kit')).toBe('_3d_kit')
    expect(rubyModule('3d-kit')).toBe('M3dKit')
  })
})

describe('rubyGemspec', () => {
  it('reads the version from lib/<snake>/version.rb and asks for MFA', () => {
    const gemspec = rubyGemspec('my-kit')

    expect(gemspec).toContain("require_relative 'lib/my_kit/version'")
    expect(gemspec).toContain('spec.version = MyKit::VERSION')
    expect(gemspec).toContain("spec.name = 'my-kit'")
    expect(gemspec).toContain("rubygems_mfa_required'] = 'true'")
  })
})

describe('the worked example', () => {
  it('uses snake_case files, one constant each, behind a barrel the spec helper requires', () => {
    const files = rubyExampleFiles('ruby-lib', 'my-kit')

    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'lib/my_kit.rb',
      'lib/my_kit/version.rb',
      'lib/my_kit/greeting/greeting_contract.rb',
      'lib/my_kit/greeting/greet_use_case.rb',
      'spec/spec_helper.rb',
      'spec/greeting/greet_use_case_spec.rb',
    ]))
    expect(files['lib/my_kit.rb']).toContain("require_relative 'my_kit/greeting/greet_use_case'")
    expect(files['spec/spec_helper.rb']).toContain("require 'my_kit'")
    expect(files['lib/my_kit/greeting/greet_use_case.rb']).toContain('module MyKit')
  })

  it('an app has a bin script and no version file', () => {
    const files = rubyExampleFiles('ruby-app', 'hello')

    expect(files['bin/hello']).toContain("require_relative '../lib/hello'")
    expect(files['lib/hello/version.rb']).toBeUndefined()
    expect(files['lib/hello.rb']).not.toContain('version')
  })

  it('a bare project keeps a smoke spec and the barrel', () => {
    expect(Object.keys(rubyEmptyFiles('ruby-lib', 'kit'))).toEqual(
      expect.arrayContaining(['lib/kit.rb', 'lib/kit/version.rb', 'spec/smoke_spec.rb']),
    )
  })
})
