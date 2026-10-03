/**
 * Executes the `build-all` and `package-all` commands mnci writes for a Go app, in a
 * real throwaway module, through the platform shell as `nx:run-commands` would.
 *
 * @remarks
 * Both are Node one-liners inside a shell command, quoted for every shell; the
 * only real proof that they work is running them. Skipped, loudly, without a Go
 * toolchain.
 */

// The scaffolding barrel reaches the prompts, an ESM package Jest does not transform.
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))
// The native block scaffolds through runAdd. The generators and installs it would run are
// stood in for; what is under test is the commands it writes, which run for real below.
jest.mock('./nx-workspace', () => ({ runNx: jest.fn(), runFormatter: jest.fn(), runShell: jest.fn(() => 0) }))

import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addGoPlatformTargets, GO_PLATFORMS, runAdd } from './project-scaffolding'

const hasGo = spawnSync('go', ['version']).status === 0
const describeWithGo = hasGo ? describe : describe.skip
if (!hasGo) {
  console.warn('SKIPPED: go-platform-build-execution needs a Go toolchain on PATH')
}

describeWithGo('the Go six-platform build, executed', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mnci-go-build-all-'))
    writeFileSync(join(root, 'go.mod'), 'module demo\n\ngo 1.22\n')
    mkdirSync(join(root, 'apps', 'hello'), { recursive: true })
    writeFileSync(join(root, 'apps', 'hello', 'main.go'), 'package main\n\nimport "fmt"\n\nvar version = "unset"\n\nfunc main() { fmt.Println(version) }\n')
    writeFileSync(join(root, 'apps', 'hello', 'project.json'), JSON.stringify({ name: 'hello', tags: ['type:go-app'], targets: {} }))
    // A stand-in for adm-zip, which a generated workspace installs: it records what
    // would be zipped where, which is what the package loop decides.
    mkdirSync(join(root, 'node_modules', 'adm-zip'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'adm-zip', 'index.js'),
      "const fs=require('node:fs');module.exports=class{addLocalFolder(d){this.d=d}writeZip(z){fs.writeFileSync(z,'zip of '+this.d)}}")
    addGoPlatformTargets(root)
  }, 30_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function command (target: string): string {
    const project = JSON.parse(readFileSync(join(root, 'apps', 'hello', 'project.json'), 'utf8')) as {
      targets: Record<string, { options: { command: string } }>
    }

    return project.targets[target].options.command
  }

  it('builds one static binary per platform, stamped with VERSION', () => {
    execSync(command('build-all'), { cwd: root, env: { ...process.env, VERSION: '1.2.3' }, stdio: 'pipe' })

    for (const platform of GO_PLATFORMS) {
      const [os, arch] = platform.split('/', 2)
      const binary = join(root, 'dist', 'platforms', 'hello', `${os}-${arch}`, os === 'windows' ? 'hello.exe' : 'hello')
      expect(existsSync(binary)).toBe(true)
      const info = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' })
      expect(info).toContain(`GOOS=${os}`)
      expect(info).toContain(`GOARCH=${arch}`)
      expect(info).toContain('CGO_ENABLED=0')
      expect(info).toContain('-trimpath=true')
    }
    // -trimpath keeps -ldflags out of the build info, so the stamp is checked by
    // running the binary built for this machine.
    const [os, arch] = execFileSync('go', ['env', 'GOOS', 'GOARCH'], { encoding: 'utf8' }).trim().split(/\s+/, 2)
    const host = join(root, 'dist', 'platforms', 'hello', `${os}-${arch}`, os === 'windows' ? 'hello.exe' : 'hello')
    expect(execFileSync(host, { encoding: 'utf8' }).trim()).toBe('1.2.3')
  }, 300_000)

  it('zips each platform into its own drop', () => {
    execSync(command('package-all'), { cwd: root, stdio: 'pipe' })

    const drops = readdirSync(join(root, 'dist', 'drop')).sort((a, b) => a.localeCompare(b))
    expect(drops).toEqual(GO_PLATFORMS.map(platform => `go-app-hello-${platform.replace('/', '-')}.zip`).sort((a, b) => a.localeCompare(b)))
    expect(readFileSync(join(root, 'dist', 'drop', 'go-app-hello-windows-arm64.zip'), 'utf8')).toBe('zip of dist/platforms/hello/windows-arm64')
  })
})

describeWithGo('the native (cgo) build, executed', () => {
  let root: string
  let host: { os: string; arch: string }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'mnci-go-native-'))
    jest.spyOn(process, 'cwd').mockReturnValue(root)
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    writeFileSync(join(root, 'nx.json'), '{}')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
    writeFileSync(join(root, 'go.mod'), 'module demo\n\ngo 1.22\n')
    mkdirSync(join(root, 'apps', 'tray'), { recursive: true })
    writeFileSync(join(root, 'apps', 'tray', 'main.go'), 'package main\n\nimport "fmt"\n\nvar version = "unset"\n\nfunc main() { fmt.Println(version) }\n')
    // What the (stood-in) generator writes; runAdd adds the targets.
    writeFileSync(join(root, 'apps', 'tray', 'project.json'), JSON.stringify({ name: 'tray', tags: ['type:go-app', 'build:cgo'], targets: {} }))
    mkdirSync(join(root, 'node_modules', 'adm-zip'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'adm-zip', 'index.js'),
      "const fs=require('node:fs');module.exports=class{addLocalFolder(d){this.d=d}writeZip(z){fs.writeFileSync(z,'zip of '+this.d)}}")
    await runAdd('go-app', 'tray', { cgo: true })
    const [os, arch] = execFileSync('go', ['env', 'GOOS', 'GOARCH'], { encoding: 'utf8' }).trim().split(/\s+/, 2)
    host = { os, arch }
  }, 30_000)

  afterAll(() => {
    jest.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  function command (target: string): string {
    const project = JSON.parse(readFileSync(join(root, 'apps', 'tray', 'project.json'), 'utf8')) as {
      targets: Record<string, { options: { command: string } }>
    }

    return project.targets[target].options.command
  }

  it('builds one binary, for this machine, stamped with VERSION and linked with cgo enabled', () => {
    execSync(command('build-native'), { cwd: root, env: { ...process.env, VERSION: '4.5.6' }, stdio: 'pipe' })

    const directory = join(root, 'dist', 'platforms', 'tray', `${host.os}-${host.arch}`)
    const binary = join(directory, host.os === 'windows' ? 'tray.exe' : 'tray')
    expect(readdirSync(join(root, 'dist', 'platforms', 'tray'))).toEqual([`${host.os}-${host.arch}`])
    expect(existsSync(binary)).toBe(true)
    expect(execFileSync(binary, { encoding: 'utf8' }).trim()).toBe('4.5.6')
    const info = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' })
    expect(info).toContain('CGO_ENABLED=1')
    expect(info).toContain('-trimpath=true')
  }, 120_000)

  it('stamps dev when VERSION is not set', () => {
    const env = { ...process.env }
    delete env.VERSION
    execSync(command('build-native'), { cwd: root, env, stdio: 'pipe' })

    const binary = join(root, 'dist', 'platforms', 'tray', `${host.os}-${host.arch}`, host.os === 'windows' ? 'tray.exe' : 'tray')
    expect(execFileSync(binary, { encoding: 'utf8' }).trim()).toBe('dev')
  }, 120_000)

  it('zips this machine\'s build under the name package-all gives a platform, so a release treats them alike', () => {
    execSync(command('package-native'), { cwd: root, stdio: 'pipe' })

    expect(readdirSync(join(root, 'dist', 'drop'))).toEqual([`go-app-tray-${host.os}-${host.arch}.zip`])
    expect(readFileSync(join(root, 'dist', 'drop', `go-app-tray-${host.os}-${host.arch}.zip`), 'utf8'))
      .toBe(`zip of dist/platforms/tray/${host.os}-${host.arch}`)
  })
})
