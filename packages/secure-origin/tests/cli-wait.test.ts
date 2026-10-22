import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLI_AUTH_TIMEOUT_MS,
  describeDuration,
} from '../../runtime-common/cli-auth.ts';

// The pages say how long the CLI waits for a sign-in in words of their own,
// since the secure origin builds nothing from outside its package. They must
// say what the CLI enforces.
test('the CLI wait the pages state is the one the CLI enforces', async () => {
  let source = await import('node:fs').then((fs) =>
    fs.readFileSync(
      new URL('../src/shell/sign-in/cli-wait-notice.gts', import.meta.url),
      'utf8',
    ),
  );
  let stated = /export const CLI_WAIT = '([^']+)';/.exec(source)?.[1];
  assert.equal(stated, describeDuration(CLI_AUTH_TIMEOUT_MS));
});
