import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runOpenFgaConformanceFixtures,
  type OpenFgaConformanceReport,
} from './openfga-conformance-core.ts';
import { verifyOpenFgaFixtureInventory } from './openfga-fixtures.ts';

export * from './openfga-conformance-core.ts';

export function runOpenFgaConformance(): OpenFgaConformanceReport {
  const inventory = verifyOpenFgaFixtureInventory();
  const report = runOpenFgaConformanceFixtures(
    inventory.manifest.files.map((file) => ({
      path: file.path,
      source: readFileSync(join(inventory.root, file.path), 'utf8'),
    })),
  );

  if (report.discovered !== inventory.counts.assertions) {
    throw new Error(
      `Verified fixture inventory contains ${inventory.counts.assertions} assertions, but the runner discovered ${report.discovered}.`,
    );
  }

  return report;
}
