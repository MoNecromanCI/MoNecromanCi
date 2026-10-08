import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertAppToEsm } from './esm-conversion.use-case'

let app: string

/** Writes a file under the app. */
function write (file: string, content: string): void {
  mkdirSync(join(app, file, '..'), { recursive: true })
  writeFileSync(join(app, file), content)
}

/** Reads a file of the app back. */
function read (file: string): string {
  return readFileSync(join(app, file), 'utf8')
}

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), 'mnci-esm-'))
  write('package.json', JSON.stringify({ name: '@a/api', nx: { targets: { build: { options: { format: ['cjs'], bundle: false } } } } }))
  write('src/main.ts', "import { greet } from './hello'\n\nconsole.log(greet('world').message)\n")
  write('src/hello/index.ts', "export * from './greeting.contract'\nexport * from './greet.use-case'\n")
  write('src/hello/greet.use-case.spec.ts', "import { greet } from './greet.use-case'\n")
  write('jest.config.cts', "module.exports = {\n  testEnvironment: 'node',\n  moduleFileExtensions: ['ts', 'js'],\n}\n")
})

afterEach(() => {
  rmSync(app, { recursive: true, force: true })
})

describe('convertAppToEsm', () => {
  it('makes the manifest a module that builds esm, and keeps everything else in it', () => {
    convertAppToEsm(app)

    const manifest = JSON.parse(read('package.json')) as { type: string, name: string, nx: { targets: { build: { options: { format: string[], bundle: boolean } } } } }
    expect(manifest.type).toBe('module')
    expect(manifest.name).toBe('@a/api')
    expect(manifest.nx.targets.build.options).toEqual({ format: ['esm'], bundle: false })
  })

  it('names every relative import the way nodenext needs, a directory by its index', () => {
    convertAppToEsm(app)

    expect(read('src/main.ts')).toContain("from './hello/index.js'")
    expect(read('src/hello/index.ts')).toBe("export * from './greeting.contract.js'\nexport * from './greet.use-case.js'\n")
    expect(read('src/hello/greet.use-case.spec.ts')).toContain("from './greet.use-case.js'")
  })

  it('maps .js specifiers back for Jest, with the $1 intact, and does nothing the second time', () => {
    convertAppToEsm(app)
    const once = read('jest.config.cts')
    convertAppToEsm(app)

    expect(once).toContain(String.raw`moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },`)
    expect(read('jest.config.cts')).toBe(once)
    expect(read('src/main.ts')).toContain("from './hello/index.js'")
  })

  it('says so when the generator output is not the shape it expects, rather than half converting', () => {
    write('package.json', JSON.stringify({ name: '@a/api' }))

    expect(() => convertAppToEsm(app)).toThrow('has no nx build target')
  })
})
