import { strict as assert } from 'assert';
import { existsSync, readFileSync } from 'fs';
import { test } from 'node:test';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import {
  SYNAPSE_TEMPLATE_SPECS_DIR,
  assignSpecFiles,
  discoverSpecFiles,
  loadSpecTimings,
  parseShardCoordinates,
  specFileMatchers,
  specSynapseTemplates,
  synapseTemplateOf,
} from './shard-spec-files.ts';

const testDir = join(import.meta.dirname, '..', 'tests');
const timingsPath = join(testDir, 'spec-timings.json');

function assignAll(
  specFiles: string[],
  shardCount: number,
  timings: Record<string, number>,
) {
  return Array.from({ length: shardCount }, (_unused, i) =>
    assignSpecFiles(specFiles, i + 1, shardCount, timings),
  );
}

test('the shards partition the spec files', () => {
  let specFiles = discoverSpecFiles(testDir);
  let timings = loadSpecTimings(timingsPath);
  for (let shardCount of [1, 2, 3, 4, 7, 30]) {
    let shards = assignAll(specFiles, shardCount, timings);
    let assigned = shards.flat();
    assert.equal(
      assigned.length,
      new Set(assigned).size,
      `shardCount=${shardCount}: a spec file was assigned to more than one shard`,
    );
    assert.deepEqual(
      assigned.sort(),
      [...specFiles].sort(),
      `shardCount=${shardCount}: the shards do not cover every spec file`,
    );
  }
});

test('spec files with no recorded timing are still assigned', () => {
  let specFiles = ['known.spec.ts', 'brand-new.spec.ts'];
  let shards = assignAll(specFiles, 2, { 'known.spec.ts': 30 });
  assert.deepEqual(shards.flat().sort(), [...specFiles].sort());
});

test('the heaviest spec files land on different shards', () => {
  let shards = assignAll(
    ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts'],
    2,
    {
      'a.spec.ts': 100,
      'b.spec.ts': 90,
      'c.spec.ts': 10,
      'd.spec.ts': 5,
    },
  );
  assert.deepEqual(shards, [
    ['a.spec.ts', 'd.spec.ts'],
    ['b.spec.ts', 'c.spec.ts'],
  ]);
});

test('zero-weight spec files are spread rather than collected', () => {
  let specFiles = ['w.spec.ts', 'x.spec.ts', 'y.spec.ts', 'z.spec.ts'];
  let shards = assignAll(specFiles, 2, {
    'w.spec.ts': 0,
    'x.spec.ts': 0,
    'y.spec.ts': 0,
    'z.spec.ts': 0,
  });
  assert.deepEqual(
    shards.map((files) => files.length),
    [2, 2],
  );
});

test('assignment is independent of the order files are discovered in', () => {
  let specFiles = discoverSpecFiles(testDir);
  let timings = loadSpecTimings(timingsPath);
  assert.deepEqual(
    assignAll([...specFiles].reverse(), 3, timings),
    assignAll(specFiles, 3, timings),
  );
});

test('a matcher selects its own spec file and no other', () => {
  let [matcher] = specFileMatchers(testDir, ['login.spec.ts']);
  assert.ok(matcher.test(join(testDir, 'login.spec.ts')));
  assert.ok(!matcher.test(join(testDir, 'login-using-email.spec.ts')));
  assert.ok(!matcher.test(join(testDir, 'nested', 'login.spec.ts')));
});

test('the timings file names only spec files that exist', () => {
  let specFiles = new Set(discoverSpecFiles(testDir));
  let stale = Object.keys(loadSpecTimings(timingsPath)).filter(
    (file) => !specFiles.has(file),
  );
  assert.deepEqual(stale, []);
});

test('the default run leaves out the specs written for other Synapse templates', () => {
  let specFiles = discoverSpecFiles(testDir);
  assert.ok(specFiles.length > 0);
  assert.deepEqual(
    specFiles.filter((file) =>
      file.startsWith(`${SYNAPSE_TEMPLATE_SPECS_DIR}/`),
    ),
    [],
  );
});

test('each template with specs of its own is a Synapse template, and runs only its own specs', () => {
  let templates = specSynapseTemplates(testDir);
  assert.ok(templates.length > 0);
  for (let template of templates) {
    assert.ok(
      existsSync(
        join(import.meta.dirname, 'synapse', template, 'homeserver.yaml'),
      ),
      `${SYNAPSE_TEMPLATE_SPECS_DIR}/${template} names no template in support/synapse`,
    );
    let specFiles = discoverSpecFiles(testDir, template);
    assert.ok(
      specFiles.length > 0,
      `${SYNAPSE_TEMPLATE_SPECS_DIR}/${template} has no spec files`,
    );
    for (let file of specFiles) {
      assert.ok(
        file.startsWith(`${SYNAPSE_TEMPLATE_SPECS_DIR}/${template}/`),
        `${file} is not one of ${template}'s specs`,
      );
    }
  }
});

test('CI runs every template that has specs of its own', () => {
  let workflow = parseYaml(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '.github',
        'workflows',
        'ci.yaml',
      ),
      'utf8',
    ),
  );
  let include: { synapseTemplate?: string }[] =
    workflow.jobs['matrix-client-test'].strategy.matrix.include ?? [];
  assert.deepEqual(
    include
      .map((entry) => entry.synapseTemplate)
      .filter((template): template is string => Boolean(template))
      .sort(),
    specSynapseTemplates(testDir),
    'each directory under tests/with-synapse/ needs a matrix-client-test include entry in ci.yaml, and each entry a directory',
  );
});

// A template other than `test` exists to change one thing about the Synapse
// the specs run against. Everything else is held to `test`'s configuration,
// so a setting added there reaches it too.
const TEMPLATE_DIFFERENCES: Record<string, Record<string, unknown>> = {
  'test-without-registration-token': { registration_requires_token: false },
};

test('a template with specs of its own differs from test only as it declares', () => {
  let synapseDir = join(import.meta.dirname, 'synapse');
  let read = (template: string, file: string) =>
    readFileSync(join(synapseDir, template, file), 'utf8');
  let base = parseYaml(read('test', 'homeserver.yaml'));
  for (let template of specSynapseTemplates(testDir)) {
    let differences = TEMPLATE_DIFFERENCES[template];
    assert.ok(
      differences,
      `${template} declares no differences from test in TEMPLATE_DIFFERENCES`,
    );
    assert.deepEqual(
      parseYaml(read(template, 'homeserver.yaml')),
      { ...base, ...differences },
      `${template}/homeserver.yaml differs from test's by more than TEMPLATE_DIFFERENCES`,
    );
    assert.equal(
      read(template, 'log.config'),
      read('test', 'log.config'),
      `${template}/log.config differs from test's`,
    );
  }
});

test('a run is for the default Synapse template unless it names another', () => {
  assert.equal(synapseTemplateOf(undefined), 'test');
  assert.equal(synapseTemplateOf(''), 'test');
  assert.equal(
    synapseTemplateOf('test-without-registration-token'),
    'test-without-registration-token',
  );
  assert.throws(() => synapseTemplateOf('../dev'));
});

test('shard coordinates are parsed, and nonsense is rejected', () => {
  assert.equal(parseShardCoordinates(undefined), undefined);
  assert.equal(parseShardCoordinates(''), undefined);
  assert.deepEqual(parseShardCoordinates('2/3'), { index: 2, total: 3 });
  assert.throws(() => parseShardCoordinates('4/3'));
  assert.throws(() => parseShardCoordinates('0/3'));
  assert.throws(() => parseShardCoordinates('two of three'));
});
