/** Relative specifiers in `from '...'`, `import '...'` and `export * from '...'`, single or double quoted. */
const RELATIVE_SPECIFIER = /((?:\bfrom|\bimport)\s*)(['"])(\.{1,2}\/[^'"\n]*|\.{1,2})\2/g

/** Extensions that already name a file, which the rewrite leaves alone. */
const HAS_EXTENSION = /\.(?:[cm]?js|json|node)$/

/**
 * Gives every relative import in a TypeScript source an explicit `.js` extension.
 *
 * @remarks
 * Under `"type": "module"` the `nodenext` resolution that TypeScript and Node both use needs the extension on
 * a relative specifier (TS2835 without it), and a directory has to name its `index.js`. The sources mnci writes
 * are the ones this runs on, where a directory import is known: pass them as `directories`. A specifier
 * that already ends in `.js`, `.mjs`, `.cjs` or `.json` is left alone, so running it twice changes nothing.
 *
 * @param source - The text of a `.ts` file.
 * @param directories - Relative specifiers that name a directory, such as `./hello`.
 * @returns The source with explicit extensions.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function withJsSpecifiers (source: string, directories: readonly string[] = []): string {
  return source.replaceAll(RELATIVE_SPECIFIER, (_match, lead: string, quote: string, specifier: string) => {
    if (HAS_EXTENSION.test(specifier)) {
      return `${lead}${quote}${specifier}${quote}`
    }
    const extended = directories.includes(specifier) ? `${specifier}/index.js` : `${specifier}.js`

    return `${lead}${quote}${extended}${quote}`
  })
}
