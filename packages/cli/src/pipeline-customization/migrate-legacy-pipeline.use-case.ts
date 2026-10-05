import { readLegacyPipeline } from './legacy-pipeline-steps.algorithm'
import { commentOutPhases, injectSlots, type ChoosablePhase } from './pipeline-markers.algorithm'

/**
 * The result of {@link migrateLegacyPipeline}.
 *
 * @remarks
 * The notes are for the person running `mnci upgrade`, who should read them before committing.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface LegacyMigration {
  /** The new pipeline, with the team's steps in its slots. */
  text:  string
  /** What the user should know, one line each. */
  notes: string[]
}

/**
 * Moves what a team added to a pipeline written before mnci kept slots into the new pipeline.
 *
 * @remarks
 * The old file had no markers, so nothing says which steps are the team's. They are the steps mnci
 * does not recognise as its own (see `isGeneratedStep`); each goes into the slot nearest where it
 * sat, with the comments above it. A pack or release step the team had already deleted stays off.
 *
 * What cannot be carried over is said, not hidden: edits to a step mnci generated, and anything
 * outside the step list (triggers, variables, extra jobs). Both are in git history.
 *
 * @param legacy - The old file, with LF line endings.
 * @param generated - The freshly generated file.
 * @returns The new text and the notes for the user.
 * @throws Never - pure text work.
 * @typeParam None - this function has no generic type parameters.
 */
export function migrateLegacyPipeline (legacy: string, generated: string): LegacyMigration {
  const reading = readLegacyPipeline(legacy.split('\n'))
  const off: ChoosablePhase[] = []
  if (reading.kept.length > 0 || reading.hasPack || reading.hasRelease) {
    if (!reading.hasPack) {
      off.push('pack')
    }
    if (!reading.hasRelease) {
      off.push('release')
    }
  }
  const text = commentOutPhases(injectSlots(generated, reading.slots), off)
  const notes = [
    'This pipeline was written before mnci kept user slots, so it was regenerated. Edits to the steps mnci generated, and anything outside the step list (triggers, variables, extra jobs), are in git history.',
  ]
  if (reading.kept.length > 0) {
    notes.push(`Kept ${reading.kept.length} step${reading.kept.length === 1 ? '' : 's'} of your own in the new slots: ${reading.kept.join('; ')}. Check their order.`)
  }
  for (const phase of off) {
    notes.push(`The old pipeline had no ${phase} step, so the ${phase} phase is switched off.`)
  }

  return { text, notes }
}
