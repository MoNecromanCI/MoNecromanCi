import { csharpConsoleProgram, csharpEmptyTest, csharpExampleFiles, csharpExampleTest } from './csharp-example.algorithm'

describe('csharpExampleFiles', () => {
  const files = csharpExampleFiles('Demo.Sdk')

  it('writes a contract and a use case, one type per file', () => {
    expect(Object.keys(files).toSorted((a, b) => a.localeCompare(b))).toEqual(['Greeting.cs', 'GreetUseCase.cs'])
    expect(files['Greeting.cs']).toContain('public sealed record Greeting(string Message);')
    expect(files['GreetUseCase.cs']).toContain('public static Greeting Greet(string name)')
  })

  it('puts both types in the project root namespace, so a consumer needs one using', () => {
    for (const contents of Object.values(files)) {
      expect(contents).toContain('namespace Demo.Sdk;')
    }
  })
})

describe('csharpConsoleProgram', () => {
  it('calls the use case through the root namespace', () => {
    const program = csharpConsoleProgram('Demo')
    expect(program).toContain('using Demo;')
    expect(program).toContain('GreetUseCase.Greet("world").Message')
  })
})

describe('csharpExampleTest', () => {
  it('tests the use case through the project root namespace, with xunit', () => {
    const test = csharpExampleTest('Demo.Sdk')
    expect(test).toContain('using Demo.Sdk;')
    expect(test).toContain('[Fact]')
    expect(test).toContain('Hello, world!')
  })
})

describe('csharpEmptyTest', () => {
  it('is one smoke test that names no example type', () => {
    expect(csharpEmptyTest()).toContain('[Fact]')
    expect(csharpEmptyTest()).not.toContain('GreetUseCase')
  })
})
