import QUnit from 'qunit';
const { module, test } = QUnit;
import { z, type ZodObject } from 'zod';

import {
  adaptFactoryToolsToZod,
  jsonSchemaToZodShape,
} from '../src/factory-tool-schema-adapter.ts';
import type { FactoryTool } from '../src/factory-tool-builder.ts';

function makeTool(
  name: string,
  parameters: Record<string, unknown>,
): FactoryTool {
  return {
    name,
    description: `test tool ${name}`,
    parameters,
    execute: async () => ({ ok: true }),
  };
}

/**
 * Return the set of property names on a ZodObject's shape — used to verify
 * the adapter preserved property keys. Typed as `Readonly<object>` so Zod
 * v4's `$ZodType`-internal shapes pass through without a cast.
 */
function shapeKeys(shape: Readonly<object>): string[] {
  return Object.keys(shape).sort();
}

module('factory-tool-schema-adapter', function () {
  test('converts a simple object schema to a ZodRawShape', function (assert) {
    let shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        foo: { type: 'string' },
        bar: { type: 'number' },
      },
      required: ['foo'],
    });

    assert.deepEqual(shapeKeys(shape), ['bar', 'foo']);

    // Wrapping the shape in z.object() + parsing proves the property types
    // survived the conversion.
    let parsed = z.object(shape).parse({ foo: 'hello', bar: 42 });
    assert.deepEqual(parsed, { foo: 'hello', bar: 42 });
  });

  test('handles missing parameters by returning an empty shape', function (assert) {
    let shape = jsonSchemaToZodShape(undefined);

    assert.deepEqual(Object.keys(shape), []);
    // Empty object still validates.
    assert.deepEqual(z.object(shape).parse({}), {});
  });

  test('respects enum constraints at parse time', function (assert) {
    let shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        color: { type: 'string', enum: ['red', 'green', 'blue'] },
      },
      required: ['color'],
    });

    let obj = z.object(shape) as ZodObject;
    assert.deepEqual(obj.parse({ color: 'red' }), { color: 'red' });
    assert.throws(() => obj.parse({ color: 'purple' }));
  });

  test('marks non-required properties as optional', function (assert) {
    let shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
      },
      required: ['a'],
    });

    let obj = z.object(shape) as ZodObject;
    // Only `a` is required; `b` may be omitted.
    assert.deepEqual(obj.parse({ a: 'yes' }), { a: 'yes' });
    assert.throws(() => obj.parse({ b: 'only' }));
  });

  test('throws when the top-level JSON Schema is not an object', function (assert) {
    assert.throws(
      () => jsonSchemaToZodShape({ type: 'string' }),
      /Expected JSON Schema of type "object"/,
    );
  });

  test('nested free-form {type:"object"} becomes a ZodObject, not a ZodCustom', function (assert) {
    // Regression guard for an Agent-SDK bug: when a FactoryTool parameter
    // is a bare `{type:"object"}` JSON Schema with no `properties`, the
    // underlying `convertJsonSchemaToZod` emits a `ZodCustom` refinement.
    // The Claude Agent SDK's MCP tool enumeration then silently drops every
    // tool in the server whose schema contains any such child — the MCP
    // connection stays "connected" but the tool list is empty, and the
    // model hallucinates a different tool set. The adapter normalizes free-
    // form objects before conversion so the resulting shape uses `ZodObject`
    // everywhere and the SDK serializes it cleanly.
    let shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        // Mirrors the real `search_realm` tool's `query` arg shape.
        query: {
          type: 'object',
          description: 'Search query object (filter, sort, page)',
        },
      },
      required: ['query'],
    });

    let queryField = (shape as Record<string, unknown>).query as {
      constructor: { name: string };
    };
    assert.strictEqual(
      queryField.constructor.name,
      'ZodObject',
      'free-form object property must be a ZodObject, not a ZodCustom',
    );
    // Round-trip parse: any object shape must pass through unchanged so the
    // agent's downstream code can consume it.
    let parsed = z
      .object(shape)
      .parse({ query: { filter: { on: { name: 'Spec' } } } });
    assert.deepEqual(parsed, {
      query: { filter: { on: { name: 'Spec' } } },
    });
  });

  test('deeply nested free-form object is normalized (adapter walks recursively)', function (assert) {
    let shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: {
            inner: {
              type: 'object',
              description: 'arbitrary JSON at the innermost layer',
            },
          },
          required: ['inner'],
        },
      },
      required: ['outer'],
    });

    let outerField = (shape as Record<string, unknown>).outer as {
      constructor: { name: string };
    };
    assert.strictEqual(outerField.constructor.name, 'ZodObject');

    // The real assertion: parsing the full nested object through our Zod
    // schema succeeds, meaning neither layer collapsed to ZodCustom.
    let parsed = z.object(shape).parse({
      outer: { inner: { whatever: 1, nested: { k: 'v' } } },
    });
    assert.deepEqual(parsed, {
      outer: { inner: { whatever: 1, nested: { k: 'v' } } },
    });
  });

  test('arrays-of-free-form-objects are also normalized', function (assert) {
    // Cover the array case too: the adapter's recursive walker must
    // descend into `items` (and any array index).
    let shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        list: {
          type: 'array',
          items: {
            type: 'object',
            description: 'free-form items',
          },
        },
      },
      required: ['list'],
    });

    let parsed = z.object(shape).parse({ list: [{ a: 1 }, { b: 'two' }] });
    assert.deepEqual(parsed, { list: [{ a: 1 }, { b: 'two' }] });
  });

  test('pre-existing additionalProperties is preserved verbatim', function (assert) {
    // If a schema already declares `additionalProperties`, the normalizer
    // must not overwrite it — otherwise stricter shapes would silently
    // loosen. `additionalProperties: false` translates to "strip unknown
    // keys" at parse time in Zod v4 — unknown keys are dropped rather than
    // thrown, but must not pass through. That contrast with the free-form
    // case (which passes unknown keys through as-is) is exactly what this
    // test guards.
    let strictShape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        strict_bag: {
          type: 'object',
          additionalProperties: false,
        },
      },
      required: ['strict_bag'],
    });
    let strictParsed = z
      .object(strictShape)
      .parse({ strict_bag: { extra: 'should-be-stripped' } });
    assert.deepEqual(
      strictParsed,
      { strict_bag: {} },
      'additionalProperties:false strips unknown keys',
    );

    // Baseline: a free-form object (handled by the normalizer) keeps
    // unknown keys. The two behaviors must remain distinct.
    let freeShape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        free_bag: { type: 'object' },
      },
      required: ['free_bag'],
    });
    let freeParsed = z
      .object(freeShape)
      .parse({ free_bag: { extra: 'should-be-kept' } });
    assert.deepEqual(
      freeParsed,
      { free_bag: { extra: 'should-be-kept' } },
      'free-form object passes unknown keys through',
    );
  });

  test('adaptFactoryToolsToZod returns one entry per input tool', function (assert) {
    let tools = [
      makeTool('first', {
        type: 'object',
        properties: { x: { type: 'string' } },
      }),
      makeTool('second', {
        type: 'object',
        properties: { y: { type: 'number' } },
      }),
    ];

    let adapted = adaptFactoryToolsToZod(tools);

    assert.strictEqual(adapted.length, 2);
    assert.strictEqual(adapted[0].tool, tools[0]);
    assert.deepEqual(shapeKeys(adapted[0].zodShape), ['x']);
    assert.strictEqual(adapted[1].tool, tools[1]);
    assert.deepEqual(shapeKeys(adapted[1].zodShape), ['y']);
  });
});
