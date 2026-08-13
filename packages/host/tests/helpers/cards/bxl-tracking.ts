// An insurance-tracking domain — Policy linking to Customer / Underwriter
// with a query-backed inverse of Claim.policy — whose computed fields are all
// BXL expressions imported from the platform-provided '@cardstack/bxl'
// module. Modeled on the crafted real-world BXL realms, simplified to the
// smallest shape that still exercises every factory dimension:
//
//   - all three syntax modes (plain string / fx / jq) driving computeVia
//   - linked-card traversal: linksTo, query-backed linksToMany, dotted
//     paths across two links
//   - null tolerance: fx arithmetic coerces blank numerics to 0 (Excel
//     blank semantics); jq paths propagate null
//   - Excel error sentinels (#N/A, #DIV/0!, …) surfaced as null
//   - `{ as: FieldDef }` materialization, single instance and arrays
//   - a lazy-chunk formula family (PMT is in the financial chunk), proving
//     chunk loading works wherever the realm indexes or renders
//
// The realm contents are position-independent: instance links are relative
// and the query filter derives its type ref from import.meta.url, so any
// test can mount them at any realm URL. Intended to be shared by the BXL
// host suites (function coverage, indexing, cycle regression) rather than
// each test growing its own variant.

export const bxlTrackingCardSource = `
  import {
    CardDef,
    Component,
    FieldDef,
    field,
    contains,
    containsMany,
    linksTo,
    linksToMany,
  } from '@cardstack/base/card-api';
  import NumberField from '@cardstack/base/number';
  import StringField from '@cardstack/base/string';
  import { expression, fx, jq } from '@cardstack/bxl';

  // Exercises { as: FieldDef }: BXL expressions yield plain JSON; the
  // factory rebuilds that output as instances of this class through the
  // platform's field metadata, so the serializer can identify the value
  // instead of failing on an anonymous object.
  export class RiskBandField extends FieldDef {
    static displayName = 'RiskBand';
    @field label = contains(StringField);
    @field score = contains(NumberField);
    @field flags = containsMany(StringField);
  }

  export class Customer extends CardDef {
    static displayName = 'Customer';
    @field name = contains(StringField);
    @field tier = contains(StringField);
    @field displayLabel = contains(StringField, {
      computeVia: expression(fx\`Name & " (" & Tier & ")"\`),
    });
  }

  export class Underwriter extends CardDef {
    static displayName = 'Underwriter';
    @field name = contains(StringField);
  }

  export class Claim extends CardDef {
    static displayName = 'Claim';
    @field claimId = contains(StringField);
    @field claimStatus = contains(StringField);
    @field paidAmount = contains(NumberField);
    @field reserveAmount = contains(NumberField);
    @field policy = linksTo(() => Policy);
    // Blank amounts read as 0 under Excel blank semantics, so a claim with
    // no amounts computes 0 here rather than crashing or going null.
    @field incurredAmount = contains(NumberField, {
      computeVia: expression(
        fx\`ROUND((PaidAmount + ReserveAmount) * 100) / 100\`,
      ),
    });
    @field severityBand = contains(StringField, {
      computeVia: expression(
        fx\`IFS(IncurredAmount < 1000, "Minor", IncurredAmount < 10000, "Standard", TRUE, "Large")\`,
      ),
    });
    // A dotted path across two links: claim → policy → customer. A missing
    // hop anywhere along the path yields null.
    @field customerName = contains(StringField, {
      computeVia: expression(jq\`.policy.customer.name\`),
    });
  }

  export class Policy extends CardDef {
    static displayName = 'Policy';
    @field policyId = contains(StringField);
    @field policyStatus = contains(StringField);
    @field annualPremium = contains(NumberField);
    @field financingApr = contains(NumberField);
    @field customer = linksTo(() => Customer);
    @field underwriter = linksTo(() => Underwriter);
    // Query-backed inverse: every Claim whose policy link targets this
    // card. Seed data only sets Claim.policy; this side is derived.
    @field claims = linksToMany(() => Claim, {
      query: {
        filter: {
          every: [
            {
              type: {
                module: \`\${new URL('./tracking', import.meta.url).href}\`,
                name: 'Claim',
              },
            },
            { eq: { 'policy.id': '$this.id' } },
          ],
        },
        sort: [{ by: 'claimId', direction: 'asc' }],
      },
    });

    // The three syntax modes side by side. Plain strings compile as
    // readable BXL (jq-style paths and Excel functions both allowed)…
    @field premiumWithTax = contains(NumberField, {
      computeVia: expression('ROUND(.annualPremium * 1.07 * 100) / 100'),
    });
    // …fx marks Excel-like readable syntax with PascalCase field labels —
    // PMT also comes from the lazily-loaded financial formula family…
    @field monthlyPayment = contains(NumberField, {
      computeVia: expression(
        fx\`ROUND(ABS(PMT(FinancingApr / 12, 12, -AnnualPremium)) * 100) / 100\`,
      ),
    });
    // …and jq is handed straight to the jq engine, no readable-syntax
    // compilation.
    @field paidClaimsTotal = contains(NumberField, {
      computeVia: expression(jq\`[.claims[] | .paidAmount] | add // 0\`),
    });
    @field reservedClaimsTotal = contains(NumberField, {
      computeVia: expression(jq\`[.claims[] | .reserveAmount] | add // 0\`),
    });
    @field openClaimCount = contains(NumberField, {
      computeVia: expression(
        jq\`[.claims[] | select(.claimStatus == "Open")] | length\`,
      ),
    });
    @field customerName = contains(StringField, {
      computeVia: expression(jq\`.customer.name\`),
    });
    @field underwriterName = contains(StringField, {
      computeVia: expression(jq\`.underwriter.name\`),
    });
    // Chained computeds: a BXL expression reading other BXL computeds.
    @field lossRatio = contains(NumberField, {
      computeVia: expression(
        fx\`ROUND((PaidClaimsTotal + ReservedClaimsTotal) / AnnualPremium * 10000) / 10000\`,
      ),
    });

    // The claims inverse and each claim's policy link form a true cycle.
    // Walking the back-edge re-enters this policy, which BXL clips to a
    // bounded { id } reference — so this reads as one own-id per claim.
    @field claimPolicyIds = containsMany(StringField, {
      computeVia: expression(jq\`[.claims[] | .policy.id]\`),
    });
    // A structural operation across the cycle: unique compares the claims
    // by their materialized field values (their back-edges clip), so
    // distinct claims stay distinct and the comparison terminates.
    @field distinctClaimCount = contains(NumberField, {
      computeVia: expression(jq\`[.claims[]] | unique | length\`),
    });

    // Excel error sentinels are first-class spreadsheet values; the factory
    // catches them at the boundary and surfaces null so the indexer never
    // tears down the card.
    @field notApplicable = contains(NumberField, {
      computeVia: expression(fx\`NA()\`),
    });
    @field divByZero = contains(NumberField, {
      computeVia: expression(fx\`AnnualPremium / 0\`),
    });

    // { as: FieldDef } — single instance…
    @field riskBand = contains(RiskBandField, {
      computeVia: expression(
        jq\`{
          label: (if .lossRatio >= 0.8 then "High" else "Low" end),
          score: ((.lossRatio * 100) | round),
          flags: (if .lossRatio >= 0.8 then ["review"] else [] end)
        }\`,
        { as: RiskBandField },
      ),
    });
    // …and arrays: one materialized instance per element.
    @field claimBands = containsMany(RiskBandField, {
      computeVia: expression(
        jq\`[.claims[] | { label: .severityBand, score: .paidAmount }]\`,
        { as: RiskBandField },
      ),
    });

    static embedded = class Embedded extends Component<typeof Policy> {
      <template>
        <div data-test-policy={{@model.policyId}}>
          <span data-test-premium-with-tax>{{@model.premiumWithTax}}</span>
          <span data-test-monthly-payment>{{@model.monthlyPayment}}</span>
          <span data-test-paid-claims-total>{{@model.paidClaimsTotal}}</span>
          <span data-test-customer-name>{{@model.customerName}}</span>
          <span data-test-loss-ratio>{{@model.lossRatio}}</span>
          <span data-test-risk-band>{{@model.riskBand.label}}</span>
        </div>
      </template>
    };
  }
`;

// Fixture data. POL-100 is fully linked with two claims; POL-200 has no
// links and no claims, so it exercises every null-tolerance path. CLM-3
// has neither amounts nor a policy: its own computeds fall back to Excel
// blank semantics, its two-hop path yields null, and it stays out of both
// policies' query-backed claims.
//
// Query-backed inverses (Policy.claims) resolve against the LIVE index at
// visit time, while linksTo traversal loads targets from source. On a
// realm's first-ever index pass the live index is empty, so POL-100's
// claims aggregations bake in their empty-set values; the next visit of
// the policy converges them. Tests that assert converged aggregations
// re-write POL-100 with `bxlTrackingPol100Renewal` to trigger that visit.
function pol100Doc(policyStatus: string) {
  return {
    data: {
      type: 'card',
      attributes: {
        policyId: 'POL-100',
        policyStatus,
        annualPremium: 12000,
        financingApr: 0.06,
      },
      relationships: {
        customer: { links: { self: '../Customer/acme' } },
        underwriter: { links: { self: '../Underwriter/dana' } },
      },
      meta: {
        adoptsFrom: { module: '../tracking', name: 'Policy' },
      },
    },
  };
}

export const bxlTrackingPol100Renewal = pol100Doc('Renewed');

export const bxlTrackingRealmContents: Record<
  string,
  string | Record<string, unknown>
> = {
  'tracking.gts': bxlTrackingCardSource,
  'Customer/acme.json': {
    data: {
      type: 'card',
      attributes: { name: 'Acme Freight', tier: 'Gold' },
      meta: {
        adoptsFrom: { module: '../tracking', name: 'Customer' },
      },
    },
  },
  'Underwriter/dana.json': {
    data: {
      type: 'card',
      attributes: { name: 'Dana Reeve' },
      meta: {
        adoptsFrom: { module: '../tracking', name: 'Underwriter' },
      },
    },
  },
  'Claim/clm-1.json': {
    data: {
      type: 'card',
      attributes: {
        claimId: 'CLM-1',
        claimStatus: 'Open',
        paidAmount: 3200.5,
        reserveAmount: 1500,
      },
      relationships: {
        policy: { links: { self: '../Policy/pol-100' } },
      },
      meta: {
        adoptsFrom: { module: '../tracking', name: 'Claim' },
      },
    },
  },
  'Claim/clm-2.json': {
    data: {
      type: 'card',
      attributes: {
        claimId: 'CLM-2',
        claimStatus: 'Closed',
        paidAmount: 780.25,
        reserveAmount: 0,
      },
      relationships: {
        policy: { links: { self: '../Policy/pol-100' } },
      },
      meta: {
        adoptsFrom: { module: '../tracking', name: 'Claim' },
      },
    },
  },
  'Claim/clm-3.json': {
    data: {
      type: 'card',
      attributes: {
        claimId: 'CLM-3',
        claimStatus: 'Open',
      },
      meta: {
        adoptsFrom: { module: '../tracking', name: 'Claim' },
      },
    },
  },
  'Policy/pol-100.json': pol100Doc('Active'),
  'Policy/pol-200.json': {
    data: {
      type: 'card',
      attributes: {
        policyId: 'POL-200',
        policyStatus: 'Lapsed',
        annualPremium: 8000,
        financingApr: 0.05,
      },
      meta: {
        adoptsFrom: { module: '../tracking', name: 'Policy' },
      },
    },
  },
};
