# Composing FieldDefs across a CardDef

A pattern that emerged from the `gigantic-crawdad`, `middle-wolverine`,
and `prudent-octopus` realms: the parent CardDef holds raw inputs,
threads relevant pieces into one or more `FieldDef`s via
`{ as: SomeFieldDef }` materialization, and the FieldDefs render
their own dashboards from the values they receive.

This page is the canonical reference for that pattern. For when to
pick `jq` vs `fx` vs plain string, see
[`syntax-modes.md`](./syntax-modes.md).

## The pattern

A `FieldDef` accepts a fixed set of input fields and exposes computed
fields derived from them. The CardDef's `computeVia` builds a plain
object literal whose keys match the FieldDef's input names, and the
factory's `as: FieldDef` option materializes the object as an
instance:

```ts
@field profit = contains(FlightProfitField, {
  computeVia: expression(
    fx`{
      passengers: Passengers,
      seats: Aircraft.Seats,
      blockHours: BlockHours,
      fuelGallons: FuelGallons,
      fuelPriceUsdGal: Scenario.FuelPriceUsdGal,
      crewCostUsd: Crew.TotalCrewCost,
      airportFeesUsd: TotalAirportFeesUsd,
      maintenanceCostUsd: MaintenanceCostUsd,
      ownershipCostUsd: OwnershipCostUsd,
      fixedFlightCostUsd: Aircraft.FixedCostUsdPerFlight,
    }`,
    { as: FlightProfitField },
  ),
});
```

The FieldDef stays **self-contained** — its `computeVia` chain
evaluates against `this` (the materialized instance), not the parent.
The PascalCase fallback inside the FieldDef's computeds resolves to
`.passengers`, `.seats`, etc. on the materialized object.

## Why this works

When `bxl()` sees `{ as: FlightProfitField }`:

1. Evaluates the source against the parent (`this` = the CardDef
   instance). The PascalCase fallback resolves `Passengers` →
   `.passengers`, `Aircraft.Seats` → `.aircraft.seats`, etc.
2. Produces a plain object with the input keys.
3. Materializes the object as an instance of `FlightProfitField` via
   `getFields` (or `Object.assign` outside the realm runtime — see
   [`port-from-jqxl.md`](./internals/port-from-jqxl.md) §11a).
4. Inside the FieldDef, every `computeVia` runs against the
   materialized `this` and resolves PascalCase identifiers against
   the copied input fields.

The threading lets the FieldDef be authored without knowledge of the
parent's structure — `FlightProfitField` doesn't import `Aircraft`,
`Crew`, or `Scenario`. Useful for reuse across cards.

## Multi-stage pipeline

The `prudent-octopus` insurance realm chains multiple FieldDefs —
each materializes the previous one's output:

```ts
@field development = contains(DevelopmentField, {
  computeVia: expression(
    fx`{
      reportedLoss: ClaimsExperience.ReportedLoss,
      selectedLdf: SelectedLdf,
      scenarioLossDevelopmentFactor: Scenario.LossDevelopmentFactor,
      developmentAgeMonths: DevelopmentAgeMonths,
    }`,
    { as: DevelopmentField },
  ),
});

@field reinsurance = contains(ReinsuranceField, {
  computeVia: expression(
    fx`{
      grossUltimateLoss: Development.GrossUltimateLoss,   // ← from development
      quotaShareCededPct: QuotaShareCededPct,
      xolRetention: XolRetention,
      xolLimit: XolLimit,
      appliesFlag: ReinsuranceAppliesFlag,
    }`,
    { as: ReinsuranceField },
  ),
});

@field profit = contains(PolicyProfitField, {
  computeVia: expression(
    fx`{
      earnedPremium: EarnedPremium,
      netUltimateLoss: Reinsurance.NetUltimateLoss,        // ← from reinsurance
      totalExpense: Expenses.TotalExpense,
      catLoad: CatLoadUsd,
      capitalCharge: CapitalCharge,
      cededPremium: CededPremiumUsd,
      targetCombinedRatio: TargetCombinedRatio,
    }`,
    { as: PolicyProfitField },
  ),
});
```

Boxel handles the dependency tracking — when an upstream input
changes, every downstream FieldDef recomputes in order.

## Shape conventions

For the threading to work cleanly:

- **Match camelCase keys to the FieldDef's `@field` names.** The
  object literal becomes the materialized instance verbatim (via
  `Object.assign` in the no-getFields path, or `getFields`-aware
  walking inside a realm). Mismatched keys land as extra properties
  the FieldDef's computeds won't see.
- **Keep input field types ergonomic.** A `BooleanField` with a
  computed `appliesBool = AppliesFlag == "Yes"` is friendlier than
  asking the parent to project a `Yes`/`No` string into a boolean.
  See `CodeshareField.appliesBool` in `middle-wolverine`.
- **Don't double-wrap data.** If the parent already has the value at
  the right shape (e.g., `Aircraft.Seats` as a number), pass it
  through as a number. Don't re-roll it into an object unless the
  child needs structured data.

## When NOT to use this pattern

- The FieldDef has only one or two simple computeds. Just put them
  on the parent CardDef directly and skip the materialization round
  trip.
- The FieldDef's logic is tightly coupled to the parent — if every
  computeVia in the FieldDef references `Aircraft.X`, `Scenario.Y`,
  etc., the FieldDef isn't actually reusable. Inline it.
- You need access to a parent field that isn't easily expressed as
  a flat input. The `as` materialization is one-way (parent → child);
  the child can't reach back.

## Validating the threading

The simplest end-to-end check is to render the CardDef in a realm
and confirm the FieldDef-level dashboard shows numbers consistent
with the parent's raw inputs. The `tests/boxel/` suite locks the
mechanics:

- `expression-factory.ts` — the `as: Cls` materialization round trip.
- `materialize.ts` — the `Object.assign` fallback path that
  non-realm consumers (Node tests, CLI tools) hit when `getFields`
  isn't loaded.
- `fielddef-threading.ts` — multi-stage pipeline with one FieldDef's
  output threaded into another's input (mirrors the
  `prudent-octopus` insurance pipeline).

Each test names the port-doc section it asserts so a regression
trace points straight at the rule.
