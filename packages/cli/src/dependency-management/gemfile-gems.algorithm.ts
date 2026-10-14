/** One `gem 'name', ...` line: the name and what follows it. */
const GEM_LINE = /^(?<lead>\s*gem\s+(?<quote>['"])(?<name>[^'"]+)\k<quote>)(?<rest>.*)$/

/** A leading version constraint argument: an optional operator, then a version. */
const CONSTRAINT = /^\s*,\s*(?<quote>['"])(?<operator>~>|>=|<=|!=|[=><])?\s*(?<version>\d[\w.]*)\k<quote>/

/**
 * One gem read from a `Gemfile`.
 *
 * @remarks
 * What `mnci sync` and `mnci up` need of a declaration: the name, the constraint, the group and whether it may be edited.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface GemDeclaration {
  /** The gem name. */
  name:       string
  /** The constraint with no space after its operator (`~>1.2`). */
  spec:       string
  /** `devDep` inside a `group` block or with a `group:` option, `dep` otherwise. */
  section:    'dep' | 'devDep'
  /** Whether {@link replaceGemSpec} may edit it: exactly one constraint, and not a `path:` or `git:` source. */
  rewritable: boolean
}

/**
 * Reads the gems a `Gemfile` declares.
 *
 * @remarks
 * Line by line, because a Gemfile is Ruby and only its `gem` lines are data. A gem with no constraint is not reported
 * (there is nothing to compare), one with two (`'>= 1', '< 3'`) is not rewritable, and a `path:`, `git:` or `github:`
 * source is a sibling or a pinned checkout, so it is never rewritten. A `gemspec` line's dependencies are not read.
 *
 * @param text - The text of a `Gemfile`.
 * @returns One entry per gem that declares a version constraint.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function gemfileGems (text: string): GemDeclaration[] {
  const gems: GemDeclaration[] = []
  // One entry per open block, true for a `group ... do`, so an `end` closes the right one.
  const blocks: boolean[] = []
  for (const line of text.split(/\r?\n/)) {
    const code = line.replace(/\s#.*$/, '')
    if (/^\s*group\s.*\bdo\b/.test(code)) {
      blocks.push(true)
      continue
    }
    if (/\bdo\s*(?:\|[^|]*\|\s*)?$/.test(code) || /^\s*(?:if|unless|case|begin)\b/.test(code)) {
      blocks.push(false)
      continue
    }
    if (/^\s*end\b/.test(code)) {
      blocks.pop()
      continue
    }
    const match = GEM_LINE.exec(code)
    if (match?.groups === undefined) {
      continue
    }
    const { name, rest } = match.groups
    const first = CONSTRAINT.exec(rest)
    if (first?.groups === undefined) {
      continue
    }
    const second = CONSTRAINT.exec(rest.slice(first[0].length))
    const sourced = /\b(?:path|git|github|gist|bitbucket|source):|:(?:path|git|github)\s*=>/.test(rest)
    gems.push({
      name,
      spec:       `${first.groups.operator ?? ''}${first.groups.version}`,
      section:    blocks.includes(true) || /\bgroup:|:group\s*=>/.test(rest) ? 'devDep' : 'dep',
      rewritable: second === null && !sourced && first.groups.operator !== '!=',
    })
  }

  return gems
}

/**
 * Replaces one gem's constraint in a `Gemfile`, keeping its quotes and spacing.
 *
 * @remarks
 * `spec` arrives without a space after the operator (`~>2.0.0`, the way {@link gemfileGems} reports it) and is written
 * Ruby's way, `'~> 2.0.0'`. Only the first constraint on the gem's own line moves.
 *
 * @param text - The text of a `Gemfile`.
 * @param name - The gem name.
 * @param spec - The new constraint.
 * @returns The new text, or the text unchanged when no line declares that gem with a constraint.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function replaceGemSpec (text: string, name: string, spec: string): string {
  const escaped = name.replaceAll(/[$()*+.?[\\\]^{|}-]/g, String.raw`\$&`)
  const pattern = new RegExp(
    String.raw`^(\s*gem\s+(['"])${escaped}\2\s*,\s*(['"]))(?:~>|>=|<=|!=|=|>|<)?\s*\d+(?:\.\d+)*[\w.]*(\3)`,
    'm',
  )
  const operator = /^(~>|>=|<=|!=|[=><])?/.exec(spec)?.[1] ?? ''
  const written = operator === '' ? spec : `${operator} ${spec.slice(operator.length)}`

  return text.replace(pattern, (_whole, head: string, _quote: string, _constraintQuote: string, close: string) => `${head}${written}${close}`)
}

/**
 * The version in `gem list --remote --exact <gem>` output.
 *
 * @remarks
 * A line reads `rack (3.1.8)`, or `nokogiri (1.18.3 ruby)` when the gem ships platform builds; a pre-release is not listed
 * unless asked for.
 *
 * @param output - The command's standard output.
 * @param name - The gem name.
 * @returns The version, or `undefined` when the output has no line for that gem.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function newestGemVersion (output: string, name: string): string | undefined {
  const escaped = name.replaceAll(/[$()*+.?[\\\]^{|}-]/g, String.raw`\$&`)

  return new RegExp(String.raw`^${escaped} \((\d[^\s,)]*)`, 'm').exec(output)?.[1]
}
