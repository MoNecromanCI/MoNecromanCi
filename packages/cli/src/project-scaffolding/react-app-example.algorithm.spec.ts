import { reactAppExampleFiles } from './react-app-example.algorithm'

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
