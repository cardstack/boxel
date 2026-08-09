import { module, test } from 'qunit';

import { decideBoxelExecution } from '@cardstack/host/lib/boxel-execution-policy';
import BoxelRuntimeRouter, {
  type BoxelRuntimeRouteInput,
} from '@cardstack/host/lib/boxel-runtime-router';

import type CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import type DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';
import type SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';

import {
  capsuleSource,
  executionGraphScenarios,
  graphEdgeKey,
  policy,
  requiredExecutionGraphEdges,
  sandboxSource,
  sandboxSourceWithEdit,
  scenarioEdgeKeys,
} from '../../helpers/boxel-execution-graph';

class BenchmarkRuntime {
  destroy(): void {}
}

function median(values: number[]): number {
  let sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function benchmarkWarmRoutes(
  router: BoxelRuntimeRouter,
  input: BoxelRuntimeRouteInput,
  iterations = 10_000,
): number {
  let samples: number[] = [];
  for (let round = 0; round < 5; round++) {
    let startedAt = performance.now();
    for (let index = 0; index < iterations; index++) {
      let lease = router.route(input);
      lease.release();
    }
    samples.push((performance.now() - startedAt) / iterations);
  }
  return median(samples);
}

module('Unit | Boxel execution graph', function () {
  test('routing is a total truth table across trust, source, format, and author hints', function (assert) {
    let compactFormats = ['fitted', 'atom', 'head', 'markdown'];

    for (let format of [
      'isolated',
      'embedded',
      'edit',
      ...compactFormats,
      'custom',
    ]) {
      assert.deepEqual(
        decideBoxelExecution(policy({ trusted: true, format })),
        { mode: 'direct', reason: 'trusted-boxel-module' },
        `trusted ${format} stays Direct`,
      );
      assert.deepEqual(
        decideBoxelExecution(policy({ source: capsuleSource, format })),
        { mode: 'capsule', reason: capsuleSource.reason },
        `ordinary authored ${format} stays Capsule`,
      );
    }

    for (let format of ['isolated', 'embedded']) {
      assert.deepEqual(
        decideBoxelExecution(policy({ source: sandboxSource, format })),
        { mode: 'sandbox', reason: sandboxSource.reason },
        `browser-dependent ${format} uses Sandbox`,
      );
    }

    for (let format of [...compactFormats, 'edit', 'custom']) {
      assert.deepEqual(
        decideBoxelExecution(policy({ source: sandboxSource, format })),
        { mode: 'capsule', reason: `ses-only-format:${format}` },
        `browser-dependent ${format} cannot allocate an inline iframe`,
      );
    }

    assert.deepEqual(
      decideBoxelExecution(
        policy({ source: sandboxSourceWithEdit, format: 'edit' }),
      ),
      { mode: 'sandbox', reason: sandboxSource.reason },
      'authored edit code never runs below the module classified tier',
    );

    for (let format of ['isolated', 'embedded', 'edit']) {
      assert.deepEqual(
        decideBoxelExecution(policy({ prefersFullSandbox: true, format })),
        { mode: 'sandbox', reason: 'prefers-full-sandbox' },
        `prefersFullSandbox strengthens ${format}`,
      );
    }

    for (let format of compactFormats) {
      assert.deepEqual(
        decideBoxelExecution(policy({ prefersFullSandbox: true, format })),
        { mode: 'capsule', reason: `ses-only-format:${format}` },
        `prefersFullSandbox cannot create a ${format} iframe`,
      );
      assert.deepEqual(
        decideBoxelExecution(
          policy({ trusted: true, prefersFullSandbox: true, format }),
        ),
        { mode: 'direct', reason: 'trusted-boxel-module' },
        `a compact trusted ${format} is not weakened from Direct to Capsule`,
      );
    }

    for (let format of ['isolated', 'embedded', 'edit', ...compactFormats]) {
      assert.deepEqual(
        decideBoxelExecution(policy({ volatile: true, format })),
        { mode: 'sandbox', reason: 'volatile-promotion' },
        `volatile ${format} uses the isolated HMR runtime`,
      );
      assert.deepEqual(
        decideBoxelExecution(policy({ trusted: true, volatile: true, format })),
        { mode: 'direct', reason: 'trusted-boxel-module' },
        `volatile input cannot promote trusted ${format} code`,
      );
    }
  });

  test('the graph gauntlet is well formed and covers every required boundary edge', function (assert) {
    let ids = new Set<string>();
    let coveredEdges = new Set<string>();
    let proofCounts = { exact: 0, 'protocol-only': 0, 'browser-gated': 0 };

    for (let scenario of executionGraphScenarios) {
      assert.false(ids.has(scenario.id), `${scenario.id} is unique`);
      ids.add(scenario.id);
      proofCounts[scenario.proof]++;

      let nodeIds = new Set<string>();
      for (let node of scenario.nodes) {
        assert.false(
          nodeIds.has(node.id),
          `${scenario.id} node '${node.id}' is unique`,
        );
        nodeIds.add(node.id);
        if (node.via === 'host-route') {
          assert.ok(node.policy, `${scenario.id}/${node.id} declares policy`);
          let decision = decideBoxelExecution(node.policy!);
          assert.strictEqual(
            decision.mode,
            node.owner,
            `${scenario.id}/${node.id} routes to ${node.owner}`,
          );
          if (node.expectedReason) {
            assert.strictEqual(
              decision.reason,
              node.expectedReason,
              `${scenario.id}/${node.id} has the expected reason`,
            );
          }
        } else {
          assert.notOk(
            node.policy,
            `${scenario.id}/${node.id} is an explicit ${node.via} edge, not a hidden policy route`,
          );
        }
      }

      for (let edge of scenarioEdgeKeys(scenario)) {
        coveredEdges.add(edge);
      }
    }

    assert.strictEqual(
      ids.size,
      13,
      'all thirteen graph scenarios are declared',
    );
    assert.strictEqual(
      proofCounts.exact,
      13,
      'the minimum gate has an exact browser-backed proof for every scenario',
    );
    assert.strictEqual(
      proofCounts['protocol-only'],
      0,
      'no minimum-gate scenario remains protocol-only',
    );
    assert.strictEqual(
      proofCounts['browser-gated'],
      0,
      'no minimum-gate scenario remains browser-gated',
    );
    for (let scenario of executionGraphScenarios) {
      assert.ok(
        scenario.evidence.length > 0,
        `${scenario.id} names its executable evidence`,
      );
    }

    for (let [from, via, to] of requiredExecutionGraphEdges) {
      let edge = graphEdgeKey(from, via, to);
      assert.true(coveredEdges.has(edge), `gauntlet covers ${edge}`);
    }
  });

  test('nested graph nodes preserve authority and lifecycle axioms', function (assert) {
    for (let scenario of executionGraphScenarios) {
      let nodes = new Map(scenario.nodes.map((node) => [node.id, node]));
      for (let node of scenario.nodes) {
        let parent = node.parent ? nodes.get(node.parent) : undefined;

        if (node.via === 'host-route' && parent) {
          assert.strictEqual(
            parent.owner,
            'host',
            `${scenario.id}/${node.id} re-enters Host policy instead of inheriting ${parent.owner}`,
          );
        }
        if (node.via === 'runtime-local') {
          assert.ok(parent, `${scenario.id}/${node.id} has a local owner`);
          if (parent?.owner !== 'direct') {
            assert.strictEqual(
              node.owner,
              parent?.owner,
              `${scenario.id}/${node.id} cannot smuggle a local child into another runtime`,
            );
          }
        }
        if (node.via === 'trusted-callback') {
          assert.strictEqual(
            parent?.owner,
            'direct',
            `${scenario.id}/${node.id} callback originates in a trusted portal`,
          );
          assert.strictEqual(
            node.owner,
            'capsule',
            `${scenario.id}/${node.id} returns projected data to its authored Capsule owner`,
          );
        }
        if (node.via === 'host-capability') {
          assert.strictEqual(
            node.owner,
            'host',
            `${scenario.id}/${node.id} capability terminates in Host`,
          );
        }
        if (node.owner === 'sandbox' && node.via === 'host-route') {
          assert.ok(
            node.surfaceId.length > 0,
            `${scenario.id}/${node.id} has a stable mounted surface identity`,
          );
        }
        if (parent && node.via !== 'store-update') {
          assert.strictEqual(
            node.principal,
            parent.principal,
            `${scenario.id}/${node.id} does not widen principal across ${node.via}`,
          );
        }
      }
    }
  });

  test('G-13 crosses every alternating owner without widening authority', function (assert) {
    let scenario = executionGraphScenarios.find(({ id }) => id === 'G-13')!;
    assert.deepEqual(
      scenario.nodes.map(({ owner }) => owner),
      [
        'capsule',
        'direct',
        'capsule',
        'host',
        'sandbox',
        'sandbox',
        'host',
        'host',
        'capsule',
      ],
      'Capsule -> Direct -> Capsule -> Host -> Sandbox -> Host -> Capsule is explicit',
    );
    assert.deepEqual(
      scenario.nodes.map(({ principal }) => principal),
      Array(scenario.nodes.length).fill('viewer:one'),
      'the viewer principal is stable through portals, execution, and reconciliation',
    );
    assert.true(
      scenarioEdgeKeys(scenario).includes(
        graphEdgeKey('host', 'store-update', 'capsule'),
      ),
      'the canonical Host update reconciles the surviving Capsule consumer',
    );
  });

  test('records comparable warm routing baselines for Direct, Capsule, and Sandbox', function (assert) {
    let direct = new BenchmarkRuntime();
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => new BenchmarkRuntime() as unknown as CapsuleBoxelRuntime,
      () => new BenchmarkRuntime() as unknown as SandboxRuntimeProcess,
      60_000,
    );

    let common = {
      ...policy(),
      principal: 'benchmark:viewer',
      surfaceId: 'benchmark:surface',
    };
    // Prime retained runtimes so this measures the steady-state router and
    // retention bookkeeping, not runtime construction or module evaluation.
    for (let input of [
      { ...common, trusted: true },
      common,
      { ...common, source: sandboxSource },
    ]) {
      router.route(input).release();
    }

    let baseline = {
      direct: benchmarkWarmRoutes(router, { ...common, trusted: true }),
      capsule: benchmarkWarmRoutes(router, common),
      sandbox: benchmarkWarmRoutes(router, {
        ...common,
        source: sandboxSource,
      }),
    };
    router.destroy();

    console.info(
      'BOXEL_EXECUTION_ROUTING_BASELINE',
      JSON.stringify({
        unit: 'milliseconds-per-operation',
        iterationsPerSample: 10_000,
        medianOfSamples: 5,
        ...baseline,
      }),
    );

    assert.true(
      Object.values(baseline).every(
        (milliseconds) => Number.isFinite(milliseconds) && milliseconds >= 0,
      ),
      `warm routing ms/op — Direct ${baseline.direct.toFixed(4)}, Capsule ${baseline.capsule.toFixed(4)}, Sandbox ${baseline.sandbox.toFixed(4)}`,
    );
  });
});
