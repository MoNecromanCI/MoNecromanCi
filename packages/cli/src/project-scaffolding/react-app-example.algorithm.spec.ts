import { reactAppE2eSpec, reactAppExampleFiles, withNodeTypes } from './react-app-example.algorithm'

describe('reactAppExampleFiles', () => {
  const files = reactAppExampleFiles('web')

  it('writes a greeting feature (contract, use case, component, specs, barrel) and the App that composes it', () => {
    expect(Object.keys(files).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'app/app.component.spec.tsx',
      'app/app.component.tsx',
      'greeting/greet.use-case.spec.ts',
      'greeting/greet.use-case.ts',
      'greeting/greeting.component.spec.tsx',
      'greeting/greeting.component.tsx',
      'greeting/greeting.contract.ts',
      'greeting/index.ts',
    ])
  })

  it('reaches the greeting slice through its barrel, never a file inside it', () => {
    expect(files['app/app.component.tsx']).toContain("from '../greeting'")
    expect(files['app/app.component.tsx']).not.toMatch(/from '\.\.\/greeting\/./)
  })

  it('keeps App as both a named and the default export, which main.tsx imports', () => {
    expect(files['app/app.component.tsx']).toContain('export function App')
    expect(files['app/app.component.tsx']).toContain('export default App')
  })

  it('greets the project by name', () => {
    expect(files['app/app.component.tsx']).toContain("name='web'")
    expect(files['app/app.component.spec.tsx']).toContain('Hello, web!')
  })

  it('uses no template literal, so the generated text needs no escaping', () => {
    for (const contents of Object.values(files)) {
      expect(contents).not.toContain('`')
    }
  })
})

describe('reactAppE2eSpec', () => {
  it('visits the app and looks for the greeting of its own name', () => {
    const spec = reactAppE2eSpec('storefront')

    expect(spec).toContain("page.goto('/')")
    expect(spec).toContain("getByText('Hello, storefront!')")
  })
})

describe('withNodeTypes', () => {
  it("adds node to a Playwright project's tsconfig that names no types, keeping everything else", () => {
    const before = JSON.stringify({ extends: '../../tsconfig.base.json', compilerOptions: { allowJs: true, outDir: 'out-tsc/playwright' }, include: ['**/*.ts'] })

    expect(JSON.parse(withNodeTypes(before))).toEqual({
      extends:         '../../tsconfig.base.json',
      compilerOptions: { allowJs: true, outDir: 'out-tsc/playwright', types: ['node'] },
      include:         ['**/*.ts'],
    })
  })

  it('keeps the types already there, and adds node once', () => {
    const once = withNodeTypes(JSON.stringify({ compilerOptions: { types: ['jest'] } }))

    expect(JSON.parse(once).compilerOptions.types).toEqual(['jest', 'node'])
    expect(JSON.parse(withNodeTypes(once)).compilerOptions.types).toEqual(['jest', 'node'])
  })

  it('creates compilerOptions when there are none, and leaves text that is not JSON alone', () => {
    expect(JSON.parse(withNodeTypes('{}')).compilerOptions.types).toEqual(['node'])
    expect(withNodeTypes('{ // a comment\n}')).toBe('{ // a comment\n}')
  })

  it('ends with a newline, like every file mnci writes', () => {
    expect(withNodeTypes('{}').endsWith('\n')).toBe(true)
  })
})
