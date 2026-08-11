import 'ses';

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

lockdown();

const iterations = Number(process.env.BOXEL_CLONE_BENCH_ITERATIONS ?? 250);
const rounds = Number(process.env.BOXEL_CLONE_BENCH_ROUNDS ?? 9);
const payload = {
  id: 'https://example.test/cards/PerformanceCard/one',
  title: 'Capsule boundary benchmark',
  description: '<!-- authored --> left --> right',
  separators: 'line one\u2028line two\u2029line three',
  fields: Array.from({ length: 24 }, (_, index) => ({
    fieldName: `field-${index}`,
    value: `value-${index}-${'x'.repeat(48)}`,
  })),
};

function legacyClone(compartment, value) {
  let json = JSON.stringify(value)
    .split('<')
    .join('\\u003c')
    .split('>')
    .join('\\u003e')
    .split('\u2028')
    .join('\\u2028')
    .split('\u2029')
    .join('\\u2029');
  return compartment.evaluate(`JSON.parse(${JSON.stringify(json)})`);
}

function capturedClone(compartmentParse, value) {
  return compartmentParse(JSON.stringify(value));
}

function durationFor(clone) {
  let startedAt = performance.now();
  for (let index = 0; index < iterations; index++) {
    clone(payload);
  }
  return performance.now() - startedAt;
}

function percentile(samples, fraction) {
  let sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil((sorted.length - 1) * fraction)];
}

let compartment = new Compartment();
let compartmentParse = compartment.evaluate('JSON.parse');
let legacy = (value) => legacyClone(compartment, value);
let captured = (value) => capturedClone(compartmentParse, value);

assert.deepEqual(captured(payload), legacy(payload));
for (let index = 0; index < 10; index++) {
  legacy(payload);
  captured(payload);
}

let legacySamples = [];
let capturedSamples = [];
for (let round = 0; round < rounds; round++) {
  let first = round % 2 === 0 ? legacy : captured;
  let second = round % 2 === 0 ? captured : legacy;
  let firstSamples = round % 2 === 0 ? legacySamples : capturedSamples;
  let secondSamples = round % 2 === 0 ? capturedSamples : legacySamples;
  firstSamples.push(durationFor(first));
  secondSamples.push(durationFor(second));
}

let legacyMedian = percentile(legacySamples, 0.5);
let capturedMedian = percentile(capturedSamples, 0.5);
let result = {
  payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
  iterations,
  rounds,
  legacy: {
    medianMs: legacyMedian,
    p95Ms: percentile(legacySamples, 0.95),
    microsecondsPerClone: (legacyMedian * 1000) / iterations,
  },
  captured: {
    medianMs: capturedMedian,
    p95Ms: percentile(capturedSamples, 0.95),
    microsecondsPerClone: (capturedMedian * 1000) / iterations,
  },
  speedup: legacyMedian / capturedMedian,
  reductionPercent: (1 - capturedMedian / legacyMedian) * 100,
};

console.log(JSON.stringify(result, null, 2));
