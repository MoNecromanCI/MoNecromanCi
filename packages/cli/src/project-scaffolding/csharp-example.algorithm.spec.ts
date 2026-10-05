import { csharpConsoleProgram, csharpExampleFiles } from './csharp-example.algorithm'

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
