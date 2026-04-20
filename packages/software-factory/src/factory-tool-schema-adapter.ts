/**
 * Adapter that converts a FactoryTool's JSON-Schema `parameters` into a Zod
 * raw shape suitable for the Claude Agent SDK's `tool()` helper.
 *
 * Why this exists: the factory emits JSON Schema (what OpenRouter's tool-use
 * protocol accepts); the Claude Agent SDK's `createSdkMcpServer` +
 * `tool(name, desc, schema, execute)` API accepts a `ZodRawShape`
 * (`Record<string, ZodTypeAny>`). This module is the single seam between
 * the two so the rest of the factory can keep publishing JSON Schema.
 *
 * Invariant: the OpenRouter path (`ToolUseFactoryAgent`) never imports from
 * this module. The cross-backend schema-boundary test in
 * `tests/factory-agent-schema-boundary.test.ts` asserts this explicitly.
 */

import { convertJsonSchemaToZod } from 'zod-from-json-schema';
import { z, type ZodObject, type ZodRawShape } from 'zod';

import type { FactoryTool } from './factory-tool-builder';

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
  let zodType = convertJsonSchemaToZod(effective);
  if (zodType instanceof z.ZodObject) {
    return (zodType as ZodObject).shape as ZodRawShape;
  }
  throw new Error(
    'Expected JSON Schema of type "object" for FactoryTool parameters; ' +
      `got Zod type ${zodType.constructor.name}.`,
  );
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
