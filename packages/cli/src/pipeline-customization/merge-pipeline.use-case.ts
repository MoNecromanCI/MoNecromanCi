import { migrateLegacyPipeline } from './migrate-legacy-pipeline.use-case'
import { commentOutPhases, extractSlots, injectSlots, switchedOffPhases } from './pipeline-markers.algorithm'

/**
 * The result of {@link mergePipeline}.
 *
 * @remarks
 * The notes are for the person running `mnci upgrade`, who should see them before committing.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface MergedPipeline {
  /** The file to write. */
  text:  string
  /** A line for the user when something they should look at happened. */
  notes: string[]
}

/**
 * Regenerates a pipeline file without losing what the team put in its slots or switched off.
 *
 * @remarks
 * `mnci upgrade` rewrites the whole file, which is why a pipeline carries markers: the user's slot
 * contents are lifted out of the file being replaced and put back into the new one, and a phase
 * block the team removed or commented out stays commented out. Everything outside the slots is
 * mnci's and is regenerated.
 *
 * A file with no markers is one written before they existed. It is regenerated, and the steps in it that
 * mnci did not write are moved into the slots (see `migrateLegacyPipeline`); what cannot be carried
 * over is reported.
 *
 * @param existing - The file being replaced, or `undefined` when there is none.
 * @param generated - The freshly generated file.
 * @returns The text to write and any notes for the user.
 * @throws Never - pure text work.
 * @typeParam None - this function has no generic type parameters.
 */
export function mergePipeline (existing: string | undefined, generated: string): MergedPipeline {
  if (existing === undefined) {
    return { text: generated, notes: [] }
  }
  const normalized = existing.replaceAll('\r\n', '\n')
  if (!/^\s*# mnci:(?:slot|phase) /m.test(normalized)) {
    return migrateLegacyPipeline(normalized, generated)
  }
  const off = switchedOffPhases(normalized)
  const text = commentOutPhases(injectSlots(generated, extractSlots(normalized)), off)

  return {
    text,
    notes: off.map(phase => `The ${phase} phase is switched off in this pipeline and stays off.`),
  }
}
