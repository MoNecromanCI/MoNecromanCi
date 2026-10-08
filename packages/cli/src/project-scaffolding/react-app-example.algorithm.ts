/**
 * The worked example `mnci add react-app` writes over Nx's welcome page, as paths under
 * `src/` to contents.
 *
 * @remarks
 * Two slices, the shape the vertical-slice rules describe for a front end. `greeting`
 * is a feature: a contract (the data), a use case (`greet`, with its spec) and a
 * component that shows it (with its spec), behind a barrel. `app` composes it and is
 * the root `main.tsx` renders. Written without template literals, so the generated text
 * needs no escaping, and with no dependency beyond React and the test library the
 * generator already installs.
 *
 * @param name - The project name, which the app greets.
 * @returns The files to write, keyed by path under `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function reactAppExampleFiles (name: string): Record<string, string> {
  return {
    'greeting/greeting.contract.ts': `/** What greeting someone returns. */
export interface Greeting {
  readonly message: string
}
`,
    'greeting/greet.use-case.ts': `import type { Greeting } from './greeting.contract'

export function greet (name: string): Greeting {
  return { message: 'Hello, ' + name + '!' }
}
`,
    'greeting/greet.use-case.spec.ts': `import { greet } from './greet.use-case'

describe('greet', () => {
  it('greets a name', () => {
    expect(greet('world')).toEqual({ message: 'Hello, world!' })
  })
})
`,
    'greeting/greeting.component.tsx': `import { greet } from './greet.use-case'

export interface GreetingViewProps {
  readonly name: string
}

export function GreetingView ({ name }: GreetingViewProps) {
  return <p>{greet(name).message}</p>
}
`,
    'greeting/greeting.component.spec.tsx': `import { render } from '@testing-library/react'

import { GreetingView } from './greeting.component'

describe('GreetingView', () => {
  it('shows the greeting', () => {
    const { getByText } = render(<GreetingView name='world' />)
    expect(getByText('Hello, world!')).toBeTruthy()
  })
})
`,
    'greeting/index.ts': `export * from './greeting.contract'
export * from './greet.use-case'
export * from './greeting.component'
`,
    'app/app.component.tsx': `import { GreetingView } from '../greeting'

export function App () {
  return (
    <main>
      <GreetingView name='${name}' />
    </main>
  )
}

export default App
`,
    'app/app.component.spec.tsx': `import { render } from '@testing-library/react'

import App from './app.component'

describe('App', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<App />)
    expect(baseElement).toBeTruthy()
  })

  it('shows the greeting', () => {
    const { getByText } = render(<App />)
    expect(getByText('Hello, ${name}!')).toBeTruthy()
  })
})
`,
  }
}

/**
 * The end-to-end test of a React app's paired Playwright project.
 *
 * @remarks
 * Replaces the `example.spec.ts` Nx writes, which looks for an `h1` containing "Welcome" that the greeting
 * feature does not render. This checks what the app does show: the greeting for its own name.
 *
 * @param name - The React app's project name, which is also the name it greets.
 * @returns The text of `src/greeting.e2e.spec.ts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function reactAppE2eSpec (name: string): string {
  return `import { expect, test } from '@playwright/test'

test('shows the greeting', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Hello, ${name}!')).toBeVisible()
})
`
}
