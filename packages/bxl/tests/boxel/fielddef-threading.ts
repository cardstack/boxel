// Multi-stage FieldDef threading — the insurance fixture pattern where
// one FieldDef's computeVia output gets materialized into the next
// FieldDef as an input.
//
// What we're locking down: the parent CardDef's `expression(...)
// computeVia + { as: Cls }` builds an object literal whose keys
// match the child's `@field` names; the materialized child runs
// its own computeVia chain against `this`. Repeat across stages.
//
// In the realm runtime, `getFields` walks each FieldDef's metadata
// and copies inputs by name. Outside the realm (this test), the
// fallback path is `new Cls(); Object.assign(instance, raw)`, which
// gives us the same observable behavior at the surface — the next
// stage can read the prior stage's computeds.
//
// Maps to docs/realm-composition.md and port-doc §11a.

import { ok, strictEqual } from 'node:assert';
import { expression, fx } from '../../src/index.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (error) {
    fail++;
    failures.push(`  ${name}\n    ${(error as Error).message.split('\n')[0]}`);
  }
}

// Three-stage pipeline mirroring the insurance fixture:
// Development → Reinsurance → Profit.

class DevelopmentField {
  reportedLoss: number = 0;
  selectedLdf: number = 0;
  scenarioLossDevelopmentFactor: number = 0;
  // Computed (filled in lazily by the test — the no-realm fallback
  // path doesn't auto-evaluate computeVia, so we pre-compute and
  // assign).
  grossUltimateLoss: number = 0;
}

class ReinsuranceField {
  grossUltimateLoss: number = 0;
  quotaShareCededPct: number = 0;
  xolRetention: number = 0;
  xolLimit: number = 0;
  cededLoss: number = 0;
  netUltimateLoss: number = 0;
}

class ProfitField {
  earnedPremium: number = 0;
  netUltimateLoss: number = 0;
  totalExpense: number = 0;
  underwritingProfit: number = 0;
}

const card = {
  // Raw inputs the parent CardDef would hold.
  reportedLoss: 30000,
  selectedLdf: 1.2,
  scenarioLossDevelopmentFactor: 1.05,
  quotaShareCededPct: 0.25,
  xolRetention: 50000,
  xolLimit: 200000,
  earnedPremium: 80000,
  totalExpense: 22000,
};

check('stage 1: Development materializes from card-level inputs', () => {
  const compute = expression(
    fx`{
      reportedLoss: ReportedLoss,
      selectedLdf: SelectedLdf,
      scenarioLossDevelopmentFactor: ScenarioLossDevelopmentFactor,
      grossUltimateLoss: ROUND(ReportedLoss * SelectedLdf * ScenarioLossDevelopmentFactor, 2),
    }`,
    { as: DevelopmentField },
  );
  const dev = compute.call(card) as DevelopmentField;
  ok(dev instanceof DevelopmentField);
  // 30000 * 1.2 * 1.05 = 37800
  strictEqual(dev.grossUltimateLoss, 37800);
  strictEqual(dev.reportedLoss, 30000);
});

check('stage 2: Reinsurance reads stage-1 output via Development.X path', () => {
  // The "card" here is the parent that has both raw inputs AND a
  // materialized `development` field — exactly what a CardDef
  // ends up with at render time.
  const developmentCompute = expression(
    fx`{
      reportedLoss: ReportedLoss,
      selectedLdf: SelectedLdf,
      scenarioLossDevelopmentFactor: ScenarioLossDevelopmentFactor,
      grossUltimateLoss: ROUND(ReportedLoss * SelectedLdf * ScenarioLossDevelopmentFactor, 2),
    }`,
    { as: DevelopmentField },
  );
  const cardWithDev = {
    ...card,
    development: developmentCompute.call(card),
  };

  const compute = expression(
    fx`{
      grossUltimateLoss: Development.GrossUltimateLoss,
      quotaShareCededPct: QuotaShareCededPct,
      xolRetention: XolRetention,
      xolLimit: XolLimit,
      cededLoss: ROUND(MIN(Development.GrossUltimateLoss, Development.GrossUltimateLoss * QuotaShareCededPct + MAX(0, MIN(Development.GrossUltimateLoss - XolRetention, XolLimit))), 2),
      netUltimateLoss: ROUND(Development.GrossUltimateLoss - MIN(Development.GrossUltimateLoss, Development.GrossUltimateLoss * QuotaShareCededPct + MAX(0, MIN(Development.GrossUltimateLoss - XolRetention, XolLimit))), 2),
    }`,
    { as: ReinsuranceField },
  );
  const re = compute.call(cardWithDev) as ReinsuranceField;
  ok(re instanceof ReinsuranceField);
  // GrossUltimate 37800; QS = 25% × 37800 = 9450; XOL = max(0, min(37800-50000, 200000)) = 0;
  // CededLoss = min(37800, 9450) = 9450; NetUltimate = 37800 - 9450 = 28350.
  strictEqual(re.cededLoss, 9450);
  strictEqual(re.netUltimateLoss, 28350);
});

check('stage 3: Profit reads stage-2 output via Reinsurance.NetUltimateLoss', () => {
  // Build the full card-with-FieldDefs the way a realm would.
  const developmentCompute = expression(
    fx`{
      reportedLoss: ReportedLoss,
      selectedLdf: SelectedLdf,
      scenarioLossDevelopmentFactor: ScenarioLossDevelopmentFactor,
      grossUltimateLoss: ROUND(ReportedLoss * SelectedLdf * ScenarioLossDevelopmentFactor, 2),
    }`,
    { as: DevelopmentField },
  );
  const development = developmentCompute.call(card);

  const reinsuranceCompute = expression(
    fx`{
      grossUltimateLoss: Development.GrossUltimateLoss,
      quotaShareCededPct: QuotaShareCededPct,
      xolRetention: XolRetention,
      xolLimit: XolLimit,
      netUltimateLoss: ROUND(Development.GrossUltimateLoss - MIN(Development.GrossUltimateLoss, Development.GrossUltimateLoss * QuotaShareCededPct), 2),
    }`,
    { as: ReinsuranceField },
  );
  const reinsurance = reinsuranceCompute.call({ ...card, development });

  const compute = expression(
    fx`{
      earnedPremium: EarnedPremium,
      netUltimateLoss: Reinsurance.NetUltimateLoss,
      totalExpense: TotalExpense,
      underwritingProfit: ROUND(EarnedPremium - (Reinsurance.NetUltimateLoss + TotalExpense), 2),
    }`,
    { as: ProfitField },
  );
  const profit = compute.call({
    ...card,
    development,
    reinsurance,
  }) as ProfitField;
  ok(profit instanceof ProfitField);
  // EarnedPremium 80000; Net 28350; Expense 22000; Profit 80000-(28350+22000) = 29650.
  strictEqual(profit.netUltimateLoss, 28350);
  strictEqual(profit.underwritingProfit, 29650);
});

check('threading survives a `(A - B + C)` parsed-paren shape', () => {
  // Regression for the parser fix (port-doc §18). A FieldDef that
  // computes `Earned - (Loss + Expense)` would have rendered the
  // expense as a positive contribution before the fix.
  const compute = expression(
    fx`{
      earnedPremium: EarnedPremium,
      netUltimateLoss: 28350,
      totalExpense: TotalExpense,
      underwritingProfit: ROUND(EarnedPremium - (28350 + TotalExpense), 2),
    }`,
    { as: ProfitField },
  );
  const profit = compute.call(card) as ProfitField;
  // 80000 - (28350 + 22000) = 29650, NOT (80000 - 28350) + 22000 = 73650.
  strictEqual(profit.underwritingProfit, 29650);
});

console.log(
  `BXL Boxel FieldDef threading: ${pass}/${pass + fail} cases passed`,
);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
