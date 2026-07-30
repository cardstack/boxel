import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildHostToolsSkill,
  deriveHostToolImports,
  findHostImportViolations,
} from '../src/host-import-manifest.ts';
import { ImportsValidationStep } from '../src/validators/imports-step.ts';

const MANIFEST = new Set([
  'get-card-type-schema',
  'write-binary-file',
  'one-shot-llm-request',
  'bot-requests/openrouter-image',
]);

test('a known tool under the legacy commands/ alias is valid (the shim registers both)', () => {
  let source = `
import GetCardTypeSchemaCommand from '@cardstack/boxel-host/commands/get-card-type-schema';
import { restartable } from 'ember-concurrency';
`;
  assert.deepEqual(findHostImportViolations(source, MANIFEST), []);
});

test('an unknown name under commands/ is a violation with a near-match', () => {
  let source = `
import Cmd from '@cardstack/boxel-host/commands/card-type-schema';
`;
  let violations = findHostImportViolations(source, MANIFEST);
  assert.equal(violations.length, 1);
  assert.match(
    violations[0].suggestion ?? '',
    /did you mean '@cardstack\/boxel-host\/tools\/get-card-type-schema'/,
  );
});

test('findHostImportViolations flags unknown tools with a near-match suggestion', () => {
  let source = `
import SchemaCommand from '@cardstack/boxel-host/tools/card-type-schema';
import WriteBinary from "@cardstack/boxel-host/tools/write-binary-file";
const lazy = await import('@cardstack/boxel-host/tools/no-such-tool');
`;
  let violations = findHostImportViolations(source, MANIFEST);
  assert.equal(violations.length, 2);
  assert.match(
    violations[0].suggestion ?? '',
    /did you mean '@cardstack\/boxel-host\/tools\/get-card-type-schema'/,
  );
  assert.equal(
    violations[1].specifier,
    '@cardstack/boxel-host/tools/no-such-tool',
  );
});

test('non-gated boxel-host subpaths and valid tools pass', () => {
  let source = `
import { getCard } from '@cardstack/boxel-host/resources/card-resource';
import OneShot from '@cardstack/boxel-host/tools/one-shot-llm-request';
import ImageGen from '@cardstack/boxel-host/tools/bot-requests/openrouter-image';
`;
  assert.deepEqual(findHostImportViolations(source, MANIFEST), []);
});

test('deriveHostToolImports reads the shim registry, flat names included', async () => {
  let dir = await mkdtemp(join(tmpdir(), 'host-tools-'));
  try {
    // Mirrors the real registry: a file in a subdirectory registers
    // under a FLAT name; only registered names resolve at runtime.
    let registry = join(dir, 'index.ts');
    await writeFile(
      registry,
      `
import * as CopyCardModule from './copy-card';
import * as ImageModule from './bot-requests/openrouter-image';
export function shimHostTools(virtualNetwork: VirtualNetwork) {
  shimHostToolModule(virtualNetwork, 'copy-card', CopyCardModule);
  shimHostToolModule(
    virtualNetwork,
    'openrouter-image',
    ImageModule,
  );
}
`,
    );
    let names = await deriveHostToolImports(registry);
    assert.deepEqual(names, ['copy-card', 'openrouter-image']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deriveHostToolImports returns undefined for a missing registry (gate disabled)', async () => {
  let names = await deriveHostToolImports('/no/such/host/tools/index.ts');
  assert.equal(names, undefined);
});

test('buildHostToolsSkill lists every module and names tools/ as canonical', () => {
  let skill = buildHostToolsSkill(['copy-card', 'get-card']);
  assert.equal(skill.name, 'host-tools-import-manifest');
  assert.match(skill.content, /@cardstack\/boxel-host\/tools\/copy-card/);
  assert.match(skill.content, /`tools\/` is canonical/);
  assert.match(skill.content, /legacy alias/);
});

test('ImportsValidationStep fails workspace .gts with phantom imports', async () => {
  let workspaceDir = await mkdtemp(join(tmpdir(), 'imports-step-'));
  try {
    await writeFile(
      join(workspaceDir, 'wardrobe-ai.gts'),
      `import Cmd from '@cardstack/boxel-host/tools/one-shot-llm-requests';`,
    );
    await writeFile(
      join(workspaceDir, 'garment.gts'),
      `import S from 'https://cardstack.com/base/string';`,
    );
    let step = new ImportsValidationStep({
      workspaceDir,
      hostToolImports: [...MANIFEST],
    });
    let result = await step.run();
    assert.equal(result.passed, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].file, 'wardrobe-ai.gts');
    assert.match(step.formatForContext(result), /Host import check FAILED/);

    // Fix the import — the step passes.
    await writeFile(
      join(workspaceDir, 'wardrobe-ai.gts'),
      `import Cmd from '@cardstack/boxel-host/tools/one-shot-llm-request';`,
    );
    let fixed = await step.run();
    assert.equal(fixed.passed, true);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
