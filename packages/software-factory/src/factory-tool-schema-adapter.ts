/**
 * Adapter that converts a FactoryTool's JSON-Schema `parameters` into a Zod
 * raw shape suitable for the Claude Agent SDK's `tool()` helper.
 *
 * Why this exists: the factory emits JSON Schema (what tool-use protocols
 * accept); the Claude Agent SDK's `createSdkMcpServer` +
 * `tool(name, desc, schema, execute)` API accepts a `ZodRawShape`
 * (`Record<string, ZodTypeAny>`). This module is the single seam between
 * the two so the rest of the factory can keep publishing JSON Schema. The
 * opencode-backed OpenRouter path consumes the JSON Schema directly and
 * never imports from this module.
 */

import { convertJsonSchemaToZod } from 'zod-from-json-schema';
import { z, type ZodObject, type ZodRawShape } from 'zod';

import type { FactoryTool } from './factory-tool-builder.ts';

/**
 * Convert a JSON-Schema parameter block into a Zod raw shape.
 *
 * We expect JSON Schemas of `type: 'object'`. `convertJsonSchemaToZod`
 * always returns a `ZodObject` for those; we project to `.shape` because
 * the Agent SDK's `tool(name, desc, schema, ...)` expects
 * `Record<string, ZodTypeAny>`, not a full `ZodObject`.
 *
 * Tools that declare no parameters still need *some* shape — an empty
 * object is the natural identity element.
 */
export function jsonSchemaToZodShape(
  schema: Record<string, unknown> | undefined,
): ZodRawShape {
  let effective = schema ?? { type: 'object', properties: {} };
  let normalized = normalizeFreeFormObjects(effective) as Record<
    string,
    unknown
  >;
  let zodType = convertJsonSchemaToZod(normalized);
  if (zodType instanceof z.ZodObject) {
    return (zodType as ZodObject).shape as ZodRawShape;
  }
  throw new Error(
    'Expected JSON Schema of type "object" for FactoryTool parameters; ' +
      `got Zod type ${zodType.constructor.name}.`,
  );
}

/**
 * Walk a JSON Schema and inject `additionalProperties: true` wherever a
 * node has `type: "object"` but no `properties` (and no
 * `additionalProperties`) defined.
 *
 * Without this, `convertJsonSchemaToZod({type:'object'})` produces a
 * `ZodCustom` (a runtime refinement) instead of a `ZodObject`. The Claude
 * Agent SDK's MCP tool enumeration silently drops tools whose schema
 * contains any `ZodCustom` child — connection stays "connected" but the
 * tool disappears from the model's tool list. Injecting
 * `additionalProperties: true` forces the converter to emit a proper
 * `ZodObject`, which serializes cleanly and appears in the tool list.
 *
 * The semantic intent of a bare `{type:'object'}` in a tool-parameter
 * JSON Schema is "free-form object" — so `additionalProperties: true`
 * (accept any keys) is the faithful translation.
 */
function normalizeFreeFormObjects(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalizeFreeFormObjects);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }
  let obj = node as Record<string, unknown>;
  let copy: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(obj)) {
    copy[key] = normalizeFreeFormObjects(value);
  }
  if (
    copy.type === 'object' &&
    !('properties' in copy) &&
    !('additionalProperties' in copy)
  ) {
    copy.additionalProperties = true;
  }
  return copy;
}

/**
 * Batch helper: adapt every FactoryTool's parameters to a Zod raw shape
 * and return a parallel array so call sites don't need to re-derive the
 * mapping.
 */
export function adaptFactoryToolsToZod(
  tools: FactoryTool[],
): { tool: FactoryTool; zodShape: ZodRawShape }[] {
  return tools.map((tool) => ({
    tool,
    zodShape: jsonSchemaToZodShape(tool.parameters),
  }));
}
