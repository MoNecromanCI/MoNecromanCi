import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeGeneratedPipelines } from './remove-generated-pipelines.use-case'

let root: string

/** Writes a file under the workspace. */
function write (file: string, content = 'x'): void {
  mkdirSync(join(root, file, '..'), { recursive: true })
  writeFileSync(join(root, file), content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-generated-pipelines-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('removeGeneratedPipelines', () => {
  it('removes the GitHub and Azure pipelines Nx wrote, and says which', () => {
    write('.github/workflows/ci.yml')
    write('azure-pipelines.yml')

    expect(removeGeneratedPipelines(root)).toEqual(['.github/workflows/ci.yml', 'azure-pipelines.yml'])
    expect(existsSync(join(root, '.github/workflows/ci.yml'))).toBe(false)
    expect(existsSync(join(root, 'azure-pipelines.yml'))).toBe(false)
  })

  it('leaves every other file alone, including other workflows', () => {
    write('.github/workflows/ci.yml')
    write('.github/workflows/deploy.yml')
    write('package.json')

    removeGeneratedPipelines(root)

    expect(existsSync(join(root, '.github/workflows/deploy.yml'))).toBe(true)
    expect(existsSync(join(root, 'package.json'))).toBe(true)
  })

  it('does nothing when Nx wrote no pipeline', () => {
    write('package.json')

    expect(removeGeneratedPipelines(root)).toEqual([])
  })
})
