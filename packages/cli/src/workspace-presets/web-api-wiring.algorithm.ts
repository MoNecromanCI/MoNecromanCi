/**
 * The API's handler: it answers with the shared library's greeting.
 *
 * @remarks
 * The use case and the contract it returns live in the shared library, so the API and the frontend cannot disagree
 * about what a greeting is.
 *
 * @param shared - The shared library's package name, such as `@demo/shared`.
 * @returns The text of `apps/<api>/src/hello/hello.handler.ts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function apiHandler (shared: string): string {
  return `import { greet } from '${shared}'
import type { Request, Response } from 'express'

export function helloHandler (request: Request, response: Response): void {
  const name = typeof request.query.name === 'string' ? request.query.name : 'world'
  response.send(greet(name))
}
`
}

/**
 * The API handler's spec: a request with a name gets that name's greeting from the shared library.
 *
 * @remarks
 * Compares with the shared library's own `greet`, so the spec follows the library rather than restating its text.
 *
 * @param shared - The shared library's package name.
 * @returns The text of `hello.handler.spec.ts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function apiHandlerSpec (shared: string): string {
  return String.raw`import { greet } from '${shared}'
import type { Request, Response } from 'express'
import { helloHandler } from './hello.handler'

/** A response that keeps what it was sent, so the spec needs no mock library and runs under Jest or Vitest. */
function recordingResponse (): { response: Response, sent: unknown[] } {
  const sent: unknown[] = []

  return { sent, response: { send: (value: unknown) => { sent.push(value) } } as unknown as Response }
}

describe('helloHandler', () => {
  it('answers with the shared library\'s greeting for the name asked', () => {
    const { response, sent } = recordingResponse()

    helloHandler({ query: { name: 'web' } } as unknown as Request, response)

    expect(sent).toEqual([greet('web')])
  })

  it('greets the world when no name is asked', () => {
    const { response, sent } = recordingResponse()

    helloHandler({ query: {} } as unknown as Request, response)

    expect(sent).toEqual([greet('world')])
  })
})
`
}

/**
 * The API slice's barrel: just the handler, since the use case and contract now live in the shared library.
 *
 * @remarks
 * Replaces the barrel that also exported the API's own copy of the use case and contract.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `hello/index.ts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function apiBarrel (): string {
  return "export * from './hello.handler'\n"
}

/**
 * The frontend's client of the API: the one place that knows the route and the request.
 *
 * @remarks
 * `request` defaults to `fetch` and can be replaced, so the client is tested by handing it a function that answers as
 * the API would, with nothing assigned on the global object. Only the shared library's type is imported, so the
 * frontend bundle gains no runtime dependency on it.
 *
 * @param shared - The shared library's package name.
 * @returns The text of `greeting.client.ts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function webGreetingClient (shared: string): string {
  return `import type { Greeting } from '${shared}'

export async function fetchGreeting (name: string, request: typeof fetch = fetch): Promise<Greeting> {
  const response = await request('/api/greeting?name=' + encodeURIComponent(name))

  return await response.json() as Greeting
}
`
}

/**
 * The client's spec: it asks the API's route for the name and returns what comes back.
 *
 * @remarks
 * Written without a mock library, so it runs under Jest or Vitest.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `greeting.client.spec.ts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function webGreetingClientSpec (): string {
  return String.raw`import { fetchGreeting } from './greeting.client'

describe('fetchGreeting', () => {
  it('asks the API\'s greeting route for the name and returns the answer', async () => {
    const requested: string[] = []
    const answering = (async (input: string) => {
      requested.push(input)

      return { json: async () => ({ message: 'Hello, web!' }) } as Response
    }) as unknown as typeof fetch

    expect(await fetchGreeting('web', answering)).toEqual({ message: 'Hello, web!' })
    expect(requested).toEqual(['/api/greeting?name=web'])
  })
})
`
}

/**
 * The frontend's greeting component: it loads the greeting and shows it, or says it could not.
 *
 * @remarks
 * The loader is a prop that defaults to the client, so the component is tested with a loader that answers at once and
 * a failed request shows a message instead of an unhandled rejection.
 *
 * @param shared - The shared library's package name.
 * @returns The text of `greeting.component.tsx`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function webGreetingComponent (shared: string): string {
  return `import { useEffect, useState } from 'react'
import type { Greeting } from '${shared}'
import { fetchGreeting } from './greeting.client'

export interface GreetingViewProps {
  readonly name: string
  readonly load?: (name: string) => Promise<Greeting>
}

export function GreetingView ({ name, load = fetchGreeting }: GreetingViewProps) {
  const [greeting, setGreeting] = useState<Greeting | undefined>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setGreeting(await load(name))
      } catch {
        setFailed(true)
      }
    })()
  }, [name, load])

  if (failed) {
    return <p>Could not reach the API.</p>
  }

  return <p>{greeting?.message ?? 'Loading...'}</p>
}
`
}

/**
 * The frontend component's spec: it shows what its loader returns, and says so when the loader fails.
 *
 * @remarks
 * The loader is passed in, so nothing is mocked and the spec runs under Jest or Vitest.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `greeting.component.spec.tsx`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function webGreetingSpec (): string {
  return `import { render } from '@testing-library/react'

import { GreetingView } from './greeting.component'

async function answering (name: string): Promise<{ message: string }> {
  return { message: 'Hello, ' + name + '!' }
}

async function offline (): Promise<never> {
  throw new Error('offline')
}

describe('GreetingView', () => {
  it('shows the greeting its loader returns for its name', async () => {
    const { findByText } = render(<GreetingView name='world' load={answering} />)

    expect(await findByText('Hello, world!')).toBeTruthy()
  })

  it('says so when the API cannot be reached', async () => {
    const { findByText } = render(<GreetingView name='world' load={offline} />)

    expect(await findByText('Could not reach the API.')).toBeTruthy()
  })
})
`
}

/**
 * The frontend slice's barrel: the component and the client, since the greeting itself now comes from the API.
 *
 * @remarks
 * Replaces the barrel that also exported the frontend's own copy of the use case and contract.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `greeting/index.ts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function webGreetingBarrel (): string {
  return "export * from './greeting.client'\nexport * from './greeting.component'\n"
}

/**
 * The frontend app's spec: it renders, and shows that it is loading the greeting.
 *
 * @remarks
 * The sample app spec rendered the greeting synchronously; with the greeting fetched, the app is checked at the point
 * it is certain to be in, before any answer. How the answer is shown is the component's spec.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `app.component.spec.tsx`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function webAppSpec (): string {
  return `import { render } from '@testing-library/react'

import App from './app.component'

describe('App', () => {
  it('renders, and shows that it is loading the greeting', () => {
    const { getByText } = render(<App />)

    expect(getByText('Loading...')).toBeTruthy()
  })
})
`
}

/**
 * Adds a development proxy for `/api` to a Vite config's `server` block.
 *
 * @remarks
 * The frontend asks `/api/...` and Vite forwards it to the API while developing, so the browser sees one origin and
 * the app needs no CORS setup. Edits the block mnci's React scaffold writes, which holds only plain values, so its end
 * is the first `},` after `server:`. A config without that block, or one that already has a proxy, is returned
 * unchanged rather than guessed at.
 *
 * @param config - The text of `vite.config.mts`.
 * @param target - Where the API listens, such as `http://localhost:3000`.
 * @returns The config with the proxy, or unchanged.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function withApiProxy (config: string, target: string): string {
  const start = config.indexOf('server:')
  const end = start === -1 ? -1 : config.indexOf('},', start)
  if (end === -1 || config.includes('proxy:')) {
    return config
  }
  const block = config.slice(start, end).trimEnd()

  return `${config.slice(0, start)}${block}\n    proxy: { '/api': '${target}' },\n  ${config.slice(end)}`
}
