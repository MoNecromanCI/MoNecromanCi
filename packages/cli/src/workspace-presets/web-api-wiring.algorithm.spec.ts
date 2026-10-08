import { apiBarrel, apiHandler, apiHandlerSpec, webAppSpec, webGreetingBarrel, webGreetingClient, webGreetingClientSpec, webGreetingComponent, webGreetingSpec, withApiProxy } from './web-api-wiring.algorithm'

describe('the API half', () => {
  it('answers with the shared library\'s greeting, reached by its package name', () => {
    const handler = apiHandler('@demo/shared')

    expect(handler).toContain("import { greet } from '@demo/shared'")
    expect(handler).toContain('response.send(greet(name))')
  })

  it('has a spec of the handler against the same shared greeting, and a barrel that exports only the handler', () => {
    expect(apiHandlerSpec('@demo/shared')).toContain("import { greet } from '@demo/shared'")
    expect(apiHandlerSpec('@demo/shared')).not.toMatch(/jest\.|vi\./)
    expect(apiBarrel()).toBe("export * from './hello.handler'\n")
  })
})

describe('the frontend half', () => {
  it('keeps the request in one client, which takes its fetch as a parameter and types the answer with the shared Greeting', () => {
    const client = webGreetingClient('@demo/shared')

    expect(client).toContain("import type { Greeting } from '@demo/shared'")
    expect(client).toContain("request('/api/greeting?name=' + encodeURIComponent(name))")
    expect(client).toContain('request: typeof fetch = fetch')
  })

  it('has a component that takes its loader as a prop and says so when the API cannot be reached', () => {
    const component = webGreetingComponent('@demo/shared')

    expect(component).toContain('load = fetchGreeting')
    expect(component).toContain('Could not reach the API.')
    expect(component).not.toContain('globalThis')
  })

  it('specs the client, the component and the app without a mock library and without patching the global object', () => {
    const specs = webGreetingClientSpec() + webGreetingSpec() + webAppSpec()

    expect(webGreetingClientSpec()).toContain("expect(requested).toEqual(['/api/greeting?name=web'])")
    expect(webGreetingSpec()).toContain('Could not reach the API.')
    expect(webAppSpec()).toContain("getByText('Loading...')")
    expect(specs).not.toMatch(/jest\.|vi\.|globalThis/)
  })

  it('exports the client and the component, and nothing of the sample the shared library replaced', () => {
    expect(webGreetingBarrel()).toBe("export * from './greeting.client'\nexport * from './greeting.component'\n")
  })
})

describe('withApiProxy', () => {
  const generated = "export default defineConfig(() => ({\n  server:   {\n    port: 4200,\n    host: 'localhost',\n  },\n  preview: {\n    port: 4300,\n  },\n}))\n"

  it('adds the proxy to the server block, and only there', () => {
    const result = withApiProxy(generated, 'http://localhost:3000')

    expect(result).toContain("    host: 'localhost',\n    proxy: { '/api': 'http://localhost:3000' },\n  },\n  preview:")
    expect(result.match(/proxy:/g)).toHaveLength(1)
  })

  it('leaves a config that has a proxy already, or no server block, as it is', () => {
    const proxied = withApiProxy(generated, 'http://localhost:3000')

    expect(withApiProxy(proxied, 'http://localhost:9999')).toBe(proxied)
    expect(withApiProxy('export default {}', 'http://localhost:3000')).toBe('export default {}')
  })
})
