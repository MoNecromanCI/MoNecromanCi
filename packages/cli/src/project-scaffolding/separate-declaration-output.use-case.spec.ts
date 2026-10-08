import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { separateDeclarationOutput } from './separate-declaration-output.use-case'

let appRoot: string

beforeEach(() => {
  appRoot = mkdtempSync(join(tmpdir(), 'mnci-outdir-'))
})

afterEach(() => {
  rmSync(appRoot, { recursive: true, force: true })
})

function read (): { compilerOptions: Record<string, unknown> } {
  return JSON.parse(readFileSync(join(appRoot, 'tsconfig.app.json'), 'utf8')) as { compilerOptions: Record<string, unknown> }
}

describe('separateDeclarationOutput', () => {
  it('moves a React app\'s tsc output out of the folder Vite empties (#346)', () => {
    writeFileSync(join(appRoot, 'tsconfig.app.json'), JSON.stringify({
      compilerOptions: { outDir: 'dist', tsBuildInfoFile: 'dist/tsconfig.app.tsbuildinfo', jsx: 'react-jsx' },
    }))

    separateDeclarationOutput(appRoot)

    expect(read().compilerOptions).toMatchObject({
      outDir:          'out-tsc/app',
      tsBuildInfoFile: 'out-tsc/app/tsconfig.app.tsbuildinfo',
      jsx:             'react-jsx',
    })
  })

  it('leaves an outDir someone already chose alone', () => {
    writeFileSync(join(appRoot, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { outDir: 'build' } }))

    separateDeclarationOutput(appRoot)

    expect(read().compilerOptions.outDir).toBe('build')
  })

  it('does nothing without a tsconfig', () => {
    expect(() => separateDeclarationOutput(appRoot)).not.toThrow()
  })
})
