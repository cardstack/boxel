import * as babel from '@babel/core';
import typescriptPlugin from '@babel/plugin-transform-typescript';
import * as ContentTag from 'content-tag';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const iterations = Number(
  process.env.BOXEL_SIMPLIFICATION_BENCH_ITERATIONS ?? 100,
);
const rounds = Number(process.env.BOXEL_SIMPLIFICATION_BENCH_ROUNDS ?? 9);

const source = `
  import { CardDef } from '@cardstack/base/card-api';
  export class CanvasCard extends CardDef {
    element?: HTMLElement;
    static isolated = class {
      context = document.createElement('canvas').getContext('2d');
      <template><canvas class="preview"></canvas></template>
    };
  }
`;
const javascript = source.replace(/<template>[\s\S]*<\/template>/, '');
const browserGlobals = ['HTMLElement', 'document'];
const domMethods = ['getContext'];

function transform(visitors) {
  babel.transformSync(javascript, {
    filename: 'boxel-source.ts',
    babelrc: false,
    configFile: false,
    compact: true,
    plugins: [
      [typescriptPlugin, { allowDeclareFields: true }],
      { visitor: visitors },
    ],
    parserOpts: { plugins: ['decorators-legacy'] },
  });
}

function collectGlobals(result) {
  return {
    ReferencedIdentifier(path) {
      let name = path.node.name;
      if (browserGlobals.includes(name) && !path.scope.hasBinding(name)) {
        result.add(name);
      }
    },
  };
}

function collectMethods(result) {
  return {
    CallExpression(path) {
      let callee = path.node.callee;
      if (
        babel.types.isMemberExpression(callee) &&
        !callee.computed &&
        babel.types.isIdentifier(callee.property) &&
        domMethods.includes(callee.property.name)
      ) {
        result.add(callee.property.name);
      }
    },
  };
}

function legacyClassify() {
  let globals = new Set();
  let methods = new Set();
  transform(collectGlobals(globals));
  transform(collectMethods(methods));
  return { globals: [...globals], methods: [...methods] };
}

function consolidatedClassify() {
  let globals = new Set();
  let methods = new Set();
  transform({ ...collectGlobals(globals), ...collectMethods(methods) });
  return { globals: [...globals], methods: [...methods] };
}

const templatePreprocessor = new ContentTag.Preprocessor();

function legacyTemplateAnalysis() {
  return [...new ContentTag.Preprocessor().parse(source)].length;
}

function reusedTemplateAnalysis() {
  return [...templatePreprocessor.parse(source)].length;
}

const projection = {
  cardTitle: 'Capsule clone boundary',
  cardDescription: 'A representative projection',
  items: Array.from({ length: 24 }, (_, index) => ({
    id: index,
    label: `Item ${index}`,
    metadata: { active: index % 2 === 0, rank: index },
  })),
};
const fields = Array.from({ length: 16 }, (_, index) => ({
  fieldName: `field${index}`,
  value: { label: `Value ${index}`, index },
}));

function assembleRenderRecord(modelExtensions) {
  return {
    model: structuredClone({
      ...modelExtensions,
      ...Object.fromEntries(
        fields.map((field) => [field.fieldName, field.value]),
      ),
    }),
    fields: structuredClone(fields),
  };
}

function legacyRenderRecord() {
  return assembleRenderRecord(structuredClone(projection));
}

function cloneOnceRenderRecord() {
  return assembleRenderRecord(projection);
}

function percentile(samples, fraction) {
  let sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil((sorted.length - 1) * fraction)];
}

function measure(name, legacy, optimized) {
  assert.deepEqual(optimized(), legacy(), `${name} output parity`);
  for (let index = 0; index < 10; index++) {
    legacy();
    optimized();
  }
  let legacySamples = [];
  let optimizedSamples = [];
  for (let round = 0; round < rounds; round++) {
    let ordered =
      round % 2 === 0
        ? [
            [legacy, legacySamples],
            [optimized, optimizedSamples],
          ]
        : [
            [optimized, optimizedSamples],
            [legacy, legacySamples],
          ];
    for (let [operation, samples] of ordered) {
      let startedAt = performance.now();
      for (let index = 0; index < iterations; index++) {
        operation();
      }
      samples.push(performance.now() - startedAt);
    }
  }
  let legacyMedian = percentile(legacySamples, 0.5);
  let optimizedMedian = percentile(optimizedSamples, 0.5);
  return {
    name,
    iterations,
    rounds,
    legacyMicrosecondsPerOperation: (legacyMedian * 1000) / iterations,
    optimizedMicrosecondsPerOperation: (optimizedMedian * 1000) / iterations,
    legacyP95Ms: percentile(legacySamples, 0.95),
    optimizedP95Ms: percentile(optimizedSamples, 0.95),
    speedup: legacyMedian / optimizedMedian,
    reductionPercent: (1 - optimizedMedian / legacyMedian) * 100,
  };
}

console.log(
  JSON.stringify(
    [
      measure('classifier-babel-pass', legacyClassify, consolidatedClassify),
      measure(
        'content-tag-preprocessor',
        legacyTemplateAnalysis,
        reusedTemplateAnalysis,
      ),
      measure(
        'render-record-projection-clone',
        legacyRenderRecord,
        cloneOnceRenderRecord,
      ),
    ],
    null,
    2,
  ),
);
