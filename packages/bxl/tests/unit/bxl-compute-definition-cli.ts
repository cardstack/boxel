import assert from 'node:assert/strict';
import { bxl, getBxlComputeDefinition, prepareBxl } from '../../src/index.ts';

const libraries: Array<'core'> = ['core'];
const compute = bxl('Score * 2', { libraries });
const definition = getBxlComputeDefinition(compute)!;
assert.equal(definition.expression, '.score * 2');
assert.deepEqual(definition.libraries, ['core']);
assert.deepEqual(definition.deps, ['score']);
assert.equal(definition.materializesClass, false);
assert.equal(definition.customRuntimeLimits, false);
assert.equal(
  prepareBxl(definition.expression, {
    libraries: definition.libraries,
    readableSyntax: false,
  }).evaluate({ score: 7 }).value,
  compute.call({ score: 7 }),
);

definition.libraries.length = 0;
definition.deps.push('fake');
definition.expression = '99';
libraries.length = 0;
assert.deepEqual(getBxlComputeDefinition(compute)!.libraries, ['core']);
assert.deepEqual(getBxlComputeDefinition(compute)!.deps, ['score']);
assert.equal(getBxlComputeDefinition(compute)!.expression, '.score * 2');

let invoked = false;
const fake = () => {
  invoked = true;
  return 99;
};
Object.defineProperty(fake, 'bxl', {
  get() {
    throw new Error('Must not inspect a public marker');
  },
});
assert.equal(getBxlComputeDefinition(fake), undefined);
assert.equal(invoked, false);
assert.equal(
  getBxlComputeDefinition(() => compute.call({ score: 1 })),
  undefined,
);
assert.equal(getBxlComputeDefinition(null), undefined);

assert.equal(
  getBxlComputeDefinition(bxl('.', { as: class {} }))!.materializesClass,
  true,
);
assert.equal(
  getBxlComputeDefinition(bxl('1', { runtimeLimits: { maxSteps: 10 } }))!
    .customRuntimeLimits,
  true,
);
console.log(
  'BXL compute definitions: canonical program, detached metadata, authentic factory identity and unsupported options verified',
);
