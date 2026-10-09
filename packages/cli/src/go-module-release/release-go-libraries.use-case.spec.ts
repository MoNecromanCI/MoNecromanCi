import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { listGoLibraryDirectories, releaseGoLibraries } from './release-go-libraries.use-case'
import { releaseGoModule } from './release-go-module.use-case'

let root: string
let pushed: string[]

/** Runs git in the test repository, except `push`, which is recorded: there is no remote. */
function git (arguments_: string[]): string {
  if (arguments_[0] === 'push') {
    pushed.push(arguments_.slice(1).join(' '))

    return ''
  }

  return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' })
}

/** Writes a file and commits it with a message. */
function commit (file: string, message: string, body = ''): void {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), `${message}\n${Math.random()}`)
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', body === '' ? message : `${message}\n\n${body}`])
}

/** Writes a go-lib project.json. */
function goLibrary (name: string, tag = 'type:go-lib'): void {
  mkdirSync(join(root, 'packages', name), { recursive: true })
  writeFileSync(join(root, 'packages', name, 'project.json'), JSON.stringify({ name, tags: [tag] }))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-go-release-'))
  pushed = []
  git(['init', '-q', '-b', 'main'])
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listGoLibraryDirectories', () => {
  it('lists the projects tagged type:go-lib under packages, and nothing else', () => {
    goLibrary('tty')
    goLibrary('alpha')
    goLibrary('web', 'type:react-lib')
    mkdirSync(join(root, 'packages/broken'), { recursive: true })
    writeFileSync(join(root, 'packages/broken/project.json'), '{ not json')

    expect(listGoLibraryDirectories(root)).toEqual(['packages/alpha', 'packages/tty'])
  })
})

describe('releaseGoModule against a real repository', () => {
  it('tags v0.0.1 on the first commit that touched the module, and pushes that tag alone', () => {
    commit('packages/tty/tty.go', 'chore: scaffold')

    const released = releaseGoModule({ directory: 'packages/tty', git })

    expect(released).toEqual({ tag: 'packages/tty/v0.0.1', bump: 'first' })
    expect(git(['tag', '--list']).trim()).toBe('packages/tty/v0.0.1')
    expect(pushed).toEqual(['origin packages/tty/v0.0.1'])
  })

  it('counts only commits that touched the directory, since its latest tag', () => {
    commit('packages/tty/tty.go', 'chore: scaffold')
    releaseGoModule({ directory: 'packages/tty', git })
    commit('apps/cli/main.go', 'feat: something elsewhere')
    commit('packages/tty/tty.go', 'docs: explain')

    expect(releaseGoModule({ directory: 'packages/tty', git })).toBeUndefined()

    commit('packages/tty/tty.go', 'feat: a real feature')

    expect(releaseGoModule({ directory: 'packages/tty', git })).toEqual({ tag: 'packages/tty/v0.0.2', bump: 'patch' })
  })

  it('moves the minor for a breaking change before 1.0', () => {
    commit('packages/tty/tty.go', 'chore: scaffold')
    releaseGoModule({ directory: 'packages/tty', git })
    commit('packages/tty/tty.go', 'refactor: reshape', 'BREAKING CHANGE: the API moved')

    expect(releaseGoModule({ directory: 'packages/tty', git })?.tag).toBe('packages/tty/v0.1.0')
  })

  it('reports what it would do and creates nothing in a dry run', () => {
    commit('packages/tty/tty.go', 'feat: first')
    const lines: string[] = []

    expect(releaseGoModule({ directory: 'packages/tty', git, dryRun: true, log: line => { lines.push(line) } })?.tag).toBe('packages/tty/v0.0.1')
    expect(git(['tag', '--list']).trim()).toBe('')
    expect(pushed).toEqual([])
    expect(lines[0]).toContain('would tag packages/tty/v0.0.1')
  })

  it('is a no-op when the module has no commit at all', () => {
    commit('README.md', 'chore: readme')

    expect(releaseGoModule({ directory: 'packages/tty', git })).toBeUndefined()
  })
})

describe('releaseGoLibraries', () => {
  it('releases each library on its own history and returns the tags', () => {
    goLibrary('alpha')
    goLibrary('tty')
    commit('packages/alpha/a.go', 'feat: a')
    commit('packages/tty/t.go', 'feat: t')

    expect(releaseGoLibraries(root, { git })).toEqual(['packages/alpha/v0.0.1', 'packages/tty/v0.0.1'])
    expect(pushed).toEqual(['origin packages/alpha/v0.0.1', 'origin packages/tty/v0.0.1'])

    commit('packages/tty/t.go', 'fix: t')

    expect(releaseGoLibraries(root, { git })).toEqual(['packages/tty/v0.0.2'])
  })

  it('does nothing in a workspace with no Go library', () => {
    commit('README.md', 'chore: readme')

    expect(releaseGoLibraries(root, { git })).toEqual([])
  })
})
