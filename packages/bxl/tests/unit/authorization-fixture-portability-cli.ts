import { readdirSync, readFileSync, statSync } from 'node:fs';
import { strictEqual } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'authorization',
  'fixtures',
);

function jsonFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name !== 'openfga')
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory()
        ? jsonFiles(path)
        : path.endsWith('.json')
          ? [path]
          : [];
    });
}

const files = jsonFiles(fixturesRoot);
strictEqual(files.length >= 2, true, 'expected generalized product fixtures');

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const fixture = JSON.parse(source) as {
    provenance?: { generalized?: boolean };
  };
  strictEqual(
    fixture.provenance?.generalized,
    true,
    `${file} must declare generalized provenance`,
  );
  strictEqual(
    /https?:\/\/|realms-staging|app\.boxel\.ai|\/Users\//i.test(source),
    false,
    `${file} must not contain source realm URLs or workstation paths`,
  );
  strictEqual(
    /tribeca|classroom|student|teacher|instructor|service.?provider|education|attendance|kiosk/i.test(
      source,
    ),
    false,
    `${file} must not contain vocabulary from the removed realm-derived fixture`,
  );
}

console.log(
  `Authorization fixture portability: ${files.length} generalized fixtures contain no realm URLs or workstation paths`,
);
