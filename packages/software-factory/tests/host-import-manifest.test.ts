import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
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

test('findHostImportViolations flags legacy commands/ imports with the rename fix', () => {
  let source = `
import GetCardTypeSchemaCommand from '@cardstack/boxel-host/commands/get-card-type-schema';
import { restartable } from 'ember-concurrency';
`;
  let violations = findHostImportViolations(source, MANIFEST);
  assert.equal(violations.length, 1);
  assert.equal(
    violations[0].specifier,
    '@cardstack/boxel-host/commands/get-card-type-schema',
  );
  assert.match(violations[0].suggestion ?? '', /renamed commands\/ to tools\//);
  assert.match(violations[0].suggestion ?? '', /tools\/get-card-type-schema/);
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

test('deriveHostToolImports walks the tools tree recursively', async () => {
  let dir = await mkdtemp(join(tmpdir(), 'host-tools-'));
  try {
    await writeFile(join(dir, 'copy-card.ts'), 'export default class {}');
    await mkdir(join(dir, 'bot-requests'));
    await writeFile(
      join(dir, 'bot-requests', 'image.ts'),
      'export default class {}',
    );
    await writeFile(join(dir, 'README.md'), 'not a module');
    let names = await deriveHostToolImports(dir);
    assert.deepEqual(names, ['bot-requests/image', 'copy-card']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deriveHostToolImports returns undefined for a missing dir (gate disabled)', async () => {
  let names = await deriveHostToolImports('/no/such/host/tools');
  assert.equal(names, undefined);
});

test('buildHostToolsSkill lists every module and states the rename', () => {
  let skill = buildHostToolsSkill(['copy-card', 'get-card']);
  assert.equal(skill.name, 'host-tools-import-manifest');
  assert.match(skill.content, /@cardstack\/boxel-host\/tools\/copy-card/);
  assert.match(skill.content, /commands\/.*NO LONGER EXISTS/s);
});

test('ImportsValidationStep fails workspace .gts with phantom imports', async () => {
  let workspaceDir = await mkdtemp(join(tmpdir(), 'imports-step-'));
  try {
    await writeFile(
      join(workspaceDir, 'wardrobe-ai.gts'),
      `import Cmd from '@cardstack/boxel-host/commands/one-shot-llm-request';`,
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
