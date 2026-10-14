import astro from 'eslint-plugin-astro'
import { named } from './named.js'

/** An Astro file, and the script blocks `astro-eslint-parser` virtualises out of it (`page.astro/0.ts`). */
const ASTRO_FILES = ['**/*.astro', '**/*.astro/*.js', '**/*.astro/*.ts']

/**
 * Astro components: the frontmatter, the template and the `<script>` blocks.
 *
 * @remarks
 * `astro-eslint-parser` reads the whole `.astro` file and the plugin's `recommended` rules
 * cover correctness (`no-conflict-set-directives`, `no-unused-define-vars-in-style`, ...). Its
 * a11y family is left out: `jsx-a11y` is not in the workspace for non-React files, and the
 * plugin's own a11y rules need that plugin loaded for `.astro`. The preset's rules block names
 * no `files`, so each block is scoped to Astro files here, or it would run on every file.
 */
export default [
  ...named('mnci/astro', astro.configs['flat/recommended'])
    .map(block => ({
      ...block,
      // The preset's own names (`astro/base`) are kept as a suffix, under mnci's prefix.
      name:  `mnci/${block.name.replace(/^mnci\//, '')}`,
      files: block.files ?? ASTRO_FILES,
    })),
]
