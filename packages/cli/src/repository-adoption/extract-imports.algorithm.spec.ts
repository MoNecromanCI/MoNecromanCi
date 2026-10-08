import { extractImportedPackages, packageOfSpecifier } from './extract-imports.algorithm'

describe('packageOfSpecifier', () => {
  it.each([
    ['lodash', 'lodash'],
    ['lodash/fp', 'lodash'],
    ['@azure/functions', '@azure/functions'],
    ['@azure/functions/sub/path', '@azure/functions'],
  ])('names the package of %s', (specifier, expected) => {
    expect(packageOfSpecifier(specifier)).toBe(expected)
  })

  it.each(['./local', '../up', '/abs', 'node:fs', 'fs', 'fs/promises', '#alias', '~/x', 'https://x.test/a.js', '@scope'])('names no package for %s', specifier => {
    expect(packageOfSpecifier(specifier)).toBeUndefined()
  })
})

describe('extractImportedPackages', () => {
  it('finds every import form, deduplicated, and ignores relative and built-in modules', () => {
    const source = [
      "import axios from 'axios'",
      'import { a } from "@scope/pkg/deep"',
      "import 'reflect-metadata'",
      "export * from 'zod'",
      "const fs = require('node:fs')",
      "const path = require('path')",
      "const lazy = await import('dayjs')",
      "import local from './local'",
      "import axiosAgain from 'axios'",
    ].join('\n')

    expect([...extractImportedPackages(source)].toSorted((a, b) => a.localeCompare(b))).toEqual(['@scope/pkg', 'axios', 'dayjs', 'reflect-metadata', 'zod'])
  })

  it('finds nothing in a file with no imports', () => {
    expect(extractImportedPackages('export const a = 1').size).toBe(0)
  })
})
