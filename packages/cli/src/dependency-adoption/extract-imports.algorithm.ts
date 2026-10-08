import { builtinModules } from 'node:module'

/** `from 'x'`, `import 'x'`, `import('x')`, `require('x')` and `export ... from 'x'`, in any of the three quote styles. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)(['"`])([^'"`\n]+)\1/g

const BUILTINS: ReadonlySet<string> = new Set(builtinModules)

/**
 * The package a module specifier names.
 *
 * @remarks
 * `lodash/fp` is `lodash`, `@scope/pkg/sub` is `@scope/pkg`. A relative path, an absolute path, a `node:` or
 * built-in module, an alias that starts with `#` or `~`, and a URL name no package, so they give `undefined`.
 *
 * @param specifier - What follows `from` or sits inside `require()`.
 * @returns The package name, or `undefined`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function packageOfSpecifier (specifier: string): string | undefined {
  if (/^(?:[./#~]|[a-z]+:)/i.test(specifier)) {
    return undefined
  }
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  if (name === '' || BUILTINS.has(name) || (specifier.startsWith('@') && parts.length < 2)) {
    return undefined
  }

  return name
}

/**
 * Finds the packages a source file imports.
 *
 * @remarks
 * Reads the text, not the syntax tree: the question is only which package names appear in an import position,
 * and a parser per language would be a dependency for that. A specifier inside a comment or a string that
 * looks like an import is counted too, which can only over-report (a package kept where it was found used),
 * never lose one.
 *
 * @param source - The text of a `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` or `.cjs` file.
 * @returns The distinct package names it imports.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function extractImportedPackages (source: string): Set<string> {
  const found = new Set<string>()
  for (const match of source.matchAll(SPECIFIER)) {
    const name = packageOfSpecifier(match[2])
    if (name !== undefined) {
      found.add(name)
    }
  }

  return found
}
