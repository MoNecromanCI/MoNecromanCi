/**
 * The names of the places in a generated pipeline that belong to the user.
 *
 * @remarks
 * A union of the literal names, so a generator cannot ask for a slot the merge does not know.
 *
 * @remarks
 * `mnci upgrade` rewrites the pipeline files, so a team has nowhere safe to add a step of its
 * own unless the generated file says where. Each slot is a pair of comment lines; whatever sits
 * between them is carried into the regenerated file untouched.
 *
 * - `after-install` runs right after `npm ci`, before any mnci phase.
 * - `before-release` runs after verify and pack, before the release phase.
 * - `after-release` runs last in the main job.
 */
export const PIPELINE_SLOTS = ['after-install', 'before-release', 'after-release'] as const

/**
 * A slot name from {@link PIPELINE_SLOTS}.
 *
 * @remarks
 * A union of the literal names, so a generator cannot ask for a slot the merge does not know.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type PipelineSlot = typeof PIPELINE_SLOTS[number]

/**
 * The phases a team may switch off.
 *
 * @remarks
 * `verify` is deliberately absent: it is the enforced core, and `mnci doctor` fails when its call
 * is gone. A phase added to the generators later needs its own handling here, because a phase
 * missing from an older file would otherwise read as one the team removed.
 */
export const CHOOSABLE_PHASES = ['pack', 'release'] as const

/**
 * A phase name from {@link CHOOSABLE_PHASES}.
 *
 * @remarks
 * A union of the literal names, so only phases the merge knows how to switch off can be asked for.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type ChoosablePhase = typeof CHOOSABLE_PHASES[number]

const SLOT_BEGIN = /^(\s*)# mnci:slot (\S+)/
const SLOT_END = /^\s*# mnci:slot-end \S+/
const PHASE_BEGIN = /^(\s*)# mnci:phase (\S+)/
const PHASE_END = /^\s*# mnci:phase-end (\S+)/

/** The line that tells the reader a phase block was switched off. */
const SWITCHED_OFF_HINT = '# mnci: switched off. Uncomment the lines below to run it again (mnci doctor lists it).'

/**
 * The two marker lines of a user slot, for the generators to embed.
 *
 * @remarks
 * The text between the two lines is the user's: {@link extractSlots} lifts it out of the file being
 * replaced and {@link injectSlots} puts it into the new one.
 *
 * @param name - The slot.
 * @param indent - The indentation of the step list the slot sits in.
 * @returns The begin and end lines, newline-separated, with no trailing newline.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function slotMarkers (name: PipelineSlot, indent: string): string {
  return [
    `${indent}# mnci:slot ${name}  (your own steps go between these two lines; mnci upgrade keeps them)`,
    `${indent}# mnci:slot-end ${name}`,
  ].join('\n')
}

/**
 * The line that opens a phase block.
 *
 * @remarks
 * Paired with {@link phaseEnd}. Everything between them is one phase's steps, which is what
 * {@link commentOutPhases} switches off.
 *
 * @param name - The phase.
 * @param indent - The indentation of the step list the block sits in.
 * @returns The marker line.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function phaseStart (name: ChoosablePhase, indent: string): string {
  return `${indent}# mnci:phase ${name}  (delete or comment this block to switch it off; mnci upgrade keeps it off)`
}

/**
 * The line that closes a phase block.
 *
 * @remarks
 * Closes the block {@link phaseStart} opened, so a phase's steps can be found without reading YAML.
 *
 * @param name - The phase.
 * @param indent - The indentation of the step list the block sits in.
 * @returns The marker line.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function phaseEnd (name: ChoosablePhase, indent: string): string {
  return `${indent}# mnci:phase-end ${name}`
}

/**
 * What the user wrote inside each slot, with the slot's indentation removed.
 *
 * @remarks
 * Indentation is stripped so the contents can be re-indented when the new file nests its steps
 * deeper, as Azure Pipelines does once a native job moves them under `jobs:`.
 *
 * @param text - A pipeline file.
 * @returns The lines of each slot found, keyed by slot name.
 * @throws Never - an unclosed slot is read to the end of the file.
 * @typeParam None - this function has no generic type parameters.
 */
export function extractSlots (text: string): Map<string, string[]> {
  const slots = new Map<string, string[]>()
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const begin = SLOT_BEGIN.exec(lines[index])
    if (!begin) {
      continue
    }
    const [, indent, name] = begin
    const content: string[] = []
    for (index++; index < lines.length && !SLOT_END.test(lines[index]); index++) {
      content.push(lines[index].startsWith(indent) ? lines[index].slice(indent.length) : lines[index].trimStart())
    }
    slots.set(name, content)
    index--
  }

  return slots
}

/**
 * Puts the user's slot contents into a freshly generated pipeline.
 *
 * @remarks
 * Slots are matched by name. Whatever the generator put between a slot's markers is replaced.
 *
 * @param generated - The generated file, with empty slots.
 * @param slots - What {@link extractSlots} found in the file being replaced.
 * @returns The generated file with each slot refilled, at the new file's indentation.
 * @throws Never - a slot the new file does not have is dropped, one it has but the old did not is left empty.
 * @typeParam None - this function has no generic type parameters.
 */
export function injectSlots (generated: string, slots: Map<string, string[]>): string {
  const lines = generated.split('\n')
  const result: string[] = []
  for (let index = 0; index < lines.length; index++) {
    result.push(lines[index])
    const begin = SLOT_BEGIN.exec(lines[index])
    if (!begin) {
      continue
    }
    const [, indent, name] = begin
    const content = slots.get(name) ?? []
    for (const line of content) {
      result.push(line === '' ? '' : `${indent}${line}`)
    }
    // Skip whatever the generator itself put between the markers (nothing today).
    while (index + 1 < lines.length && !SLOT_END.test(lines[index + 1])) {
      index++
    }
  }

  return result.join('\n')
}

/**
 * Which phase blocks the file has switched off.
 *
 * @remarks
 * A block counts as off when its markers are gone altogether, or when every line between them is
 * a comment. A file with no marker at all is not asked: it predates the markers, and guessing
 * there would switch everything off.
 *
 * @param text - A pipeline file.
 * @returns The phases that are off, in {@link CHOOSABLE_PHASES} order.
 * @throws Never - pure text reading.
 * @typeParam None - this function has no generic type parameters.
 */
export function switchedOffPhases (text: string): ChoosablePhase[] {
  const lines = text.split('\n')
  if (lines.every(line => !(PHASE_BEGIN.test(line) || SLOT_BEGIN.test(line)))) {
    return []
  }

  return CHOOSABLE_PHASES.filter(phase => {
    const begin = lines.findIndex(line => PHASE_BEGIN.exec(line)?.[2] === phase)
    if (begin === -1) {
      return true
    }
    for (let index = begin + 1; index < lines.length && PHASE_END.exec(lines[index])?.[1] !== phase; index++) {
      const line = lines[index].trim()
      if (line !== '' && !line.startsWith('#')) {
        return false
      }
    }

    return true
  })
}

/**
 * Comments out the named phase blocks of a generated pipeline.
 *
 * @remarks
 * Only lines that are not already comments are prefixed, so the block's own explanations stay as
 * they were and the commented steps can be restored by deleting the `# ` in front of them.
 *
 * @param generated - The generated file.
 * @param phases - The phases to switch off.
 * @returns The file with each block's steps commented out under a one-line hint.
 * @throws Never - a phase without a block is left alone.
 * @typeParam None - this function has no generic type parameters.
 */
export function commentOutPhases (generated: string, phases: readonly ChoosablePhase[]): string {
  if (phases.length === 0) {
    return generated
  }
  const lines = generated.split('\n')
  const result: string[] = []
  for (let index = 0; index < lines.length; index++) {
    result.push(lines[index])
    const begin = PHASE_BEGIN.exec(lines[index])
    if (!begin || !phases.includes(begin[2] as ChoosablePhase)) {
      continue
    }
    const [, indent, name] = begin
    result.push(`${indent}${SWITCHED_OFF_HINT}`)
    for (index++; index < lines.length && PHASE_END.exec(lines[index])?.[1] !== name; index++) {
      const line = lines[index]
      result.push(line.trim() === '' || line.trimStart().startsWith('#') ? line : `${indent}# ${line.slice(indent.length)}`)
    }
    index--
  }

  return result.join('\n')
}

/**
 * What a pipeline file says about the parts mnci cares about.
 *
 * @remarks
 * Used by `mnci doctor`: a missing verify call fails, a switched-off phase only warns.
 *
 * @param text - A pipeline file.
 * @returns Whether the enforced verify call is active, and which choosable phases are off.
 * @throws Never - pure text reading.
 * @typeParam None - this function has no generic type parameters.
 */
export function inspectPipeline (text: string): { verifyActive: boolean; switchedOff: ChoosablePhase[] } {
  return {
    verifyActive: text.split('\n').some(line => !line.trimStart().startsWith('#') && /\bci verify\b/.test(line)),
    switchedOff:  switchedOffPhases(text),
  }
}
