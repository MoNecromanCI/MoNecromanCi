// Mocked because the flow reaches `mnci add` through its barrel, which transitively loads @inquirer/prompts:
// ESM-only, and unparseable by jest as CJS. Nothing here prompts; adding a project is a fake that writes what
// the real generator would.
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))
jest.mock('../terminal', () => ({ ...jest.requireActual('../terminal'), logger: { step: jest.fn(), info: jest.fn() } }))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddOptions, ProjectKind } from '../project-scaffolding'
import { applyPreset, findPreset, type PresetDependencies } from './apply-preset.use-case'

let workspaceRoot: string

/** Writes a file under the workspace. */
function write (file: string, content: unknown): void {
  mkdirSync(join(workspaceRoot, file, '..'), { recursive: true })
  writeFileSync(join(workspaceRoot, file), typeof content === 'string' ? content : JSON.stringify(content, undefined, 2))
}

/** Reads a file of the workspace back. */
function read (file: string): string {
  return readFileSync(join(workspaceRoot, file), 'utf8')
}

/** What `mnci add` leaves, as far as the preset's wiring looks at it. */
function scaffold (kind: ProjectKind, name: string): void {
  if (kind === 'internal-lib') {
    write(`libs/${name}/package.json`, { name: `@demo/${name}` })
  } else if (kind === 'node-app') {
    write(`apps/${name}/package.json`, { name: `@demo/${name}`, nx: {} })
    write(`apps/${name}/src/main.ts`, "app.get('/', helloHandler)\n")
    for (const file of ['hello.handler.ts', 'greet.use-case.ts', 'greet.use-case.spec.ts', 'greeting.contract.ts', 'index.ts']) {
      write(`apps/${name}/src/hello/${file}`, '// generated')
    }
  } else {
    write(`apps/${name}/package.json`, { name: `@demo/${name}` })
    write(`apps/${name}/vite.config.mts`, "export default defineConfig(() => ({\n  server:   {\n    port: 4200,\n    host: 'localhost',\n  },\n}))\n")
    for (const file of ['greeting.component.tsx', 'greet.use-case.ts', 'greet.use-case.spec.ts', 'greeting.contract.ts', 'index.ts']) {
      write(`apps/${name}/src/greeting/${file}`, '// generated')
    }
    write(`apps/${name}/src/app/app.component.spec.tsx`, '// generated')
  }
}

/** A generator whose Express app no longer has the route the preset rewrites. */
const changedGenerator: PresetDependencies['add'] = async (kind, name) => {
  scaffold(kind, name)
  if (kind === 'node-app') {
    write(`apps/${name}/src/main.ts`, '// something else\n')
  }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-preset-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

/** Dependencies that record what happened, with adding a project replaced by {@link scaffold}. */
function fakes (change: Partial<PresetDependencies> = {}): { dependencies: Partial<PresetDependencies>, added: { kind: ProjectKind, name: string, options: AddOptions, cwd: string }[], steps: string[] } {
  const added: { kind: ProjectKind, name: string, options: AddOptions, cwd: string }[] = []
  const steps: string[] = []

  return {
    added,
    steps,
    dependencies: {
      add:     async (kind, name, options) => { added.push({ kind, name, options, cwd: process.cwd() }); scaffold(kind, name) },
      install: () => {
        steps.push('install')

        return 0
      },
      sync:   () => { steps.push('sync') },
      format: () => { steps.push('format') },
      ...change,
    },
  }
}

describe('findPreset', () => {
  it('finds a preset by name, and names the ones that exist when it is unknown', () => {
    expect(findPreset('web-api').projects.map(project => project.name)).toEqual(['shared', 'api', 'web'])
    expect(() => findPreset('mobile')).toThrow("Unknown preset 'mobile'. Presets: web-api.")
  })
})

describe('applyPreset web-api', () => {
  it('adds the library first, then the API and the frontend, from inside the workspace, and restores the directory', async () => {
    const { dependencies, added } = fakes()
    const before = process.cwd()

    await applyPreset(workspaceRoot, 'web-api', dependencies)

    expect(added.map(each => `${each.kind}:${each.name}`)).toEqual(['internal-lib:shared', 'node-app:api', 'react-app:web'])
    expect(added.every(each => each.cwd === workspaceRoot || each.cwd.endsWith(workspaceRoot.split(/[\\/]/).at(-1) as string))).toBe(true)
    expect(added[1].options).toEqual({ framework: 'express' })
    expect(process.cwd()).toBe(before)
  })

  it('wires the API to the shared library and the frontend to the API, then installs, syncs and formats once each, in that order', async () => {
    const { dependencies, steps } = fakes()

    await applyPreset(workspaceRoot, 'web-api', dependencies)

    expect(read('apps/api/src/hello/hello.handler.ts')).toContain("import { greet } from '@demo/shared'")
    expect(read('apps/api/src/main.ts')).toBe("app.get('/api/greeting', helloHandler)\n")
    expect((JSON.parse(read('apps/api/package.json')) as { dependencies: Record<string, string> }).dependencies).toEqual({ '@demo/shared': '*' })
    expect((JSON.parse(read('apps/web/package.json')) as { dependencies: Record<string, string> }).dependencies).toEqual({ '@demo/shared': '*' })
    expect(read('apps/web/src/greeting/greeting.client.ts')).toContain("request('/api/greeting?name='")
    expect(read('apps/web/src/greeting/greeting.component.tsx')).toContain('load = fetchGreeting')
    expect(read('apps/web/vite.config.mts')).toContain("proxy: { '/api': 'http://localhost:3000' }")
    expect(steps).toEqual(['install', 'sync', 'format'])
  })

  it('drops the sample slices the shared library now owns', async () => {
    await applyPreset(workspaceRoot, 'web-api', fakes().dependencies)

    expect(() => read('apps/api/src/hello/greet.use-case.ts')).toThrow()
    expect(() => read('apps/web/src/greeting/greeting.contract.ts')).toThrow()
    expect(read('apps/api/src/hello/index.ts')).toBe("export * from './hello.handler'\n")
  })

  it('stops with a message when the generator output is not the shape it wires, rather than leaving a half-wired workspace', async () => {
    const { dependencies } = fakes({ add: changedGenerator })

    await expect(applyPreset(workspaceRoot, 'web-api', dependencies)).rejects.toThrow("has no app.get('/', helloHandler)")
  })

  it('says so when the install fails', async () => {
    await expect(applyPreset(workspaceRoot, 'web-api', fakes({ install: () => 1 }).dependencies)).rejects.toThrow('npm install failed after wiring the preset')
  })
})
