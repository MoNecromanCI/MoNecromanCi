import { nodeAppEmptyFiles, nodeAppExampleFiles } from './node-app-example.algorithm'

/** Every relative `from './x'` specifier in the files, resolved against the file that holds it. */
function relativeImports (files: Record<string, string>): { from: string, target: string }[] {
  const found: { from: string, target: string }[] = []
  for (const [path, contents] of Object.entries(files)) {
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    for (const match of contents.matchAll(/from '(?<specifier>\.[^']*)'/g)) {
      const specifier = match.groups?.specifier ?? ''
      found.push({ from: path, target: `${directory}/${specifier.slice(2)}`.replace(/^\//, '') })
    }
  }

  return found
}

/** Whether a resolved import names a file or a barrel the example writes. */
function resolves (files: Record<string, string>, target: string): boolean {
  const paths = new Set(Object.keys(files))

  return paths.has(`${target}.ts`) || paths.has(`${target}/index.ts`)
}

describe('nodeAppExampleFiles', () => {
  it.each(['none', 'express', 'koa'] as const)('writes a use case, its contract, spec and barrel for %s', framework => {
    const files = nodeAppExampleFiles(framework) ?? {}

    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'hello/greet.use-case.ts',
      'hello/greet.use-case.spec.ts',
      'hello/greeting.contract.ts',
      'hello/index.ts',
      'main.ts',
    ]))
  })

  it.each(['express', 'koa'] as const)('adds a handler that only adapts the transport, for %s', framework => {
    const files = nodeAppExampleFiles(framework) ?? {}

    expect(files['hello/hello.handler.ts']).toContain("from './greet.use-case'")
    expect(files['hello/index.ts']).toContain("'./hello.handler'")
    expect(files['main.ts']).toContain("from './hello'")
  })

  it('has no transport, hence no handler, for a bare app', () => {
    expect(nodeAppExampleFiles('none')).not.toHaveProperty(['hello/hello.handler.ts'])
  })

  it.each(['fastify', 'nest'] as const)('leaves %s to the layout its framework mandates', framework => {
    expect(nodeAppExampleFiles(framework)).toBeNull()
  })

  it.each(['none', 'express', 'koa'] as const)('imports only files it writes, reaching a sibling through its barrel (%s)', framework => {
    const files = nodeAppExampleFiles(framework) ?? {}

    for (const { from, target } of relativeImports(files)) {
      expect({ from, target, resolves: resolves(files, target) }).toEqual({ from, target, resolves: true })
    }
    // main.ts reaches the slice through its barrel, never a file inside it.
    expect(files['main.ts']).not.toMatch(/from '\.\/hello\/./)
  })

  it.each(['none', 'express', 'koa'] as const)('uses no template literal, so the generated text needs no escaping (%s)', framework => {
    const all = Object.values(nodeAppExampleFiles(framework) ?? {})
    for (const contents of all) {
      expect(contents).not.toContain('`')
    }
  })
})

describe('nodeAppEmptyFiles', () => {
  it('is the entry point alone, for the frameworks that have a bare variant', () => {
    for (const framework of ['none', 'express', 'koa'] as const) {
      expect(Object.keys(nodeAppEmptyFiles(framework) ?? {})).toEqual(['main.ts'])
    }
  })

  it('starts the server of express and koa with no route or handler', () => {
    expect(nodeAppEmptyFiles('express')?.['main.ts']).toContain('app.listen(')
    expect(nodeAppEmptyFiles('express')?.['main.ts']).not.toContain('app.get(')
    expect(nodeAppEmptyFiles('koa')?.['main.ts']).not.toContain('app.use(')
  })

  it('has no bare variant of the frameworks that mandate their layout', () => {
    expect(nodeAppEmptyFiles('fastify')).toBeNull()
    expect(nodeAppEmptyFiles('nest')).toBeNull()
  })
})
