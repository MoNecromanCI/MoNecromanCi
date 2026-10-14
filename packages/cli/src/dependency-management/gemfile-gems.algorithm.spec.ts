import { gemfileGems, newestGemVersion, replaceGemSpec } from './gemfile-gems.algorithm'

const GEMFILE = `source 'https://rubygems.org'

gem 'rack', '~> 3.1'
gem "sinatra", ">= 4.0"
gem 'kit', path: '../kit'
gem 'bare'
gem 'ranged', '>= 1.0', '< 3'

group :test do
  gem 'rspec', '~> 3.13'
end

gem 'rubocop', '~> 1.92', group: :development
`

describe('gemfileGems', () => {
  it('reads the gems that carry a constraint, with their group', () => {
    const read = gemfileGems(GEMFILE).map(entry => `${entry.section}:${entry.name}:${entry.spec}`)

    expect(read).toEqual([
      'dep:rack:~>3.1',
      'dep:sinatra:>=4.0',
      'dep:ranged:>=1.0',
      'devDep:rspec:~>3.13',
      'devDep:rubocop:~>1.92',
    ])
  })

  it('does not rewrite a gem with two constraints', () => {
    const byName = Object.fromEntries(gemfileGems(GEMFILE).map(entry => [entry.name, entry.rewritable]))

    expect(byName.ranged).toBe(false)
    expect(byName.rack).toBe(true)
  })

  it('does not rewrite a gem with a path source', () => {
    expect(gemfileGems("gem 'kit', '~> 0.1', path: '../kit'\n")[0]?.rewritable).toBe(false)
  })
})

describe('replaceGemSpec', () => {
  it('writes the operator the Ruby way and keeps the quotes of the line', () => {
    const after = replaceGemSpec(GEMFILE, 'sinatra', '>=5.0.0')

    expect(after).toBe(GEMFILE.replace('">= 4.0"', '">= 5.0.0"'))
  })

  it('moves a pessimistic constraint', () => {
    expect(replaceGemSpec(GEMFILE, 'rack', '~>4.0.0')).toContain("gem 'rack', '~> 4.0.0'")
  })

  it('leaves the text alone for a gem with no constraint', () => {
    expect(replaceGemSpec(GEMFILE, 'bare', '~>1.0.0')).toBe(GEMFILE)
  })
})

describe('newestGemVersion', () => {
  it('reads the version of the exact gem, platform builds included', () => {
    expect(newestGemVersion('nokogiri (1.18.3 ruby)\n', 'nokogiri')).toBe('1.18.3')
    expect(newestGemVersion('rack-test (2.1.0)\nrack (3.1.8)\n', 'rack')).toBe('3.1.8')
  })

  it('answers nothing for a gem the output does not list', () => {
    expect(newestGemVersion('', 'rack')).toBeUndefined()
  })
})
