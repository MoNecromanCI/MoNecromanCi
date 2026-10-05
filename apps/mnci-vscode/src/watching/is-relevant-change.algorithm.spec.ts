import { isRelevantChange } from './is-relevant-change.algorithm'

describe('isRelevantChange', () => {
  it.each([
    'nx.json',
    'apps/web/project.json',
    'packages/ui/package.json',
    'apps/api/go.mod',
    String.raw`C:\ws\apps\svc\pyproject.toml`,
    'libs/dart/pubspec.yaml',
    'apps/cs/Demo.csproj',
  ])('refreshes on %s', path => {
    expect(isRelevantChange(path)).toBe(true)
  })

  it.each([
    'node_modules/zod/package.json',
    String.raw`C:\ws\node_modules\zod\package.json`,
    'apps/web/dist/package.json',
    '.nx/workspace-data/project.json',
    'apps/cs/obj/project.assets.json',
    'apps/web/src/main.ts',
    'README.md',
    'python-packages/x/.venv/lib/pyproject.toml',
  ])('ignores %s', path => {
    expect(isRelevantChange(path)).toBe(false)
  })
})
