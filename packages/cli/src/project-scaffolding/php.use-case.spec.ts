jest.mock('../nx-workspace', () => ({
  runNx:        jest.fn(),
  runFormatter: jest.fn(),
  runShell:     jest.fn(() => 0),
  runCapture:   jest.fn(() => ({ status: 0, stdout: '' })),
}))
jest.mock('../terminal', () => ({
  ...jest.requireActual('../terminal'),
  promptText: jest.fn(),
}))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAdd } from './add-project.use-case'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-php-'))
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
  writeFileSync(join(workspaceRoot, '.gitignore'), 'node_modules\n')
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

describe('runAdd php-app', () => {
  it('writes a Composer project with a greeting slice, a test beside it in tests/, and a bin script that only wires', async () => {
    await runAdd('php-app', 'hello', {})

    const root = join(workspaceRoot, 'apps/hello')
    for (const file of [
      'composer.json',
      'phpunit.xml.dist',
      'phpstan.neon',
      'bin/hello.php',
      'src/Greeting/GreetUseCase.php',
      'src/Greeting/GreetingContract.php',
      'tests/Greeting/GreetUseCaseTest.php',
    ]) {
      expect(existsSync(join(root, file))).toBe(true)
    }
    const manifest = JSON.parse(readFileSync(join(root, 'composer.json'), 'utf8'))
    expect(manifest.name).toBe('app/hello')
    expect(manifest.autoload['psr-4']).toEqual({ 'App\\Hello\\': 'src/' })
  })

  it('writes the root composer.json of shared dev tools once, and ignores vendor/', async () => {
    await runAdd('php-app', 'hello', {})
    await runAdd('php-internal-lib', 'kit', {})

    const root = JSON.parse(readFileSync(join(workspaceRoot, 'composer.json'), 'utf8'))
    expect(Object.keys(root['require-dev'])).toEqual(expect.arrayContaining(['phpstan/phpstan', 'phpunit/phpunit', 'squizlabs/php_codesniffer']))
    expect(root.require).toBeUndefined()
    expect(readFileSync(join(workspaceRoot, '.gitignore'), 'utf8').match(/^vendor\/$/gm)).toHaveLength(1)
  })

  it('has build, test, slice-check, lint, start and package targets; the project installs its own vendor/', async () => {
    await runAdd('php-app', 'hello', {})

    const { targets, tags } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/hello/project.json'), 'utf8'))
    expect(Object.keys(targets)).toEqual(['build', 'test', 'slice-check', 'lint', 'start', 'package'])
    expect(tags).toEqual(['type:php-app'])
    expect(targets.build.outputs).toEqual(['{workspaceRoot}/apps/hello/vendor'])
    expect(targets.build.options.commands[0]).toContain('validate --strict --working-dir=apps/hello')
    expect(targets.lint.dependsOn).toEqual(['slice-check', 'build'])
    expect(targets.lint.options.commands.join('\n')).toContain('phpstan analyse -c apps/hello/phpstan.neon')
    expect(targets.lint.options.commands.join('\n')).toContain('--standard=PSR12 apps/hello/src apps/hello/tests apps/hello/bin')
    expect(targets.package.outputs).toEqual(['{workspaceRoot}/dist/drop/php-app-hello.zip'])
  })

  it('--empty keeps one smoke test, because PHPUnit exits non-zero on an empty suite, and an entry script that does nothing', async () => {
    await runAdd('php-app', 'hello', { empty: true })

    const root = join(workspaceRoot, 'apps/hello')
    expect(existsSync(join(root, 'tests/SmokeTest.php'))).toBe(true)
    expect(readFileSync(join(root, 'bin/hello.php'), 'utf8')).not.toContain('Greet')
    expect(existsSync(join(root, 'src/Greeting'))).toBe(false)
  })
})

describe('runAdd php-lib and php-internal-lib', () => {
  it('keeps the version under extra.mnci and wires release by tag', async () => {
    await runAdd('php-lib', 'core', {})

    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'packages/core/composer.json'), 'utf8'))
    expect(manifest.type).toBe('library')
    expect(manifest.extra.mnci.version).toBe('0.1.0')
    expect(manifest.version).toBeUndefined()
    const project = JSON.parse(readFileSync(join(workspaceRoot, 'packages/core/project.json'), 'utf8'))
    expect(project.release.version.versionActions).toBe('tools/composer-version-actions.cjs')
    expect(Object.keys(project.targets)).toContain('nx-release-publish')
  })

  it('a private library has no release, no start, and no extra', async () => {
    await runAdd('php-internal-lib', 'kit', {})

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit/project.json'), 'utf8'))
    expect(project.release).toBeUndefined()
    expect(Object.keys(project.targets)).toEqual(['build', 'test', 'slice-check', 'lint'])
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit/composer.json'), 'utf8'))
    expect(manifest.extra).toBeUndefined()
  })
})
