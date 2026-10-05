import type { PickEntry, PickItem, Prompter } from '../prompter.contract'

/**
 * A prompter that answers from a script and records what it was asked.
 *
 * @remarks
 * `answers` is consumed in order, one per question; an answer of `undefined` is the user
 * cancelling. A question asked beyond the script is a test error, so a flow that asks more
 * than the test expects fails loudly.
 *
 * @param answers - One answer per question, in the order they are asked.
 * @returns The prompter and the questions it was asked.
 * @throws Never - the prompter it returns throws when the script runs out.
 * @typeParam None - this function has no generic type parameters.
 */
export function scriptedPrompter (answers: ReadonlyArray<string | string[] | undefined>): { prompter: Prompter, asked: string[], entriesSeen: PickEntry[][] } {
  const asked: string[] = []
  const entriesSeen: PickEntry[][] = []
  let next = 0
  const take = (question: string): string | string[] | undefined => {
    asked.push(question)
    if (next >= answers.length) {
      throw new Error(`Unexpected question: ${question}`)
    }

    return answers[next++]
  }

  const prompter: Prompter = {
    pickOne: (entries: readonly PickEntry[], placeholder) => {
      entriesSeen.push([...entries])

      return Promise.resolve(take(placeholder) as string | undefined)
    },
    pickMany: (entries: readonly PickItem[], placeholder) => {
      entriesSeen.push([...entries])

      return Promise.resolve(take(placeholder) as string[] | undefined)
    },
    askText:    prompt => Promise.resolve(take(prompt) as string | undefined),
    pickFolder: title => Promise.resolve(take(title) as string | undefined),
  }

  return { prompter, asked, entriesSeen }
}
