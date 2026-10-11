/**
 * Rewrites the double-quoted strings of the `gem` lines of a `Gemfile` as single-quoted ones.
 *
 * @remarks
 * `bundle add` writes `gem "kit", "~> 0.1.0", path: "../../libs/kit"`, and the `.rubocop.yml` mnci writes (RuboCop's own
 * default) asks for single quotes where no interpolation or escape is needed, so every `mnci install` would have left the
 * project's `lint` failing on a line mnci itself wrote. Only a string with no `'`, `#{` or backslash is changed, and only on a
 * line that starts with `gem`, so a `Gemfile` the team formatted another way is otherwise untouched.
 *
 * @param text - The text of a `Gemfile`.
 * @returns The text with those strings single-quoted; the same text when there were none.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function singleQuoteGemLines (text: string): string {
  return text.replaceAll(/^[ \t]*gem\b.*$/gm, line => line.replaceAll(/"([^"'\\#]*)"/g, (_whole, body: string) => `'${body}'`))
}
