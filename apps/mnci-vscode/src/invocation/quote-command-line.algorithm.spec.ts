import { buildCommandLine, quoteArgument } from './quote-command-line.algorithm'

describe('quoteArgument', () => {
  it.each(['web', '@demo/ui', '--scope', String.raw`C:\Users\me\bin\mnci.cmd`, 'a=b', '1.2.3'])('passes %s through unchanged', value => {
    expect(quoteArgument(value)).toBe(value)
  })

  it('wraps a value with whitespace in double quotes', () => {
    expect(quoteArgument(String.raw`C:\Program Files\mnci.cmd`)).toBe(String.raw`"C:\Program Files\mnci.cmd"`)
  })

  it.each(['a;b', 'a&b', 'a|b', '$(x)', '`x`', 'a"b', "a'b", 'a>b', 'a\nb', '*', 'a(b)'])('refuses %j rather than guess how this shell escapes it', value => {
    expect(() => quoteArgument(value)).toThrow(/cannot be passed to a terminal safely/)
  })
})

describe('buildCommandLine', () => {
  it('joins the command and its arguments with spaces', () => {
    expect(buildCommandLine('mnci', ['add', 'npm-lib', 'x'])).toBe('mnci add npm-lib x')
  })

  it('keeps an npx prefix as ordinary arguments', () => {
    expect(buildCommandLine('npx', ['--yes', '@mnci/cli', 'doctor'])).toBe('npx --yes @mnci/cli doctor')
  })

  it('adds the call operator for a quoted command in PowerShell, which cannot run it otherwise', () => {
    expect(buildCommandLine(String.raw`C:\Program Files\mnci.cmd`, ['doctor'], String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)).toBe(String.raw`& "C:\Program Files\mnci.cmd" doctor`)
  })

  it('does not add it for bash, or when the command needed no quotes', () => {
    expect(buildCommandLine(String.raw`C:\Program Files\mnci.cmd`, ['doctor'], '/bin/bash')).toBe(String.raw`"C:\Program Files\mnci.cmd" doctor`)
    expect(buildCommandLine('mnci', ['doctor'], 'pwsh')).toBe('mnci doctor')
  })

  it('refuses an argument with a shell metacharacter', () => {
    expect(() => buildCommandLine('mnci', ['add', 'x; rm -rf /'])).toThrow(/safely/)
  })
})
