import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  compileBxl,
  evaluateBxl,
  loadAllFormulaExtensions,
  runNativeJqAsync,
  BXL_BUILD_INFO,
} from '@cardstack/bxl';

// BXL is an isomorphic package: the host bundles it through Vite and serves
// it to card code, while platform code reaches it from node. Cards can't run
// in node, so node-side coverage is deliberately a smoke suite over plain
// JS objects — enough to prove the runtime is the same one the browser gets,
// not a second implementation.
//
// What only node can break is the delivery: the package ships raw `.ts` with
// `.ts` import specifiers and pulls its heavy formula families in through
// dynamic import, so it runs here under node's native type stripping with no
// bundler to rewrite anything. A specifier the stripper can't follow, or a
// chunk that only a bundler could resolve, fails here and nowhere else.
//
// The expressions below are the ones the host's BXL card fixtures compute
// (packages/host/tests/helpers/cards/bxl-tracking.ts), evaluated against the
// plain-object equivalent of those cards' field values and asserted to the
// same answers — so a divergence between the two environments shows up as a
// number that stops matching. The exhaustive function matrix lives in the
// bxl package's own suite; card-level behavior lives in the host suites.
module(basename(import.meta.filename), function () {
  test('the package loads under node and reports its build identity', function (assert) {
    assert.strictEqual(
      typeof BXL_BUILD_INFO.version,
      'string',
      'a version string, so a consumer can tell which build answered',
    );
    assert.true(
      BXL_BUILD_INFO.features.includes('null-tolerance'),
      'the feature list is populated, not an empty placeholder',
    );
  });

  test('evaluates readable BXL over a plain object', function (assert) {
    // Bare PascalCase identifiers resolve to camelCase field keys, the same
    // fallback the card factory relies on when no schema is supplied.
    assert.strictEqual(
      evaluateBxl('ROUND((PaidAmount + ReserveAmount) * 100) / 100', {
        paidAmount: 3200.5,
        reserveAmount: 1500,
      }).value,
      4700.5,
      'Claim.incurredAmount',
    );
    assert.strictEqual(
      evaluateBxl(
        'IFS(IncurredAmount < 1000, "Minor", IncurredAmount < 10000, "Standard", TRUE, "Large")',
        { incurredAmount: 4700.5 },
      ).value,
      'Standard',
      'Claim.severityBand',
    );
    // Excel blank semantics: absent numerics read as 0 rather than
    // propagating null or throwing.
    assert.strictEqual(
      evaluateBxl('ROUND((PaidAmount + ReserveAmount) * 100) / 100', {}).value,
      0,
      'a blank input still computes',
    );
  });

  test('compiles readable BXL to canonical jq', function (assert) {
    let compiled = compileBxl(
      'ROUND(ABS(PMT(FinancingApr / 12, 12, -AnnualPremium)) * 100) / 100',
    );
    assert.strictEqual(
      compiled.source,
      'ROUND(ABS(PMT(.financingApr / 12; 12; -.annualPremium)) * 100) / 100',
      'PascalCase labels become field paths and commas become jq semicolons',
    );
    assert.true(compiled.changed, 'the compiler reports it rewrote the source');
    assert.deepEqual(compiled.warnings, [], 'no diagnostics on valid source');
  });

  test('evaluates canonical jq handed straight to the engine', function (assert) {
    // readableSyntax: false is what the `jq` tagged template selects — the
    // source skips the readable-syntax compiler and reaches the jq parser
    // unchanged.
    assert.strictEqual(
      evaluateBxl(
        '[.claims[] | .paidAmount] | add // 0',
        { claims: [{ paidAmount: 3200.5 }, { paidAmount: 780.25 }] },
        { readableSyntax: false },
      ).value,
      3980.75,
      'Policy.paidClaimsTotal',
    );
    assert.strictEqual(
      evaluateBxl(
        '[.claims[] | .paidAmount] | add // 0',
        { claims: [] },
        {
          readableSyntax: false,
        },
      ).value,
      0,
      'an empty aggregation falls back rather than yielding null',
    );
  });

  test('a lazy formula chunk resolves through dynamic import', async function (assert) {
    // PMT lives in the financial family, which ships as its own chunk behind
    // a dynamic `import('…/formula-financial.ts')`. The async entry point
    // inspects the program, pulls in the families it names, and registers
    // them before evaluating.
    let run = await runNativeJqAsync(
      'ROUND(ABS(PMT(FinancingApr / 12, 12, -AnnualPremium)) * 100) / 100',
      { financingApr: 0.06, annualPremium: 12000 },
    );
    assert.deepEqual(run.outputs, [1032.8], 'Policy.monthlyPayment');

    // Auto-loading only widens the library set for that one async call —
    // the default set a synchronous caller gets still holds just the eager
    // core. Folding the chunks into that default set is a separate,
    // explicit step, and it's what lets a host serve a `computeVia` that
    // cannot await an import mid-compute.
    await loadAllFormulaExtensions();
    assert.strictEqual(
      evaluateBxl(
        'ROUND(ABS(PMT(FinancingApr / 12, 12, -AnnualPremium)) * 100) / 100',
        { financingApr: 0.06, annualPremium: 12000 },
      ).value,
      1032.8,
      'the folded-in family is visible to synchronous evaluation',
    );
  });
});
