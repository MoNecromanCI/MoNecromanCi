import { checkbox, confirm, input, select, Separator } from '@inquirer/prompts'
import type { Prompter, PromptChoice } from './prompter.contract'

/** What `@inquirer/prompts` takes as one row of a pick. */
type Row = Separator | { name: string, value: string, description?: string }

/**
 * Turns the wizard's choices into what `@inquirer/prompts` takes.
 *
 * @remarks
 * A choice that names a new `group` is preceded by a heading line, so the pick reads in sections.
 *
 * @param choices - The choices.
 * @returns The rows to show.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function toRows (choices: readonly PromptChoice[]): Row[] {
  const rows: Row[] = []
  let current: string | undefined
  for (const choice of choices) {
    if (choice.group !== undefined && choice.group !== current) {
      current = choice.group
      rows.push(new Separator(`-- ${choice.group} --`))
    }
    rows.push({ name: choice.name, value: choice.value, description: choice.description })
  }

  return rows
}

/**
 * The real prompter, on `@inquirer/prompts`.
 *
 * @remarks
 * The only file of the wizard that imports the prompt library, so the rest of the flow is tested by answering
 * through the {@link Prompter} interface.
 *
 * @param None - this function takes no parameters.
 * @returns A prompter that asks on the terminal.
 * @throws Never - the questions it asks throw when stdin is not a terminal.
 * @typeParam None - this function has no generic type parameters.
 */
export function createInquirerPrompter (): Prompter {
  return {
    select:   async (message, choices) => await select<string>({ message, choices: toRows(choices), pageSize: 18 }),
    checkbox: async (message, choices) => await checkbox<string>({ message, choices: toRows(choices), pageSize: 18 }),
    input:    async (message, required) => await input({ message, validate: (value: string) => !required || value.trim().length > 0 || 'A value is required' }),
    confirm:  async (message, fallback) => await confirm({ message, default: fallback }),
  }
}
