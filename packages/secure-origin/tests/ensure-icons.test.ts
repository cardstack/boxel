import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { iconsStale } from '../build/ensure-icons.ts';

function write(root: string, path: string, when: number) {
  let file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
  utimesSync(file, when, when);
}

test('boxel-icons is built when it has no build, or its sources are newer', () => {
  let root = mkdtempSync(join(tmpdir(), 'boxel-icons-'));
  try {
    write(root, 'src/icons/key-round.gts', 1000);
    write(root, 'package.json', 1000);
    assert.equal(iconsStale(root), 'boxel-icons has no build');
    write(root, 'dist/@cardstack/boxel-icons/v1/boxel-icons-meta.js', 2000);
    assert.equal(iconsStale(root), undefined);
    write(root, 'src/icons/key-round.gts', 3000);
    assert.match(iconsStale(root) ?? '', /sources are newer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
