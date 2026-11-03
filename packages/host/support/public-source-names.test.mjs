import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { publicSourceNamesPlugin } from '../lib/build/public-source-names.mjs';

async function bundle(root, setting) {
  let entry = path.join(root, 'entry.mjs');
  let result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [publicSourceNamesPlugin({ sourceRoot: root, setting })],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'] },
      rolldownOptions: { output: { entryFileNames: 'fixture-[hash].js' } },
    },
  });
  let outputs = Array.isArray(result)
    ? result.flatMap((item) => item.output)
    : result.output;
  let chunk = outputs.find((output) => output.type === 'chunk');
  assert.ok(chunk);
  return chunk;
}

test('native source names remove filesystem roots before content hashing', async () => {
  let root = await realpath(
    await mkdtemp(path.join(tmpdir(), 'boxel-source-fixture-')),
  );
  try {
    await writeFile(
      path.join(root, 'entry.mjs'),
      `export const moduleName = "${root}/packages/host/example.gts"; export const source = "file://${root}/packages/host/example.gts";`,
    );
    let native = await bundle(root, 'true');
    let hosted = await bundle(root, undefined);
    assert.equal(native.code.includes(root), false);
    assert.equal(native.code.includes('file://'), false);
    assert.ok(native.code.includes('@boxel-source/packages/host/example.gts'));
    assert.ok(native.code.includes('boxel-source:/packages/host/example.gts'));
    assert.ok(hosted.code.includes(root));
    assert.notEqual(native.fileName, hosted.fileName);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid or ignored source-name settings fail at the build boundary', () => {
  assert.equal(
    publicSourceNamesPlugin({ sourceRoot: '/tmp/project', setting: 'false' }),
    null,
  );
  assert.throws(() =>
    publicSourceNamesPlugin({ sourceRoot: '/tmp/project', setting: 'invalid' }),
  );
  assert.throws(() =>
    publicSourceNamesPlugin({ sourceRoot: '/', setting: 'true' }),
  );
  assert.throws(() =>
    publicSourceNamesPlugin({ sourceRoot: 'relative', setting: 'true' }),
  );
});
