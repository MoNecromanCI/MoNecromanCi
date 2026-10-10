import {
  goAppEmptyFiles,
  goAppExampleFiles,
  goFunctionAppEmptyFiles,
  goFunctionAppExampleFiles,
  goLibraryExampleFiles,
} from './go-example.algorithm'

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

describe('goFunctionAppExampleFiles', () => {
  const files = goFunctionAppExampleFiles('github.com/acme/demo/apps/fn')

  it('names the built handler in host.json and forwards HTTP to it', () => {
    const host = JSON.parse(files['host.json']) as {
      customHandler: { description: { defaultExecutablePath: string }, enableForwardingHttpRequest: boolean }
    }

    expect(host.customHandler.description.defaultExecutablePath).toBe('handler')
    expect(host.customHandler.enableForwardingHttpRequest).toBe(true)
  })

  it('serves the hello slice at the route its function.json declares', () => {
    expect(files['main.go']).toContain('FUNCTIONS_CUSTOMHANDLER_PORT')
    expect(files['main.go']).toContain('mux.HandleFunc("/api/hello"')
    expect(files['main.go']).toContain('"github.com/acme/demo/apps/fn/hello"')
    expect(JSON.parse(files['hello/function.json'])).toEqual({
      bindings: expect.arrayContaining([expect.objectContaining({ type: 'httpTrigger', authLevel: 'anonymous' })]),
    })
  })

  it('keeps the local build out of git and names the custom runtime in the local settings', () => {
    expect(files['.gitignore']).toMatch(/^handler$/m)
    expect(files['.gitignore']).toMatch(/^handler\.exe$/m)
    expect(files['.gitignore']).not.toMatch(/local\.settings/)
    expect(JSON.parse(files['local.settings.json']).Values.FUNCTIONS_WORKER_RUNTIME).toBe('custom')
  })
})

describe('goFunctionAppEmptyFiles', () => {
  it('is a server with no route, no function and no slice package', () => {
    const files = goFunctionAppEmptyFiles()

    expect(Object.keys(files).sort((a, b) => a.localeCompare(b))).toEqual(['.gitignore', 'host.json', 'local.settings.json', 'main.go'])
    expect(files['main.go']).not.toContain('HandleFunc')
    expect(files['main.go']).toContain('server.ListenAndServe()')
  })
})
