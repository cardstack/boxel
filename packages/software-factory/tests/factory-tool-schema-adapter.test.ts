import { module, test } from 'qunit';
import { z, type ZodObject } from 'zod';

import {
  adaptFactoryToolsToZod,
  jsonSchemaToZodShape,
} from '../src/factory-tool-schema-adapter';
import type { FactoryTool } from '../src/factory-tool-builder';

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
