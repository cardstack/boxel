import { runNativeJqAsync } from '../index.js';

export type FormulaBundleValue =
  | null
  | boolean
  | number
  | string
  | FormulaBundleValue[]
  | { [key: string]: FormulaBundleValue };

export interface FormulaBundleStep {
  id: string;
  name: string;
  sourceFile: string;
  sourceField: string;
  expression: string;
  outputKey: string;
  expected: FormulaBundleValue;
  illustrates: string;
}

export interface FormulaBundle {
  id: string;
  name: string;
  sourceRealm: string;
  sourceUrl: string;
  description: string;
  input: Record<string, FormulaBundleValue>;
  steps: FormulaBundleStep[];
}

export interface FormulaBundleStepResult {
  step: FormulaBundleStep;
  value: FormulaBundleValue;
}

export interface FormulaBundleRunResult {
  bundle: FormulaBundle;
  values: Record<string, FormulaBundleValue>;
  results: FormulaBundleStepResult[];
}

export const realmFormulaBundles: FormulaBundle[] = [
  {
    id: 'airline-profitability',
    name: 'Airline flight profitability',
    sourceRealm: 'airline-demo',
    sourceUrl: 'local://examples/airline-profitability',
    description:
      'Representative formulas from AirlineFlight and its FieldDefs: scenario classification, fare realization, airport and crew costs, and contribution profit.',
    input: {
      flightNumber: 'AA1001',
      blockHours: 6.4,
      passengers: 183,
      cargoRevenueUsd: 1450,
      fuelGallons: 5650,
      scenario: {
        fuelPriceUsdGal: 2.85,
        demandFactor: 1,
        laborCostFactor: 1,
        maintenanceFactor: 1,
        fleetAvailabilityFactor: 1,
      },
      route: {
        origin: 'JFK',
        destination: 'LAX',
        distanceMiles: 2475,
      },
      aircraft: {
        aircraftType: 'A321neo',
        seats: 196,
        fixedCostUsdPerFlight: 5200,
        ownershipCostUsdPerBlockHour: 1750,
        maintenanceUsdPerBlockHour: 1100,
        maintenanceUsdPerCycle: 900,
      },
      originAirport: {
        landingFeeUsd: 4100,
        passengerFacilityChargeUsd: 4.5,
        securityFeeUsd: 5.6,
        gateFeeUsdPerTurn: 850,
        groundHandlingUsdPerTurn: 2200,
        peakSurchargeUsd: 500,
      },
      destinationAirport: {
        landingFeeUsd: 3900,
        passengerFacilityChargeUsd: 4.5,
        securityFeeUsd: 5.6,
        gateFeeUsdPerTurn: 780,
        groundHandlingUsdPerTurn: 2100,
        peakSurchargeUsd: 450,
      },
      representativeFareClass: {
        avgFareUsd: 410,
        ancillaryUsdPerPax: 32,
        refundRate: 0.03,
        commissionPct: 0.025,
      },
      crew: {
        pilotCount: 2,
        faCount: 4,
        pilotRateUsdPerBlockHour: 265,
        faRateUsdPerBlockHour: 72,
        minPayHours: 4,
        overnightCostUsd: 0,
        internationalPremiumPct: 0,
        blockHours: 6.4,
      },
    },
    steps: [
      {
        id: 'airline-scenario-stress-label',
        name: 'Scenario stress label',
        sourceFile: 'Airline/airline-fields.gts',
        sourceField: 'ScenarioField.stressLabel',
        expression:
          'IFS(Scenario.FuelPriceUsdGal >= 4, "Fuel shock", Scenario.DemandFactor < 0.95, "Demand down", Scenario.LaborCostFactor > 1.05, "Labor up", Scenario.FleetAvailabilityFactor < 0.95, "Fleet tight", TRUE, "Base case")',
        outputKey: 'scenarioStressLabel',
        expected: 'Base case',
        illustrates: 'Five-pair IFS fallback from the airline fixture.',
      },
      {
        id: 'airline-realized-revenue-per-pax',
        name: 'Realized revenue per passenger',
        sourceFile: 'Airline/airline-fields.gts',
        sourceField: 'FareClassField.realizedRevenuePerPax',
        expression:
          'ROUND(RepresentativeFareClass.AvgFareUsd * (1 - RepresentativeFareClass.RefundRate) * (1 - RepresentativeFareClass.CommissionPct) + RepresentativeFareClass.AncillaryUsdPerPax, 2)',
        outputKey: 'realizedRevenuePerPax',
        expected: 419.76,
        illustrates: 'Fare net-of-refunds and commission plus ancillary revenue.',
      },
      {
        id: 'airline-total-airport-fees',
        name: 'Total airport fees',
        sourceFile: 'Airline/airline-flight.gts',
        sourceField: 'AirlineFlight.totalAirportFeesUsd',
        expression:
          'ROUND(Passengers * (OriginAirport.PassengerFacilityChargeUsd + OriginAirport.SecurityFeeUsd + DestinationAirport.PassengerFacilityChargeUsd + DestinationAirport.SecurityFeeUsd) + OriginAirport.LandingFeeUsd + DestinationAirport.LandingFeeUsd + OriginAirport.GateFeeUsdPerTurn + OriginAirport.GroundHandlingUsdPerTurn + OriginAirport.PeakSurchargeUsd + DestinationAirport.GateFeeUsdPerTurn + DestinationAirport.GroundHandlingUsdPerTurn + DestinationAirport.PeakSurchargeUsd, 2)',
        outputKey: 'totalAirportFeesUsd',
        expected: 18576.6,
        illustrates: 'Nested FieldDef cost rollup with passenger and turn fees.',
      },
      {
        id: 'airline-crew-cost',
        name: 'Crew cost',
        sourceFile: 'Airline/airline-fields.gts',
        sourceField: 'CrewField.totalCrewCost',
        expression:
          'ROUND((Crew.PilotCount * Crew.PilotRateUsdPerBlockHour + Crew.FaCount * Crew.FaRateUsdPerBlockHour) * MAX(Crew.BlockHours, Crew.MinPayHours) * (1 + Crew.InternationalPremiumPct) + Crew.OvernightCostUsd, 2)',
        outputKey: 'crewCostUsd',
        expected: 5235.2,
        illustrates: 'Crew pay floor plus optional international premium.',
      },
      {
        id: 'airline-maintenance-cost',
        name: 'Maintenance cost',
        sourceFile: 'Airline/airline-flight.gts',
        sourceField: 'AirlineFlight.maintenanceCostUsd',
        expression:
          'ROUND((BlockHours * Aircraft.MaintenanceUsdPerBlockHour + Aircraft.MaintenanceUsdPerCycle) * Scenario.MaintenanceFactor, 2)',
        outputKey: 'maintenanceCostUsd',
        expected: 7940,
        illustrates: 'Block-hour plus per-cycle maintenance cost.',
      },
      {
        id: 'airline-ownership-cost',
        name: 'Ownership cost',
        sourceFile: 'Airline/airline-flight.gts',
        sourceField: 'AirlineFlight.ownershipCostUsd',
        expression:
          'ROUND(BlockHours * Aircraft.OwnershipCostUsdPerBlockHour, 2)',
        outputKey: 'ownershipCostUsd',
        expected: 11200,
        illustrates: 'Aircraft ownership charge by block hour.',
      },
      {
        id: 'airline-fuel-cost',
        name: 'Fuel cost',
        sourceFile: 'Airline/airline-fields.gts',
        sourceField: 'FlightProfitField.fuelCostUsd',
        expression: 'ROUND(FuelGallons * Scenario.FuelPriceUsdGal, 2)',
        outputKey: 'fuelCostUsd',
        expected: 16102.5,
        illustrates: 'Fuel gallons multiplied by scenario fuel price.',
      },
      {
        id: 'airline-contribution-profit',
        name: 'Contribution profit',
        sourceFile: 'Airline/airline-fields.gts',
        sourceField: 'FlightProfitField.contributionProfit',
        expression:
          'ROUND(Passengers * RealizedRevenuePerPax + CargoRevenueUsd - (FuelCostUsd + CrewCostUsd + TotalAirportFeesUsd + MaintenanceCostUsd + OwnershipCostUsd + Aircraft.FixedCostUsdPerFlight), 2)',
        outputKey: 'contributionProfit',
        expected: 14011.78,
        illustrates: 'Revenue minus parenthesized operating-cost stack.',
      },
      {
        id: 'airline-breakeven-load-factor',
        name: 'Breakeven load factor',
        sourceFile: 'Airline/airline-fields.gts',
        sourceField: 'FlightProfitField.breakevenLoadFactor',
        expression:
          'ROUND((FuelCostUsd + CrewCostUsd + TotalAirportFeesUsd + MaintenanceCostUsd + OwnershipCostUsd + Aircraft.FixedCostUsdPerFlight) / (Aircraft.Seats * (((Passengers * RealizedRevenuePerPax) + CargoRevenueUsd) / Passengers)), 4)',
        outputKey: 'breakevenLoadFactor',
        expected: 0.7665,
        illustrates: 'Cost stack divided by seat count and realized revenue per passenger.',
      },
      {
        id: 'airline-profit-flag',
        name: 'Profit flag',
        sourceFile: 'Airline/airline-fields.gts',
        sourceField: 'FlightProfitField.profitFlag',
        expression:
          'IFS(ContributionProfit > 1000, "Profit", ContributionProfit < -1000, "Loss", TRUE, "Breakeven")',
        outputKey: 'profitFlag',
        expected: 'Profit',
        illustrates: 'Card status label derived from contribution profit.',
      },
    ],
  },
  {
    id: 'acoustic-resonance',
    name: 'Acoustic resonance screen',
    sourceRealm: 'acoustic-demo',
    sourceUrl: 'local://examples/acoustic-resonance',
    description:
      'Representative formulas from PipeResonance: compressor excitation, acoustic mode frequency, Bessel mode shape, amplification, and fatigue classification.',
    input: {
      longitudinalModeNumber: 1,
      radiusFraction: 0,
      segment: {
        length: 18.5,
        innerDiameter: 0.254,
        dampingRatio: 0.025,
        allowableFatigueStress: 120,
      },
      operatingCase: {
        compressorRPM: 9420,
        bladePassCount: 8,
        baseStress: 24,
      },
      fluid: {
        speedOfSound: 430,
      },
      besselMode: {
        orderN: 0,
        root: 2.404825558,
      },
    },
    steps: [
      {
        id: 'acoustic-pipe-radius',
        name: 'Pipe radius',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'PipeSegmentField.pipeRadius',
        expression: 'Segment.InnerDiameter / 2',
        outputKey: 'pipeRadius',
        expected: 0.127,
        illustrates: 'Basic derived geometry.',
      },
      {
        id: 'acoustic-excitation-frequency',
        name: 'Excitation frequency',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'OperatingCaseField.excitationFrequency',
        expression:
          'ROUND((OperatingCase.CompressorRPM / 60) * OperatingCase.BladePassCount * 100) / 100',
        outputKey: 'excitationFrequency',
        expected: 1256,
        illustrates: 'Compressor RPM and blade-pass count converted to Hz.',
      },
      {
        id: 'acoustic-radial-cutoff-frequency',
        name: 'Radial cutoff frequency',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'AcousticModeResultField.radialCutoffFrequency',
        expression:
          'ROUND(BesselMode.Root * Fluid.SpeedOfSound / (2 * PI() * PipeRadius) * 100) / 100',
        outputKey: 'radialCutoffFrequency',
        expected: 1295.89,
        illustrates: 'Circular-duct acoustic cutoff from a Bessel root.',
      },
      {
        id: 'acoustic-longitudinal-frequency',
        name: 'Longitudinal frequency',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'AcousticModeResultField.longitudinalFrequency',
        expression:
          'ROUND((LongitudinalModeNumber * Fluid.SpeedOfSound) / (2 * Segment.Length) * 100) / 100',
        outputKey: 'longitudinalFrequency',
        expected: 11.62,
        illustrates: 'Longitudinal standing-wave component.',
      },
      {
        id: 'acoustic-combined-frequency',
        name: 'Combined acoustic frequency',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'AcousticModeResultField.combinedAcousticFrequency',
        expression:
          'ROUND(SQRT(POWER(RadialCutoffFrequency, 2) + POWER(LongitudinalFrequency, 2)) * 100) / 100',
        outputKey: 'combinedAcousticFrequency',
        expected: 1295.94,
        illustrates: 'Root-sum-square combination of radial and longitudinal modes.',
      },
      {
        id: 'acoustic-frequency-ratio',
        name: 'Frequency ratio',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'AcousticModeResultField.frequencyRatio',
        expression:
          'ROUND(ExcitationFrequency / CombinedAcousticFrequency * 10000) / 10000',
        outputKey: 'frequencyRatio',
        expected: 0.9692,
        illustrates: 'How close excitation is to acoustic mode frequency.',
      },
      {
        id: 'acoustic-separation-margin',
        name: 'Separation margin',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'AcousticModeResultField.separationMargin',
        expression:
          'ROUND(ABS(ExcitationFrequency - CombinedAcousticFrequency) / CombinedAcousticFrequency * 10000) / 10000',
        outputKey: 'separationMargin',
        expected: 0.0308,
        illustrates: 'Relative spacing between excitation and acoustic mode.',
      },
      {
        id: 'acoustic-risk-flag',
        name: 'Risk flag',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'AcousticModeResultField.riskFlag',
        expression:
          'IFS(SeparationMargin < 0.05, "High Risk", SeparationMargin < 0.10, "Review", TRUE, "OK")',
        outputKey: 'riskFlag',
        expected: 'High Risk',
        illustrates: 'IFS thresholding around resonance separation.',
      },
      {
        id: 'acoustic-mode-shape',
        name: 'Bessel mode shape',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'StressScreenField.modeShape',
        expression:
          'ROUND(BESSELJ(BesselMode.Root * RadiusFraction, BesselMode.OrderN) * 100000) / 100000',
        outputKey: 'modeShape',
        expected: 1,
        illustrates: 'Lazy Bessel function load through BESSELJ.',
      },
      {
        id: 'acoustic-mode-amplitude',
        name: 'Absolute mode amplitude',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'StressScreenField.absModeAmplitude',
        expression: 'ROUND(ABS(ModeShape) * 100000) / 100000',
        outputKey: 'absModeAmplitude',
        expected: 1,
        illustrates: 'Mode amplitude used by dynamic stress.',
      },
      {
        id: 'acoustic-pressure-amplification',
        name: 'Pressure amplification',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'StressScreenField.pressureAmplification',
        expression:
          'ROUND(1 / SQRT(POWER(1 - POWER(FrequencyRatio, 2), 2) + POWER(2 * Segment.DampingRatio * FrequencyRatio, 2)) * 1000) / 1000',
        outputKey: 'pressureAmplification',
        expected: 12.881,
        illustrates: 'Resonance amplification around frequency ratio.',
      },
      {
        id: 'acoustic-dynamic-stress',
        name: 'Dynamic stress',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'StressScreenField.dynamicStress',
        expression:
          'ROUND(OperatingCase.BaseStress * PressureAmplification * AbsModeAmplitude * 100) / 100',
        outputKey: 'dynamicStress',
        expected: 309.14,
        illustrates: 'Base stress scaled by amplification and mode amplitude.',
      },
      {
        id: 'acoustic-fatigue-utilization',
        name: 'Fatigue utilization',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'StressScreenField.fatigueUtilization',
        expression:
          'ROUND(DynamicStress / Segment.AllowableFatigueStress * 1000) / 1000',
        outputKey: 'fatigueUtilization',
        expected: 2.576,
        illustrates: 'Dynamic stress as a multiple of allowable fatigue stress.',
      },
      {
        id: 'acoustic-fatigue-flag',
        name: 'Fatigue flag',
        sourceFile: 'Acoustic/pipe-resonance-fields.gts',
        sourceField: 'StressScreenField.fatigueFlag',
        expression:
          'IFS(FatigueUtilization >= 1.00, "Fail", FatigueUtilization >= 0.75, "Review", TRUE, "Pass")',
        outputKey: 'fatigueFlag',
        expected: 'Fail',
        illustrates: 'Final screening status from fatigue utilization.',
      },
    ],
  },
  {
    id: 'policy-tracking',
    name: 'Insurance policy tracking',
    sourceRealm: 'insurance-demo',
    sourceUrl: 'local://examples/policy-tracking',
    description:
      'Representative formulas from Policy and Claim tracking: financing, coverage bitmasks, claim aggregation, severity statistics, and tail-risk simulation.',
    input: {
      policyId: 'POL-A-100',
      policyStatus: 'Active',
      issueDate: '2024-03-15',
      effectiveDate: '2024-03-15',
      expirationDate: '2026-03-15',
      asOfDate: '2026-04-15',
      annualPremium: 1820,
      paymentFrequency: 'Monthly',
      financingApr: 0.0795,
      aggregateLimit: 100000,
      projectedYearTwoPremium: 1874.6,
      projectedYearThreePremium: 1930.84,
      projectedYearFourPremium: 1988.76,
      projectedYearFivePremium: 2048.43,
      coverageFlags: 39,
      claims: [
        {
          claimId: 'CLM-001',
          dateOfLoss: '2024-09-12',
          dateReported: '2024-09-13',
          dateClosed: '2024-10-15',
          asOfDate: '2026-04-15',
          claimStatus: 'Closed',
          paidAmount: 350,
          reserveAmount: 0,
          uTailQuantile: 0.5,
          severityMu: 7,
          severitySigma: 0.6,
        },
        {
          claimId: 'CLM-002',
          dateOfLoss: '2025-04-22',
          dateReported: '2025-04-25',
          dateClosed: '2025-05-30',
          asOfDate: '2026-04-15',
          claimStatus: 'Closed',
          paidAmount: 480,
          reserveAmount: 0,
          uTailQuantile: 0.3,
          severityMu: 6.5,
          severitySigma: 0.5,
        },
      ],
    },
    steps: [
      {
        id: 'policy-term-length-months',
        name: 'Term length months',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.termLengthMonths',
        expression: 'DATEDIF(EffectiveDate, ExpirationDate, "M")',
        outputKey: 'termLengthMonths',
        expected: 24,
        illustrates: 'Policy term date math.',
      },
      {
        id: 'policy-payments-per-year',
        name: 'Payments per year',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.paymentsPerYear',
        expression:
          'IFS(PaymentFrequency = "Monthly", 12, PaymentFrequency = "Quarterly", 4, TRUE, 1)',
        outputKey: 'paymentsPerYear',
        expected: 12,
        illustrates: 'Payment cadence classification.',
      },
      {
        id: 'policy-monthly-payment',
        name: 'Monthly payment',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.monthlyPayment',
        expression:
          'ROUND(ABS(PMT(FinancingApr / 12, 12, -AnnualPremium)) * 100) / 100',
        outputKey: 'monthlyPayment',
        expected: 158.28,
        illustrates: 'Lazy financial PMT calculation.',
      },
      {
        id: 'policy-effective-annual-rate',
        name: 'Effective annual rate',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.effectiveAnnualRate',
        expression: 'ROUND(EFFECT(FinancingApr, 12) * 10000) / 10000',
        outputKey: 'effectiveAnnualRate',
        expected: 0.0825,
        illustrates: 'Nominal APR converted to effective annual rate.',
      },
      {
        id: 'policy-npv-premium-stream',
        name: 'NPV premium stream',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.npvPremiumStream5y',
        expression:
          'ROUND(NPV(0.045, [AnnualPremium, ProjectedYearTwoPremium, ProjectedYearThreePremium, ProjectedYearFourPremium, ProjectedYearFivePremium]) * 100) / 100',
        outputKey: 'npvPremiumStream5y',
        expected: 8461.7,
        illustrates: 'Lazy financial NPV over projected premiums.',
      },
      {
        id: 'policy-coverage-flags-binary',
        name: 'Coverage flags binary',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.coverageFlagsBinary',
        expression: 'DEC2BIN(CoverageFlags, 8)',
        outputKey: 'coverageFlagsBinary',
        expected: '00100111',
        illustrates: 'Engineering base conversion for coverage bitmasks.',
      },
      {
        id: 'policy-has-collision',
        name: 'Collision flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.hasCollision',
        expression: 'BITAND(CoverageFlags, 1)',
        outputKey: 'hasCollision',
        expected: 1,
        illustrates: 'Bitmask membership with BITAND.',
      },
      {
        id: 'policy-has-comprehensive',
        name: 'Comprehensive flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.hasComprehensive',
        expression: 'BITAND(CoverageFlags, 2)',
        outputKey: 'hasComprehensive',
        expected: 2,
        illustrates: 'Second coverage bit extracted from the mask.',
      },
      {
        id: 'policy-has-glass',
        name: 'Glass flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.hasGlass',
        expression: 'BITAND(CoverageFlags, 4)',
        outputKey: 'hasGlass',
        expected: 4,
        illustrates: 'Third coverage bit extracted from the mask.',
      },
      {
        id: 'policy-has-towing',
        name: 'Towing flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.hasTowing',
        expression: 'BITAND(CoverageFlags, 8)',
        outputKey: 'hasTowing',
        expected: 0,
        illustrates: 'Absent coverage bit remains zero.',
      },
      {
        id: 'policy-has-rental',
        name: 'Rental flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.hasRental',
        expression: 'BITAND(CoverageFlags, 16)',
        outputKey: 'hasRental',
        expected: 0,
        illustrates: 'Absent rental bit remains zero.',
      },
      {
        id: 'policy-has-gap',
        name: 'Gap flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.hasGap',
        expression: 'BITAND(CoverageFlags, 32)',
        outputKey: 'hasGap',
        expected: 32,
        illustrates: 'Gap coverage bit extracted from the mask.',
      },
      {
        id: 'policy-has-roadside',
        name: 'Roadside flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.hasRoadside',
        expression: 'BITAND(CoverageFlags, 64)',
        outputKey: 'hasRoadside',
        expected: 0,
        illustrates: 'Absent roadside bit remains zero.',
      },
      {
        id: 'policy-has-accident-forgiveness',
        name: 'Accident forgiveness flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.hasAccidentForgiveness',
        expression: 'BITAND(CoverageFlags, 128)',
        outputKey: 'hasAccidentForgiveness',
        expected: 0,
        illustrates: 'Absent accident-forgiveness bit remains zero.',
      },
      {
        id: 'policy-coverage-bundle-score',
        name: 'Coverage bundle score',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.coverageBundleScore',
        expression:
          'HasCollision + HasComprehensive + HasGlass + HasTowing + HasRental + HasGap + HasRoadside + HasAccidentForgiveness',
        outputKey: 'coverageBundleScore',
        expected: 39,
        illustrates: 'Derived score from previously computed coverage flags.',
      },
      {
        id: 'policy-claim-count',
        name: 'Claim count',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.claimCount',
        expression: '[.claims[]] | length',
        outputKey: 'claimCount',
        expected: 2,
        illustrates: 'jq collection aggregation over linked claims.',
      },
      {
        id: 'policy-paid-claims-total',
        name: 'Paid claims total',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.paidClaimsTotal',
        expression:
          '([.claims[] | .paidAmount] | add // 0 | . * 100 | round) / 100',
        outputKey: 'paidClaimsTotal',
        expected: 830,
        illustrates: 'jq sum with null-safe fallback.',
      },
      {
        id: 'policy-reserved-claims-total',
        name: 'Reserved claims total',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.reservedClaimsTotal',
        expression:
          '([.claims[] | .reserveAmount] | add // 0 | . * 100 | round) / 100',
        outputKey: 'reservedClaimsTotal',
        expected: 0,
        illustrates: 'Reserve aggregation over the same claims.',
      },
      {
        id: 'policy-incurred-loss-total',
        name: 'Incurred loss total',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.incurredLossTotal',
        expression: 'ROUND((PaidClaimsTotal + ReservedClaimsTotal) * 100) / 100',
        outputKey: 'incurredLossTotal',
        expected: 830,
        illustrates: 'Paid plus reserve rollup.',
      },
      {
        id: 'policy-loss-ratio',
        name: 'Loss ratio',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.lossRatio',
        expression:
          'ROUND(IncurredLossTotal / AnnualPremium * 10000) / 10000',
        outputKey: 'lossRatio',
        expected: 0.456,
        illustrates: 'Policy incurred loss divided by annual premium.',
      },
      {
        id: 'policy-claim-severity-mean',
        name: 'Claim severity mean',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.claimSeverityMean',
        expression:
          '([.claims[] | (.paidAmount + .reserveAmount)] | if length == 0 then 0 else (add / length) end | . * 100 | round) / 100',
        outputKey: 'claimSeverityMean',
        expected: 415,
        illustrates: 'Mean claim severity over paid plus reserve.',
      },
      {
        id: 'policy-claim-severity-stdev',
        name: 'Claim severity standard deviation',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.claimSeverityStdev',
        expression:
          '([.claims[] | (.paidAmount + .reserveAmount)] as $xs | if ($xs | length) <= 1 then 0 else ($xs | add) / ($xs | length) as $mean | (([$xs[] | (. - $mean) * (. - $mean)] | add) / (($xs | length) - 1) | sqrt) end | . * 100 | round) / 100',
        outputKey: 'claimSeverityStdev',
        expected: 1.4,
        illustrates: 'Sample standard deviation written in jq.',
      },
      {
        id: 'policy-large-loss-probability',
        name: 'Large loss probability',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.probabilityLargeLoss',
        expression:
          'IF(ClaimSeverityStdev > 0, ROUND(0.5 * (1 - ERF((25000 - ClaimSeverityMean) / (ClaimSeverityStdev * SQRT(2)))) * 10000) / 10000, 0)',
        outputKey: 'probabilityLargeLoss',
        expected: 0,
        illustrates: 'Engineering ERF probability approximation.',
      },
      {
        id: 'policy-severity-confidence-half-width',
        name: 'Severity confidence half-width',
        sourceFile: 'Tracking/portfolio.gts',
        sourceField: 'Portfolio.lossConfidenceHalfWidth95',
        expression:
          'IF(ClaimCount > 1, ROUND(T.INV.2T(0.05, ClaimCount - 1) * ClaimSeverityStdev / SQRT(ClaimCount) * 100) / 100, 0)',
        outputKey: 'severityConfidenceHalfWidth95',
        expected: 12.58,
        illustrates: 'Lazy statistical T.INV.2T confidence interval shape.',
      },
      {
        id: 'policy-profitability-flag',
        name: 'Profitability flag',
        sourceFile: 'Tracking/policy.gts',
        sourceField: 'Policy.profitabilityFlag',
        expression:
          'IFS(LossRatio >= 1.20, "Loss-Making", LossRatio >= 0.80, "Marginal", LossRatio >= 0.40, "Profitable", TRUE, "Highly Profitable")',
        outputKey: 'profitabilityFlag',
        expected: 'Profitable',
        illustrates: 'Policy status derived from loss ratio.',
      },
      {
        id: 'claim-incurred-amount',
        name: 'First claim incurred amount',
        sourceFile: 'Tracking/claim.gts',
        sourceField: 'Claim.incurredAmount',
        expression:
          'ROUND((Claims[#1].PaidAmount + Claims[#1].ReserveAmount) * 100) / 100',
        outputKey: 'firstClaimIncurredAmount',
        expected: 350,
        illustrates: 'Claim-level incurred amount using BXL one-based row access.',
      },
      {
        id: 'claim-tail-factor',
        name: 'First claim tail factor',
        sourceFile: 'Tracking/claim.gts',
        sourceField: 'Claim.tailFactor',
        expression:
          'ROUND(LOGNORM.INV(Claims[#1].UTailQuantile, Claims[#1].SeverityMu, Claims[#1].SeveritySigma) * 10000) / 10000',
        outputKey: 'firstClaimTailFactor',
        expected: 1096.6332,
        illustrates: 'Lazy statistical LOGNORM.INV tail factor.',
      },
      {
        id: 'claim-tail-loss-simulated',
        name: 'First claim simulated tail loss',
        sourceFile: 'Tracking/claim.gts',
        sourceField: 'Claim.tailLossSimulated',
        expression:
          'ROUND(FirstClaimIncurredAmount * FirstClaimTailFactor * 100) / 100',
        outputKey: 'firstClaimTailLossSimulated',
        expected: 383821.62,
        illustrates: 'Claim incurred loss scaled by lognormal tail factor.',
      },
      {
        id: 'claim-probability-exceeds-large-loss',
        name: 'First claim probability exceeds large loss',
        sourceFile: 'Tracking/claim.gts',
        sourceField: 'Claim.probabilityExceedsLargeLoss',
        expression:
          'ROUND(0.5 * (1 - ERF((50000 - FirstClaimIncurredAmount) / (20000 * SQRT(2)))) * 10000) / 10000',
        outputKey: 'firstClaimProbabilityExceedsLargeLoss',
        expected: 0.0065,
        illustrates: 'Claim-level normal-tail probability using ERF.',
      },
    ],
  },
];

export function getFormulaBundle(id: string): FormulaBundle | undefined {
  return realmFormulaBundles.find((bundle) => bundle.id === id);
}

export async function runFormulaBundle(
  bundle: FormulaBundle,
): Promise<FormulaBundleRunResult> {
  const values = cloneFormulaBundleInput(bundle);
  const results: FormulaBundleStepResult[] = [];

  for (const step of bundle.steps) {
    const result = await runNativeJqAsync(step.expression, values);
    const value = normalizeOutputs(result.outputs);
    values[step.outputKey] = value;
    results.push({ step, value });
  }

  return { bundle, values, results };
}

function cloneFormulaBundleInput(
  bundle: FormulaBundle,
): Record<string, FormulaBundleValue> {
  return JSON.parse(JSON.stringify(bundle.input)) as Record<
    string,
    FormulaBundleValue
  >;
}

function normalizeOutputs(outputs: unknown[]): FormulaBundleValue {
  if (outputs.length === 0) return null;
  if (outputs.length === 1) return outputs[0] as FormulaBundleValue;
  return outputs as FormulaBundleValue[];
}
