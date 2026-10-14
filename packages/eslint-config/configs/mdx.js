import * as mdx from 'eslint-plugin-mdx'

/**
 * `.mdx` documents: the Markdown, the JSX and the code fences inside them.
 *
 * @remarks
 * `eslint-plugin-mdx`'s own preset also claims `.md`, which `mnci/markdown` (`@eslint/markdown`)
 * owns, so both blocks are narrowed to `.mdx`. The preset also switches on
 * `react/react-in-jsx-scope`, a rule from a plugin this workspace does not load (the React
 * rules are `@eslint-react`'s), and an unknown rule is a config error, so it is dropped.
 */
const { 'react/react-in-jsx-scope': _unused, ...rules } = mdx.flat.rules

export default [
  {
    ...mdx.flat,
    name:      'mnci/mdx',
    files:     ['**/*.mdx'],
    // Without this the code fences are never handed to ESLint as files of their own.
    processor: mdx.createRemarkProcessor({ lintCodeBlocks: true }),
    rules,
  },
  {
    ...mdx.flatCodeBlocks,
    name:  'mnci/mdx/code-blocks',
    files: ['**/*.mdx/**'],
    // A snippet in documentation declares what it shows and rarely uses it.
    rules: {
      ...mdx.flatCodeBlocks.rules,
      'unused-imports/no-unused-vars':    'off',
      'unused-imports/no-unused-imports': 'off',
    },
  },
]
