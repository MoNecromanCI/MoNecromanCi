import { withJsSpecifiers } from './esm-specifiers.algorithm'

describe('withJsSpecifiers', () => {
  it('adds .js to a relative import, an export-from and a side-effect import', () => {
    const source = [
      "import { greet } from './greet.use-case'",
      'import type { Greeting } from "./greeting.contract"',
      "export * from '../shared/thing'",
      "import './setup'",
    ].join('\n')

    expect(withJsSpecifiers(source)).toBe([
      "import { greet } from './greet.use-case.js'",
      'import type { Greeting } from "./greeting.contract.js"',
      "export * from '../shared/thing.js'",
      "import './setup.js'",
    ].join('\n'))
  })

  it('names the index of a directory import', () => {
    expect(withJsSpecifiers("import { greet } from './hello'\nimport './hello'", ['./hello'])).toBe("import { greet } from './hello/index.js'\nimport './hello/index.js'")
  })

  it('leaves packages, node: modules and specifiers that already have an extension alone, and is idempotent', () => {
    const source = "import express from 'express'\nimport { x } from 'node:fs'\nimport a from './a.js'\nimport b from './b.json'\n"

    expect(withJsSpecifiers(source)).toBe(source)
    expect(withJsSpecifiers(withJsSpecifiers("import c from './c'"))).toBe("import c from './c.js'")
  })
})
