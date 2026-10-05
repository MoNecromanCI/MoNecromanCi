import type { NodeFramework } from './post-generation.use-case'

/** The use case every Node app example shares: one outcome, free of any framework. */
const GREET_USE_CASE = `import type { Greeting } from './greeting.contract'

export function greet (name: string): Greeting {
  return { message: 'Hello, ' + name + '!' }
}
`

/** The data the use case returns. */
const GREETING_CONTRACT = `/** What greeting someone returns. */
export interface Greeting {
  readonly message: string
}
`

/** The use case's spec: no framework, so it runs under either test runner. */
const GREET_SPEC = `import { greet } from './greet.use-case'

describe('greet', () => {
  it('greets a name', () => {
    expect(greet('world')).toEqual({ message: 'Hello, world!' })
  })
})
`

/** The slice's files common to every framework, keyed by path under `src/`. */
const SLICE: Record<string, string> = {
  'hello/greet.use-case.ts':      GREET_USE_CASE,
  'hello/greeting.contract.ts':   GREETING_CONTRACT,
  'hello/greet.use-case.spec.ts': GREET_SPEC,
}

/**
 * The worked example `mnci add node-app` writes, as paths under `src/` to contents.
 *
 * @remarks
 * The same shape the vertical-slice rules describe for a service: a `hello` slice
 * holding a use case (`greet`), the contract it returns and its spec, and, where the
 * framework has a transport, a `hello.handler.ts` that decodes the request, calls the
 * use case and shapes the response. `main.ts` stays at the root of `src` and wires the
 * slice through its barrel. Written without template literals, so the generated text
 * needs no escaping.
 *
 * `fastify` and `nest` return `null`: their frameworks mandate a layout (`routes/` and
 * `plugins/` for Fastify's autoload, `*.controller.ts` and `*.module.ts` for Nest), and
 * a tool-mandated name is exempt from the slice rules, so mnci leaves it as generated.
 *
 * @param framework - The HTTP framework the app was scaffolded with.
 * @returns The files to write, or `null` when the framework's own layout is kept.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function nodeAppExampleFiles (framework: NodeFramework): Record<string, string> | null {
  switch (framework) {
    case 'none': {
      return {
        ...SLICE,
        'hello/index.ts': 'export * from \'./greeting.contract\'\nexport * from \'./greet.use-case\'\n',
        'main.ts':        'import { greet } from \'./hello\'\n\nconsole.log(greet(\'world\').message)\n',
      }
    }
    case 'express': {
      return {
        ...SLICE,
        'hello/hello.handler.ts': `import type { Request, Response } from 'express'
import { greet } from './greet.use-case'

export function helloHandler (request: Request, response: Response): void {
  const name = typeof request.query.name === 'string' ? request.query.name : 'world'
  response.send(greet(name))
}
`,
        'hello/index.ts': 'export * from \'./greeting.contract\'\nexport * from \'./greet.use-case\'\nexport * from \'./hello.handler\'\n',
        'main.ts':        `import express from 'express'
import { helloHandler } from './hello'

const host = process.env.HOST ?? 'localhost'
const port = process.env.PORT ? Number(process.env.PORT) : 3000

const app = express()

app.get('/', helloHandler)

app.listen(port, host, () => {
  console.log('[ ready ] http://' + host + ':' + String(port))
})
`,
      }
    }
    case 'koa': {
      return {
        ...SLICE,
        'hello/hello.handler.ts': `import type { Context } from 'koa'
import { greet } from './greet.use-case'

export function helloHandler (context: Context): void {
  const name = typeof context.query.name === 'string' ? context.query.name : 'world'
  context.body = greet(name)
}
`,
        'hello/index.ts': 'export * from \'./greeting.contract\'\nexport * from \'./greet.use-case\'\nexport * from \'./hello.handler\'\n',
        'main.ts':        `import Koa from 'koa'
import { helloHandler } from './hello'

const host = process.env.HOST ?? 'localhost'
const port = process.env.PORT ? Number(process.env.PORT) : 3000

const app = new Koa()

app.use(helloHandler)

app.listen(port, host, () => {
  console.log('[ ready ] http://' + host + ':' + String(port))
})
`,
      }
    }
    case 'fastify':
    case 'nest': {
      return null
    }
  }
}
