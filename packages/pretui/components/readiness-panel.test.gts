// Pretui — ReadinessPanel unit tests for an unrecognised gate state.
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ReadinessPanel } from './readiness-panel';
import type { ReadinessGate } from './readiness-panel';

// a state a backend might send that the panel does not know
const GATES = [
  { name: 'lint', state: 'pass' },
  { name: 'deploy', state: 'error' },
] as unknown as ReadinessGate[];

module('Pretui | components/readiness-panel', function (hooks) {
  setupCardTest(hooks);

  test('an unrecognised state is unknown on its row and in the verdict', async function (assert) {
    await render(<template><ReadinessPanel @title='Release' @gates={{GATES}} /></template>);
    let rows = [...document.querySelectorAll('[data-test-pretui-readiness-gate]')] as HTMLElement[];
    assert.strictEqual(rows[1]?.dataset['state'], 'unknown', 'the row says unknown');
    let verdict = document.querySelector('[data-test-pretui-readiness-verdict-text]')?.textContent ?? '';
    assert.notOk(/ready/i.test(verdict), `and the verdict does not say Ready (${verdict.trim()})`);
  });
});
