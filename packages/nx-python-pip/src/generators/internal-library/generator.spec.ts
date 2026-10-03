import { readProjectConfiguration, type Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import internalLibraryGenerator from './generator'

describe('internalLibraryGenerator', () => {
  let tree: Tree

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace()
  })

  it('writes lint + test targets only — no build, no publish, no release override', async () => {
    await internalLibraryGenerator(tree, { name: 'core' })

    const project = readProjectConfiguration(tree, 'core')
    expect(project.root).toBe('libs/core')
    expect(Object.keys(project.targets ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'lint',
      'test',
    ])
    expect(project.release).toBeUndefined()

    expect(tree.read('libs/core/pyproject.toml', 'utf8')).toContain('name = "core"')
    expect(tree.exists('libs/core/core/__init__.py')).toBe(true)
  })

  it('marks the package typed (PEP 561), so a sibling importing it is not handed Any under mypy --strict', async () => {
    await internalLibraryGenerator(tree, { name: 'core' })

    expect(tree.exists('libs/core/core/py.typed')).toBe(true)
    expect(tree.read('libs/core/core/py.typed', 'utf8')).toBe('')
  })

  it('derives the marker path from the module directory, not the project name', async () => {
    await internalLibraryGenerator(tree, { name: 'my-core' })

    expect(tree.exists('libs/my-core/my_core/py.typed')).toBe(true)
  })
})
