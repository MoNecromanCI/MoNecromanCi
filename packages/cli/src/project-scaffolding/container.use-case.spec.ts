jest.mock('../nx-workspace', () => ({ runNx: jest.fn(), runFormatter: jest.fn(), runShell: jest.fn(() => 0) }))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addContainer, CONTAINER_SCRIPT, CONTAINER_SCRIPT_PATH, refreshContainerScript } from './container.use-case'

let workspaceRoot: string

/** Writes a file under the workspace, with JSON for an object. */
function write (file: string, content: unknown): void {
  mkdirSync(join(workspaceRoot, file, '..'), { recursive: true })
  writeFileSync(join(workspaceRoot, file), typeof content === 'string' ? content : JSON.stringify(content, undefined, 2))
}

/** Reads a file of the workspace back. */
function read (file: string): string {
  return readFileSync(join(workspaceRoot, file), 'utf8')
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-container-'))
  write('package.json', { name: '@shop/source', scripts: {} })
  write('apps/api/package.json', { name: '@shop/api', nx: { targets: { build: { executor: '@nx/esbuild:esbuild' } } } })
  write('apps/web/package.json', { name: '@shop/web', dependencies: { react: '^19' } })
  write('apps/web/index.html', '<html></html>')
  write('apps/svc/go.mod', 'module shop/svc\n')
  write('apps/svc/project.json', { name: 'svc' })
  write('apps/fn/package.json', { name: '@shop/fn', nx: { targets: { build: { executor: '@nx/esbuild:esbuild' } } } })
  write('apps/fn/host.json', '{}')
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('addContainer', () => {
  it('writes a Node app\'s image project: Dockerfile, ignore file, tagged manifest and image and start targets', () => {
    addContainer(workspaceRoot, 'api-image', { app: 'api', port: 3000 })

    expect(read('apps/api-image/Dockerfile')).toContain('FROM node:24-alpine')
    expect(read('apps/api-image/Dockerfile.dockerignore')).toBe('node_modules\n')
    const manifest = JSON.parse(read('apps/api-image/package.json')) as { name: string, nx: { tags: string[], implicitDependencies: string[], targets: Record<string, { dependsOn: string[], options: { command: string }, cache?: boolean }> } }
    expect(manifest.name).toBe('@shop/api-image')
    expect(manifest.nx.tags).toEqual(['type:container'])
    expect(manifest.nx.implicitDependencies).toEqual(['@shop/api'])
    expect(manifest.nx.targets.image.dependsOn).toEqual(['@shop/api:prune'])
    expect(manifest.nx.targets.image.cache).toBe(false)
    expect(manifest.nx.targets.image.options.command).toContain('--context apps/api/dist')
    expect(manifest.nx.targets.start.options.command).toContain('--publish 3000:3000')
    expect(manifest.nx.targets.build).toBeUndefined()
    expect(read(CONTAINER_SCRIPT_PATH)).toBe(CONTAINER_SCRIPT)
  })

  it('registers :image, :start and a :qa that builds the image, with no :build for CI', () => {
    addContainer(workspaceRoot, 'api-image', { app: 'api' })

    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
    expect(scripts['api-image:image']).toBe('nx run api-image:image')
    expect(scripts['api-image:start']).toBe('nx run api-image:start')
    expect(scripts['api-image:qa']).toBe('nx run api-image:image')
    expect(scripts['api-image:build']).toBeUndefined()
  })

  it('serves a React app with nginx and ships the server block as a file beside the Dockerfile', () => {
    addContainer(workspaceRoot, 'web-image', { app: 'web' })

    expect(read('apps/web-image/Dockerfile')).toContain('FROM nginx')
    expect(read('apps/web-image/files/default.conf')).toContain('try_files $uri $uri/ /index.html;')
    const manifest = JSON.parse(read('apps/web-image/package.json')) as { nx: { targets: Record<string, { dependsOn: string[] }> } }
    expect(manifest.nx.targets.image.dependsOn).toEqual(['@shop/web:build'])
  })

  it('names a Go app\'s linux binary and runs build-all first', () => {
    addContainer(workspaceRoot, 'svc-image', { app: 'svc' })

    expect(read('apps/svc-image/Dockerfile')).toContain('COPY svc /app')
    const manifest = JSON.parse(read('apps/svc-image/package.json')) as { name: string, nx: { targets: Record<string, { dependsOn: string[], options: { command: string } }> } }
    expect(manifest.nx.targets.image.dependsOn).toEqual(['svc:build-all'])
    expect(manifest.nx.targets.image.options.command).toContain('--context dist/platforms/svc/linux-amd64')
  })

  it('refuses an app that does not exist, and an Azure Functions app, saying why', () => {
    expect(() => addContainer(workspaceRoot, 'x-image', { app: 'missing' })).toThrow('there is no apps/missing')
    expect(() => addContainer(workspaceRoot, 'fn-image', { app: 'fn' })).toThrow('Azure Functions app has its own host image')
  })
})

describe('refreshContainerScript', () => {
  it('rewrites an out-of-date script in a workspace that has a container project, and leaves one without alone', () => {
    expect(refreshContainerScript(workspaceRoot)).toBe(false)

    addContainer(workspaceRoot, 'api-image', { app: 'api' })
    expect(refreshContainerScript(workspaceRoot)).toBe(false)

    write(CONTAINER_SCRIPT_PATH, '// stale')
    expect(refreshContainerScript(workspaceRoot)).toBe(true)
    expect(read(CONTAINER_SCRIPT_PATH)).toBe(CONTAINER_SCRIPT)
  })
})
