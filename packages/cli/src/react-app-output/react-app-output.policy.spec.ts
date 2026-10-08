import { sharesOutputFolder, viteOutputFolder } from './react-app-output.policy'

describe('viteOutputFolder', () => {
  it.each([
    ["build: { outDir: './dist', emptyOutDir: true }", 'dist'],
    ['build: {\n    outDir:               "../../dist/web",\n  }', '../../dist/web'],
    ["cacheDir: '../../node_modules/.vite/apps/web'", 'dist'],
    ['export default {}', 'dist'],
  ])('reads %j as %s', (config, expected) => {
    expect(viteOutputFolder(config)).toBe(expected)
  })
})

describe('sharesOutputFolder', () => {
  const generated = "build: {\n    outDir: './dist',\n    emptyOutDir: true,\n  }"

  it('is true when tsc and Vite both write to dist, however each spells it', () => {
    expect(sharesOutputFolder('dist', generated)).toBe(true)
    expect(sharesOutputFolder('./dist/', generated)).toBe(true)
  })

  it('is false once tsc writes elsewhere, and when the app declares no outDir', () => {
    expect(sharesOutputFolder('out-tsc/app', generated)).toBe(false)
    expect(sharesOutputFolder(undefined, generated)).toBe(false)
  })

  it('compares with Vite\'s own folder, not a fixed name', () => {
    expect(sharesOutputFolder('build', "build: { outDir: 'build' }")).toBe(true)
    expect(sharesOutputFolder('dist', "build: { outDir: 'build' }")).toBe(false)
  })
})
