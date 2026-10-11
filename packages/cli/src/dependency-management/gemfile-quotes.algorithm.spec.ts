import { singleQuoteGemLines } from './gemfile-quotes.algorithm'

describe('singleQuoteGemLines', () => {
  it('single-quotes what bundle add wrote on a gem line', () => {
    expect(singleQuoteGemLines('gem "kit", "~> 0.1.0", path: "../../libs/kit"\n')).toBe("gem 'kit', '~> 0.1.0', path: '../../libs/kit'\n")
  })

  it('leaves other lines, and strings that need double quotes, alone', () => {
    const text = 'source "https://rubygems.org"\ngem "a", require: "#{x}"\ngem "it\'s"\n'

    expect(singleQuoteGemLines(text)).toBe('source "https://rubygems.org"\ngem \'a\', require: "#{x}"\ngem "it\'s"\n')
  })

  it('is the same text when there is nothing to change', () => {
    const text = "# frozen_string_literal: true\n\ngem 'rspec', '~> 3.13'\n"

    expect(singleQuoteGemLines(text)).toBe(text)
  })
})
