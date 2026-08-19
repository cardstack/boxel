import type { CoverageCase } from './case.ts';

// Excel's argument order is BESSEL*(x, order), so the second argument selects
// which function of the family: BESSELJ(1, 0) is J₀(1).
//
// Expected values are the published references for J, Y, I and K at x = 1.
// The tolerance is 1e-6 because the underlying series approximation is
// accurate to roughly 1e-7 — tight enough that a wrong order or a wrong
// family still fails, since these four differ in the first decimal place.
//
// Each family is covered at both order 0 and order 1: the two orders run
// different code (order 1 is where the recurrence starts), and covering only
// order 0 leaves the order argument itself unasserted.
export const formulaBesselCases: CoverageCase[] = [
  {
    covers: 'BESSELJ/2',
    source: 'BESSELJ(1, 0)',
    expected: 0.7651976866,
    tolerance: 1e-6,
  },
  {
    covers: 'BESSELJ/2',
    source: 'BESSELJ(1, 1)',
    expected: 0.4400505857,
    tolerance: 1e-6,
  },
  {
    covers: 'BESSELY/2',
    source: 'BESSELY(1, 0)',
    expected: 0.0882569642,
    tolerance: 1e-6,
  },
  {
    covers: 'BESSELY/2',
    source: 'BESSELY(1, 1)',
    expected: -0.7812128213,
    tolerance: 1e-6,
  },
  {
    covers: 'BESSELI/2',
    source: 'BESSELI(1, 0)',
    expected: 1.2660658778,
    tolerance: 1e-6,
  },
  {
    covers: 'BESSELI/2',
    source: 'BESSELI(1, 1)',
    expected: 0.565159104,
    tolerance: 1e-6,
  },
  {
    covers: 'BESSELK/2',
    source: 'BESSELK(1, 0)',
    expected: 0.4210244382,
    tolerance: 1e-6,
  },
  {
    covers: 'BESSELK/2',
    source: 'BESSELK(1, 1)',
    expected: 0.6019072302,
    tolerance: 1e-6,
  },
];
