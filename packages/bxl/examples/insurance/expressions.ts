import { fx, jq } from '../../src/index.js';
import type { BxlTaggedSource } from '../../src/index.js';

export interface InsuranceExpression {
  name: string;
  source: string | BxlTaggedSource;
  expected: unknown;
  illustrates: string;
}

// Each expression evaluates against `policy.json` (via
// `compute.call(policy)`). The hierarchy mirrors the spec:
// Coverage → ratings → development → reinsurance → expense → profit.

export const insuranceExpressions: InsuranceExpression[] = [
  {
    name: 'manualPremium',
    source: fx`Coverage.ExposureCount * Coverage.BaseRate`,
    expected: 7360,
    illustrates: 'Excel × with nested PascalCase fallback',
  },
  {
    name: 'totalRatingFactor',
    source: fx`ROUND(RatingFactors.ClassFactor * RatingFactors.TerritoryFactor * RatingFactors.LimitFactor * RatingFactors.DeductibleFactor * RatingFactors.RiskScoreFactor, 4)`,
    expected: 1.9365,
    illustrates: 'five-term multiplicative composite via PascalCase paths',
  },
  {
    name: 'reportedLoss',
    source: fx`ClaimsExperience.PaidLoss + ClaimsExperience.CaseReserve`,
    expected: 2000,
    illustrates: 'paid + case reserve sum',
  },
  {
    name: 'grossUltimateLoss',
    source: fx`ROUND((ClaimsExperience.PaidLoss + ClaimsExperience.CaseReserve) * SelectedLdf * Scenario.LossDevelopmentFactor, 2)`,
    expected: 2400,
    illustrates: 'LDF chain with parenthesized sum on the LHS of *',
  },
  {
    name: 'maturityLabel',
    source: fx`IFS(DevelopmentAgeMonths >= 60, "Mature", DevelopmentAgeMonths >= 36, "Settling", DevelopmentAgeMonths >= 18, "Developing", DevelopmentAgeMonths >= 6, "Young", TRUE, "Green")`,
    expected: 'Developing',
    illustrates: 'five-pair IFS — exercises the IFS/10 arity extension',
  },
  {
    name: 'cededLossNotApplied',
    source: fx`IF(AppliesFlag = "Yes", 999, 0)`,
    expected: 0,
    illustrates: 'IF guard — flag is "No" so reinsurance skipped',
  },
  {
    name: 'totalExpense',
    source: fx`ROUND((EarnedPremium * (CommissionPct + PremiumTaxPct + VariableExpensePct) + FixedExpensePerPolicy + ExpectedLossUsd * UlaePctOfLoss) * Scenario.ExpenseFactor, 2)`,
    expected: 2289.16,
    illustrates: 'parenthesized pct-sum + the parser-fix shape',
  },
  {
    name: 'underwritingProfit',
    source: jq`((.earnedPremium - ((.claimsExperience.paidLoss + .claimsExperience.caseReserve) * .selectedLdf * .scenario.lossDevelopmentFactor + ((.earnedPremium * (.commissionPct + .premiumTaxPct + .variableExpensePct) + .fixedExpensePerPolicy + .expectedLossUsd * .ulaePctOfLoss) * .scenario.expenseFactor))) * 100 | round) / 100`,
    expected: 3430.84,
    illustrates: 'Earned - (Loss + Expense) — the A-(B+C) shape post-parser-fix',
  },
];
