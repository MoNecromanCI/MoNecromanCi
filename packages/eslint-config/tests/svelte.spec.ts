import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The Svelte blocks load only when `svelte` is installed.
 *
 * @remarks
 * `eslint-plugin-svelte` imports `svelte` while it loads, so composing it in a workspace with
 * no Svelte project would fail every lint with `ERR_MODULE_NOT_FOUND`. A subprocess, because
 * this package is ESM and these specs run as CJS under ts-jest (see `config.spec.ts`).
 */
const packageRoot = join(__dirname, '..')

/**
 * Resolves the config and reports whether `svelte` resolves and which Svelte blocks came out.
 *
 * @returns The Svelte block names and whether `svelte` was installed.
 * @throws If the subprocess writes no JSON.
 */
function svelteBlocks (): { installed: boolean, names: string[], unscoped: string[] } {
  const script = `
    import { createRequire } from 'node:module'
    const mnci = (await import(${JSON.stringify(pathToFileURL(join(packageRoot, 'index.js')).href)})).default
    const blocks = mnci({}).filter(block => String(block.name).startsWith('mnci/svelte'))
    let installed = true
    try { createRequire(${JSON.stringify(pathToFileURL(join(packageRoot, 'configs', 'svelte.js')).href)}).resolve('svelte/package.json') } catch { installed = false }
    process.stdout.write(JSON.stringify({
      installed,
      names: blocks.map(block => block.name),
      unscoped: blocks.filter(block => block.files === undefined).map(block => block.name),
    }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  const stdout = result.stdout?.trim()
  if (!stdout?.startsWith('{')) {
    throw new Error(`could not resolve the config.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  }

  return JSON.parse(stdout) as { installed: boolean, names: string[], unscoped: string[] }
}

describe('the Svelte blocks', () => {
  const { installed, names, unscoped } = svelteBlocks()

  it('are composed only when svelte is installed', () => {
    expect(names.length > 0).toBe(installed)
  })

  it('never apply to a file that is not a Svelte file', () => {
    // An unscoped rules block runs on Markdown too, and throws there for want of a Svelte parser.
    expect(unscoped).toEqual([])
  })
})
