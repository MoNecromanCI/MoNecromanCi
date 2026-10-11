import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findPackageImports } from './find-package-imports.use-case'

let project: string

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mnci-imports-'))
  mkdirSync(join(project, 'src/feature'), { recursive: true })
  mkdirSync(join(project, 'node_modules/zod'), { recursive: true })
  mkdirSync(join(project, 'dist'), { recursive: true })
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

describe('findPackageImports', () => {
  it('finds ES imports, dynamic imports, require and subpaths, and names each file once', () => {
    writeFileSync(join(project, 'src/a.ts'), "import { z } from 'zod'\n")
    writeFileSync(join(project, 'src/feature/b.mjs'), "const mod = await import('zod/v4')\n")
    writeFileSync(join(project, 'src/feature/c.cjs'), 'const z = require("zod")\n')

    expect(findPackageImports(project, 'zod')).toEqual(['src/a.ts', 'src/feature/b.mjs', 'src/feature/c.cjs'])
  })

  it('does not match a package that only shares a prefix', () => {
    writeFileSync(join(project, 'src/a.ts'), "import x from 'zod-to-json-schema'\n")

    expect(findPackageImports(project, 'zod')).toEqual([])
  })

  it('skips node_modules and build output', () => {
    writeFileSync(join(project, 'node_modules/zod/index.js'), "import 'zod'\n")
    writeFileSync(join(project, 'dist/main.js'), "import 'zod'\n")

    expect(findPackageImports(project, 'zod')).toEqual([])
  })

  it('treats the package name as text, never as a pattern', () => {
    writeFileSync(join(project, 'src/a.ts'), "import x from '@scope/pkg.name'\n")

    expect(findPackageImports(project, '@scope/pkg.name')).toEqual(['src/a.ts'])
    expect(findPackageImports(project, '@scope/pkgxname')).toEqual([])
  })
})
