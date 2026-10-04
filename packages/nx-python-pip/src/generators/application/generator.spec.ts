import { readProjectConfiguration, type Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import appGenerator from './generator'

describe('appGenerator', () => {
  let tree: Tree

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace()
  })

  it('writes pyproject.toml + project.json (lint/test/build, no publish) + a sample module and pytest', async () => {
    await appGenerator(tree, { name: 'svc' })

    const project = readProjectConfiguration(tree, 'svc')
    expect(project.root).toBe('apps/svc')
    expect(project.projectType).toBe('application')
    expect(project.targets?.lint?.executor).toBe('@mnci/nx-python-pip:lint')
    expect(project.targets?.test?.executor).toBe('@mnci/nx-python-pip:test')
    expect(project.targets?.build?.executor).toBe('@mnci/nx-python-pip:build')
    expect(project.targets?.['nx-release-publish']).toBeUndefined()
    expect(project.release).toBeUndefined()

    const pyproject = tree.read('apps/svc/pyproject.toml', 'utf8')
    expect(pyproject).toContain('name = "svc"')
    expect(pyproject).toContain('packages = ["svc"]')

    expect(tree.read('apps/svc/svc/svc_use_case.py', 'utf8')).toContain('def hello')
    expect(tree.read('apps/svc/svc/__init__.py', 'utf8')).toContain('__all__')
    expect(tree.read('apps/svc/tests/test_svc_use_case.py', 'utf8')).toContain('from svc import hello')
  })

  it('does not mark an application as typed — nothing imports an app, so there is no consumer to promise types to', async () => {
    await appGenerator(tree, { name: 'svc' })

    expect(tree.exists('apps/svc/svc/py.typed')).toBe(false)
  })

  it('honours an explicit directory, and derives the module directory from hyphenated names', async () => {
    await appGenerator(tree, { name: 'my-svc', directory: 'custom/my-svc' })

    const project = readProjectConfiguration(tree, 'my-svc')
    expect(project.root).toBe('custom/my-svc')
    expect(tree.exists('custom/my-svc/my_svc/__init__.py')).toBe(true)
  })
})
