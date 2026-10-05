/**
 * What the user keeps across `mnci upgrade` in a generated pipeline: slots for their own steps,
 * and phase blocks they may switch off.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only through this barrel.
 */

export * from './merge-pipeline.use-case'
export {
  CHOOSABLE_PHASES,
  PIPELINE_SLOTS,
  inspectPipeline,
  phaseEnd,
  phaseStart,
  slotMarkers,
} from './pipeline-markers.algorithm'
export type { ChoosablePhase, PipelineSlot } from './pipeline-markers.algorithm'
