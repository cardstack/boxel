import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  type BoxelDescription,
  type BoxelRenderRecord,
  type InstancePresentation,
  type ResolvedField,
} from '@cardstack/runtime-common';

export interface BuildBoxelRenderRecordInput {
  boxel: BoxelDescription;
  instanceId: string | null;
  fields: ResolvedField[];
  presentation: InstancePresentation;
}

/**
 * Assemble the execution-tier-neutral rendering input.
 *
 * All executable inspection happens before this function. Keeping the final
 * assembler pure makes the exact record consumed by Direct, Capsule, and
 * Sandbox straightforward to validate and version.
 */
export function buildBoxelRenderRecord(
  input: BuildBoxelRenderRecordInput,
): BoxelRenderRecord {
  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    boxel: input.boxel,
    instance: {
      id: input.instanceId,
      fields: input.fields,
    },
    presentation: input.presentation,
  };
}
