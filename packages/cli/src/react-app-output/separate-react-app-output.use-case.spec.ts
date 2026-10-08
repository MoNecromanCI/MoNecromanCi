import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findReactAppsSharingOutput } from './find-react-apps-sharing-output.use-case'
import { separateReactAppOutput, separateReactAppsOutput } from './separate-react-app-output.use-case'

let workspaceRoot: string

/** Writes a file under the workspace, with JSON for an object. */
function write (file: string, content: unknown): void {
  mkdirSync(join(workspaceRoot, file, '..'), { recursive: true })
  writeFileSync(join(workspaceRoot, file), typeof content === 'string' ? content : JSON.stringify(content, undefined, 2))
}

/** What `@nx/react:app` generates, as far as the two output folders go. */
function reactApp (name: string, tsOutDir = 'dist'): void {
  write(`apps/${name}/vite.config.mts`, "export default defineConfig(() => ({\n  build: {\n    outDir: './dist',\n    emptyOutDir: true,\n  },\n}))\n")
  write(`apps/${name}/tsconfig.app.json`, { extends: '../../tsconfig.base.json', compilerOptions: { outDir: tsOutDir, tsBuildInfoFile: `${tsOutDir}/tsconfig.app.tsbuildinfo`, jsx: 'react-jsx' } })
}

/** Reads an app's tsc compiler options back. */
function compilerOptions (name: string): Record<string, unknown> {
  return (JSON.parse(readFileSync(join(workspaceRoot, `apps/${name}/tsconfig.app.json`), 'utf8')) as { compilerOptions: Record<string, unknown> }).compilerOptions
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-react-output-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('separateReactAppOutput', () => {
  it('moves tsc and its build info to out-tsc, keeping the rest of the compiler options', () => {
    reactApp('web')

    expect(separateReactAppOutput(join(workspaceRoot, 'apps/web'))).toBe(true)

    expect(compilerOptions('web')).toEqual({ outDir: 'out-tsc/app', tsBuildInfoFile: 'out-tsc/app/tsconfig.app.tsbuildinfo', jsx: 'react-jsx' })
  })

  it('leaves an app that is already separate, and does nothing the second time', () => {
    reactApp('web')
    reactApp('docs', 'out-tsc/app')

    expect(separateReactAppOutput(join(workspaceRoot, 'apps/docs'))).toBe(false)
    expect(separateReactAppOutput(join(workspaceRoot, 'apps/web'))).toBe(true)
    expect(separateReactAppOutput(join(workspaceRoot, 'apps/web'))).toBe(false)
  })

  it('leaves a directory with no Vite config, such as a Node app, alone', () => {
    write('apps/api/tsconfig.app.json', { compilerOptions: { outDir: 'dist' } })

    expect(separateReactAppOutput(join(workspaceRoot, 'apps/api'))).toBe(false)
    expect(compilerOptions('api').outDir).toBe('dist')
  })
})

describe('the workspace sweep', () => {
  it('finds the apps that share the folder and repairs exactly those', () => {
    reactApp('web')
    reactApp('admin')
    reactApp('docs', 'out-tsc/app')

    expect(findReactAppsSharingOutput(workspaceRoot)).toEqual(['apps/admin', 'apps/web'])
    expect(separateReactAppsOutput(workspaceRoot)).toEqual(['apps/admin', 'apps/web'])
    expect(findReactAppsSharingOutput(workspaceRoot)).toEqual([])
  })

  it('finds nothing in a workspace with no apps folder', () => {
    expect(findReactAppsSharingOutput(workspaceRoot)).toEqual([])
  })
})
