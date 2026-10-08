import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import { withJsSpecifiers } from './esm-specifiers.algorithm'

/** The directory imports the generated sample code uses: `main.ts` reaches the `hello` slice through its barrel. */
const SAMPLE_DIRECTORIES: readonly string[] = ['./hello']

/** The line of a generated `jest.config.cts` the specifier mapper is written above. */
const JEST_ANCHOR = '  moduleFileExtensions:'

/** The mapper that lets Jest resolve `./x.js` to the `./x.ts` it stands for. */
const JEST_MAPPER = String.raw`  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },`

/**
 * Lists the `.ts` files under a directory.
 *
 * @param directory - Absolute path to read.
 * @returns Absolute paths.
 * @throws Never - an unreadable directory has none.
 * @typeParam None - this function has no generic type parameters.
 */
function typescriptFiles (directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true })

  return entries.flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return typescriptFiles(path)
    }

    return entry.name.endsWith('.ts') ? [path] : []
  })
}

/**
 * Turns a generated CommonJS Node app into an ES module app.
 *
 * @remarks
 * Three changes, each measured on a generated app: the manifest says `"type": "module"` and the esbuild target
 * builds `esm` (`prune-lockfile` keeps the type, so the pruned `dist` still runs); every relative import in the
 * app's sources names its file as TypeScript's `nodenext` resolution needs (`./hello` becomes
 * `./hello/index.js`); and Jest maps those `.js` specifiers back to the sources it transforms, which it would
 * otherwise look for as written. The app must not already be converted: a second run finds the mapper in place
 * and changes nothing.
 *
 * @param appRoot - Absolute path to the generated app's directory.
 * @returns Nothing.
 * @throws Error when the manifest, its build target or the Jest config is not the shape the generator writes.
 * @typeParam None - this function has no generic type parameters.
 */
export function convertAppToEsm (appRoot: string): void {
  const manifestPath = join(appRoot, 'package.json')
  const manifest = readJson<{ type?: string, nx?: { targets?: { build?: { options?: { format?: string[] } } } } } & Record<string, unknown>>(manifestPath)
  const build = manifest.nx?.targets?.build
  if (build?.options === undefined) {
    throw new Error(`${manifestPath} has no nx build target to switch to ESM; the generator's output changed.`)
  }
  build.options.format = ['esm']
  writeFileEnsured(manifestPath, toJson({ ...manifest, type: 'module' }))

  const sources = typescriptFiles(join(appRoot, 'src'))
  for (const file of sources) {
    const source = readFileSync(file, 'utf8')
    const converted = withJsSpecifiers(source, SAMPLE_DIRECTORIES)
    if (converted !== source) {
      writeFileEnsured(file, converted)
    }
  }

  const jestPath = join(appRoot, 'jest.config.cts')
  if (fileExists(jestPath)) {
    const jest = readFileSync(jestPath, 'utf8')
    if (!jest.includes('moduleNameMapper')) {
      if (!jest.includes(JEST_ANCHOR)) {
        throw new Error(`${jestPath} has no moduleFileExtensions line to put the .js mapper above; the generator's output changed.`)
      }
      writeFileEnsured(jestPath, jest.replace(JEST_ANCHOR, () => `${JEST_MAPPER}\n${JEST_ANCHOR}`))
    }
  }
}
