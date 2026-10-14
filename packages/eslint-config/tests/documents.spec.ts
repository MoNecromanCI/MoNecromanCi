import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The `.astro` and `.mdx` blocks stay inside their own files.
 *
 * @remarks
 * Both presets ship a block with no `files`, and `eslint-plugin-mdx` also claims `.md`, which
 * `@eslint/markdown` owns. A subprocess, because this package is ESM and these specs run as CJS
 * under ts-jest (see `config.spec.ts`).
 */
const packageRoot = join(__dirname, '..')

/** One composed block, reduced to what these checks read. */
interface BlockSummary {
  name:  string
  files: string[] | null
}

/**
 * Resolves the config and reports the Astro and MDX blocks.
 *
 * @returns The blocks whose name starts with `mnci/astro` or `mnci/mdx`.
 * @throws If the subprocess writes no JSON.
 */
function documentBlocks (): BlockSummary[] {
  const script = `
    const mnci = (await import(${JSON.stringify(pathToFileURL(join(packageRoot, 'index.js')).href)})).default
    const blocks = mnci({}).filter(block => String(block.name).startsWith('mnci/astro') || String(block.name).startsWith('mnci/mdx'))
    process.stdout.write(JSON.stringify(blocks.map(block => ({ name: block.name, files: block.files ?? null }))))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  const stdout = result.stdout?.trim()
  if (!stdout?.startsWith('[')) {
    throw new Error(`could not resolve the config.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  }

  return JSON.parse(stdout) as BlockSummary[]
}

describe('the Astro and MDX blocks', () => {
  const blocks = documentBlocks()

  it('are composed', () => {
    expect(blocks.some(block => block.name.startsWith('mnci/astro'))).toBe(true)
    expect(blocks.some(block => block.name === 'mnci/mdx')).toBe(true)
  })

  it('all name the files they apply to', () => {
    expect(blocks.filter(block => block.files === null)).toEqual([])
  })

  it('leave .md to the markdown block', () => {
    const everything = blocks.flatMap(block => block.files ?? [])

    expect(everything.filter(pattern => pattern.includes('.md') && !pattern.includes('.mdx'))).toEqual([])
  })
})
