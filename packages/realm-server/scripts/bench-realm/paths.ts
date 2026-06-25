import { resolve } from 'node:path';

export const benchRoot = import.meta.dirname;
export const fixturesDir = resolve(benchRoot, 'fixtures');
export const realmSnapshotDir = resolve(fixturesDir, 'realm-snapshot');
export const baselinePath = resolve(benchRoot, 'baseline.json');
