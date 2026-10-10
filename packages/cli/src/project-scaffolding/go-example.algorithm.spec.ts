import { goAppEmptyFiles, goAppExampleFiles, goLibraryExampleFiles } from './go-example.algorithm'

describe('goLibraryExampleFiles', () => {
  const files = goLibraryExampleFiles('markdownworkspace', 'markdown_workspace')

  it('writes a contract, a use case named after the project, and its test, all in the slice package', () => {
    expect(Object.keys(files)).toHaveLength(3)
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'greeting_contract.go',
      'markdown_workspace_use_case.go',
      'markdown_workspace_use_case_test.go',
    ]))
    for (const contents of Object.values(files)) {
      expect(contents).toMatch(/^package markdownworkspace$/m)
    }
  })

  it('has a use case returning the contract, and a test that checks the message', () => {
    expect(files['markdown_workspace_use_case.go']).toContain('func Greet(name string) Greeting {')
    expect(files['greeting_contract.go']).toContain('type Greeting struct {')
    expect(files['markdown_workspace_use_case_test.go']).toContain('Hello, world!')
  })

  it('indents with tabs, as gofmt does', () => {
    expect(files['greeting_contract.go']).toContain('\n\tMessage string\n')
  })
})

describe('goAppExampleFiles', () => {
  const files = goAppExampleFiles('github.com/acme/demo/apps/svc')

  it('keeps main.go as a wiring entry point that imports the hello package through the app module path', () => {
    expect(files['main.go']).toContain('"github.com/acme/demo/apps/svc/hello"')
    expect(files['main.go']).toContain('hello.Greet("world").Message')
  })

  it('puts the contract, use case and test in a hello package', () => {
    expect(Object.keys(files)).toHaveLength(4)
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'hello/greet_use_case.go',
      'hello/greet_use_case_test.go',
      'hello/greeting_contract.go',
      'main.go',
    ]))
    expect(files['hello/greet_use_case.go']).toMatch(/^package hello$/m)
  })
})

describe('goAppEmptyFiles', () => {
  it('is a main.go that does nothing and no package or test', () => {
    expect(Object.keys(goAppEmptyFiles())).toEqual(['main.go'])
    expect(goAppEmptyFiles()['main.go']).toContain('func main() {}')
  })
})
