import { createRequire } from 'node:module'
import tsParser from '@typescript-eslint/parser'
import { named } from './named.js'

/**
 * Whether `svelte` resolves from where `eslint-plugin-svelte` is installed.
 *
 * @remarks
 * The plugin imports `svelte` while it loads, so importing it in a workspace with no Svelte
 * project (the usual one) would fail the whole lint with `ERR_MODULE_NOT_FOUND`. `svelte` is an
 * optional peer: it is there only when a `svelte-app` installed it, and the plugin looks for it
 * from its own place in `node_modules`, which is the same place this file looks from.
 *
 * @returns `true` when `svelte` can be imported.
 */
function svelteIsInstalled () {
  try {
    createRequire(import.meta.url).resolve('svelte/package.json')

    return true
  } catch {
    return false
  }
}

/**
 * Svelte components: the template and the `<script lang="ts">` block.
 *
 * @remarks
 * `svelte-eslint-parser` reads the whole `.svelte` file and hands the script to the
 * TypeScript parser, so the generic JavaScript rules reach the script too. Only the
 * plugin's `recommended` rules are on (correctness and a11y); its stylistic family is
 * not, because `mnci/standard` is the one formatting opinion and `.svelte` markup is
 * not Standard Style's to format. The blocks exist only when `svelte` is installed
 * (see `svelteIsInstalled`), and match `.svelte` files only.
 */
const SVELTE_FILES = ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js']

const plugin = svelteIsInstalled() ? await import('eslint-plugin-svelte') : undefined
const recommended = plugin?.default.configs['flat/recommended']

const blocks = recommended === undefined
  ? []
  : [
      // The preset's rules block names no `files`, so left alone it would run its rules on every
      // file in the workspace, Markdown included, where they throw for want of a Svelte parser.
      ...named('mnci/svelte/recommended', recommended)
        .map(block => ({ ...block, files: block.files ?? SVELTE_FILES })),
      {
        name:            'mnci/svelte',
        files:           SVELTE_FILES,
        languageOptions: { parserOptions: { parser: tsParser } },
        // The compiler's own diagnostics: a11y (`<img>` with no `alt`, a link with no target)
        // and unused declarations, which no other rule sees inside a template.
        rules:           { 'svelte/valid-compile': 'error' },
      },
    ]

export default blocks
