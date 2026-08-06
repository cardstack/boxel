import {
  BOXEL_EXECUTION_PROTOCOL_VERSION,
  type BoxelDescription,
  type JSONValue,
  type BoxelRenderRecord,
  type InstancePresentation,
  type ResolvedField,
} from '@cardstack/runtime-common';

export interface BuildBoxelRenderRecordInput {
  boxel: BoxelDescription;
  instanceId: string | null;
  fields: ResolvedField[];
  presentation: InstancePresentation;
  /**
   * JSON-safe getter results evaluated by the runtime that owns the
   * executable definition (RP-4.4). Declared field values and the instance id
   * always win over an extension of the same name, so every tier's model
   * carries identical declared-field projections.
   */
  modelExtensions?: Record<string, JSONValue>;
}

/**
 * Assemble the execution-tier-neutral rendering input.
 *
 * This is the one assembly point for `BoxelRenderRecord`: the model is
 * derived here from the resolved fields rather than supplied per tier, so
 * Direct, Capsule, and Sandbox cannot disagree about the model's declared
 * values. All executable inspection happens before this function; keeping the
 * final assembler pure makes the exact record consumed by every tier
 * straightforward to validate and version.
 */
export function buildBoxelRenderRecord(
  input: BuildBoxelRenderRecordInput,
): BoxelRenderRecord {
  let model = structuredClone({
    ...(input.modelExtensions ?? {}),
    ...Object.fromEntries(
      input.fields.map((field) => [field.fieldName, field.value]),
    ),
  }) as Record<string, JSONValue>;
  if (input.instanceId) {
    model.id = input.instanceId;
  }
  return {
    protocolVersion: BOXEL_EXECUTION_PROTOCOL_VERSION,
    boxel: input.boxel,
    instance: {
      id: input.instanceId,
      model,
      fields: structuredClone(input.fields),
    },
    presentation: input.presentation,
  };
}
