/**
 * The `astro.config.mjs` of a docs site: Starlight, titled after the project.
 *
 * @remarks
 * Replaces the template's, which links to Starlight's own GitHub repository and names the site "My Docs".
 *
 * @param title - The site's title.
 * @returns The file contents.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function docsSiteAstroConfig (title: string): string {
  return [
    "import starlight from '@astrojs/starlight'",
    "import { defineConfig } from 'astro/config'",
    '',
    'export default defineConfig({',
    '  integrations: [',
    '    starlight({',
    `      title: ${JSON.stringify(title)},`,
    '      sidebar: [',
    "        { label: 'Guides', items: [{ label: 'Getting started', slug: 'guides/getting-started' }] },",
    "        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },",
    '      ],',
    '    }),',
    '  ],',
    '})',
    '',
  ].join('\n')
}

/**
 * The pages of a docs site, as paths under `src/content/docs` to contents.
 *
 * @remarks
 * A landing page, one guide and one reference page: enough to show the sidebar's two groups. The template's landing page
 * is replaced because it embeds Starlight's mascot image and promotional links.
 *
 * @param title - The site's title.
 * @returns The files to write.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function docsSitePages (title: string): Record<string, string> {
  return {
    'index.mdx': [
      '---',
      `title: ${title}`,
      `description: Documentation for ${title}.`,
      'template: splash',
      'hero:',
      `  tagline: Documentation for ${title}.`,
      '  actions:',
      '    - text: Getting started',
      '      link: /guides/getting-started/',
      '      icon: right-arrow',
      '---',
      '',
    ].join('\n'),
    'guides/getting-started.md': [
      '---',
      'title: Getting started',
      'description: What this project is and how to run it.',
      '---',
      '',
      'Write the first guide here. Pages are Markdown or MDX files under `src/content/docs`; the sidebar is in',
      '`astro.config.mjs`.',
      '',
    ].join('\n'),
    'reference/overview.md': [
      '---',
      'title: Overview',
      'description: The reference section.',
      '---',
      '',
      'Files in `src/content/docs/reference` appear in this group of the sidebar by themselves.',
      '',
    ].join('\n'),
  }
}
