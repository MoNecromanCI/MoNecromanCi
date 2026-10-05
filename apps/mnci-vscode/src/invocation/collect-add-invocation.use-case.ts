import type { CommandDescription, ProjectKindDescription, ProjectLanguage } from '../cli-contracts'
import { buildArguments } from './build-arguments.algorithm'
import { collectOptions, type Invocation } from './collect-invocation.use-case'
import type { PickEntry, Prompter } from './prompter.contract'

/** The order languages are listed in, with the heading each gets. */
const LANGUAGES: ReadonlyArray<readonly [ProjectLanguage, string]> = [
  ['typescript', 'TypeScript / JavaScript'],
  ['python', 'Python'],
  ['go', 'Go'],
  ['flutter', 'Flutter / Dart'],
  ['csharp', 'C# / .NET'],
]

/**
 * Lays the project kinds out for a picker, one heading per language.
 *
 * @remarks
 * Headings are separators, which a pick list never returns as an answer.
 *
 * @param kinds - The kinds the CLI reported.
 * @returns The entries; a language with no kind gets no heading.
 * @throws Never - pure list building.
 * @typeParam None - this function has no generic type parameters.
 */
export function kindEntries (kinds: readonly ProjectKindDescription[]): PickEntry[] {
  return LANGUAGES.flatMap(([language, heading]): PickEntry[] => {
    const ofLanguage = kinds.filter(kind => kind.language === language)

    return ofLanguage.length === 0
      ? []
      : [
          { separator: heading },
          ...ofLanguage.map(kind => ({ label: kind.label, description: kind.kind, detail: kind.description, value: kind.kind })),
        ]
  })
}

/**
 * Collects `mnci add`: which kind, what name, and only the flags that apply to that kind.
 *
 * @remarks
 * The kind list and the applicable flags come from the CLI (`mnci kinds --json`), so a new kind
 * appears here without a change to the extension. A flag the kind requires is asked without
 * being offered.
 *
 * @param add - The description of the `add` command.
 * @param kinds - The kinds the CLI reported.
 * @param prompter - How to ask.
 * @returns What to run, or `undefined` when the user cancelled.
 * @throws Never - cancellation is a result.
 * @typeParam None - this function has no generic type parameters.
 */
export async function collectAddInvocation (
  add: CommandDescription,
  kinds: readonly ProjectKindDescription[],
  prompter: Prompter,
): Promise<Invocation | undefined> {
  const kindName = await prompter.pickOne(kindEntries(kinds), 'What kind of project?')
  if (kindName === undefined) {
    return undefined
  }
  const kind = kinds.find(candidate => candidate.kind === kindName)
  const name = await prompter.askText(
    kindName === 'python-vendor' ? 'Name of the app that should vendor the library' : 'Project name',
    { required: true },
  )
  if (name === undefined) {
    return undefined
  }
  const options = await collectOptions(add, prompter, kind?.flags ?? [], kind?.requiredFlags ?? [])
  if (options === undefined) {
    return undefined
  }

  return { arguments: buildArguments('add', [kindName, name.trim()], options) }
}
