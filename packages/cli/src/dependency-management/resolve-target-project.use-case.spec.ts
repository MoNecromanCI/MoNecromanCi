import { type ProjectLocation } from './manifest.repository'
import { resolveTarget } from './resolve-target-project.use-case'

jest.mock('../terminal', () => ({ logger: { error: jest.fn() } }))

function at (ecosystem: ProjectLocation['ecosystem'], dir: string): ProjectLocation {
  return { ecosystem, dir, name: dir.slice(dir.lastIndexOf('/') + 1), manifestPath: `${dir}/manifest` }
}

describe('resolveTarget', () => {
  it('finds a project by directory or by name', () => {
    const locations = [at('go', 'apps/api'), at('npm', 'apps/web')]

    expect(resolveTarget(locations, 'apps/api')?.ecosystem).toBe('go')
    expect(resolveTarget(locations, 'web')?.dir).toBe('apps/web')
  })

  it('is undefined for an unknown project', () => {
    expect(resolveTarget([at('go', 'apps/api')], 'nothing')).toBeUndefined()
  })

  it('prefers the framework toolchain over the asset package.json that shares its folder', () => {
    const locations = [at('npm', 'apps/blog'), at('composer', 'apps/blog')]

    expect(resolveTarget(locations, 'blog')?.ecosystem).toBe('composer')
    expect(resolveTarget(locations, 'apps/blog')?.ecosystem).toBe('composer')
  })

  it('still refuses one name that two different folders share', () => {
    const locations = [at('go', 'apps/api'), at('npm', 'libs/api')]

    expect(resolveTarget(locations, 'api')).toBeUndefined()
  })
})
