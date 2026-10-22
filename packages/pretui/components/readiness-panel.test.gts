// Pretui — ReadinessPanel unit tests: an unrecognised gate state, linked
// gates, and the list variant.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
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

const CHECKS: ReadinessGate[] = [
  {
    name: 'Lint',
    state: 'fail',
    caption: '3 errors',
    href: 'https://ci.example/run/1',
  },
  {
    name: 'Host tests (shard 2)',
    state: 'fail',
    href: 'https://ci.example/run/2',
  },
  { name: 'Type check', state: 'pass' },
];
const NONE: ReadinessGate[] = [];

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}

module('Pretui | components/readiness-panel', function (hooks) {
  setupCardTest(hooks);

  test('an unrecognised state is unknown on its row and in the verdict', async function (assert) {
    await render(
      <template><ReadinessPanel @title='Release' @gates={{GATES}} /></template>,
    );
    let rows = [
      ...document.querySelectorAll('[data-test-pretui-readiness-gate]'),
    ] as HTMLElement[];
    assert.strictEqual(
      rows[1]?.dataset['state'],
      'unknown',
      'the row says unknown',
    );
    let verdict =
      document.querySelector('[data-test-pretui-readiness-verdict-text]')
        ?.textContent ?? '';
    assert.notOk(
      /ready/i.test(verdict),
      `and the verdict does not say Ready (${verdict.trim()})`,
    );
  });

  test('a gate with href links its name, and only its name', async function (assert) {
    await render(
      <template><ReadinessPanel @title='CI' @gates={{CHECKS}} /></template>,
    );
    let links = all('[data-test-pretui-readiness-gate-link]');
    assert.strictEqual(links.length, 2, 'one link per gate with an href');
    assert.strictEqual(links[0]!.tagName, 'A');
    assert.strictEqual(
      links[0]!.getAttribute('href'),
      'https://ci.example/run/1',
    );
    assert.strictEqual(
      links[0]!.textContent?.trim(),
      'Lint',
      'the link text is the gate name',
    );
    let rows = all('[data-test-pretui-readiness-gate]');
    assert.strictEqual(
      rows[2]!.querySelector('a'),
      null,
      'a gate without href renders no anchor',
    );
    assert.true(
      rows[0]!.textContent?.includes('Failed'),
      'the state word is on the row',
    );
    assert.false(
      links[0]!.textContent?.includes('Failed'),
      'and outside the link',
    );
  });

  test('the list variant renders only the named gate list', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Failing checks'
          @variant='list'
          @gates={{CHECKS}}
          class='from-caller'
        >
          <:actions><button type='button'>Merge</button></:actions>
        </ReadinessPanel>
      </template>,
    );
    let root = q('[data-test-pretui-readiness-list]');
    assert.strictEqual(root.tagName, 'UL', 'the root is the list itself');
    assert.strictEqual(root.getAttribute('role'), 'list');
    assert.strictEqual(
      root.getAttribute('aria-label'),
      'Failing checks',
      '@title names the list',
    );
    assert.true(
      root.classList.contains('from-caller'),
      '...attributes reach the list',
    );
    assert.strictEqual(
      root.querySelectorAll('li').length,
      3,
      'one item per gate',
    );
    assert
      .dom('[data-test-pretui-readiness-panel]')
      .doesNotExist('no Panel surface');
    assert
      .dom('[data-test-pretui-readiness-verdict]')
      .doesNotExist('no verdict');
    assert
      .dom('[data-test-pretui-readiness-live]')
      .doesNotExist('no live region');
    let host = root.parentElement as HTMLElement;
    assert.strictEqual(
      host.querySelector('h1, h2, h3, h4, h5, h6'),
      null,
      'no heading',
    );
    assert.strictEqual(host.querySelector('button'), null, 'no actions');
  });

  test('the list variant takes @gatesLabel, @loading and the empty state', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Checks'
          @gatesLabel='CI for this PR'
          @variant='list'
          @gates={{CHECKS}}
        />
      </template>,
    );
    assert.strictEqual(
      q('[data-test-pretui-readiness-list]').getAttribute('aria-label'),
      'CI for this PR',
    );

    await render(
      <template>
        <ReadinessPanel
          @title='Checks'
          @variant='list'
          @loading={{true}}
          @loadingRows={{2}}
        />
      </template>,
    );
    let loading = q('[data-test-pretui-readiness-loading]');
    assert.strictEqual(loading.getAttribute('aria-busy'), 'true');
    assert.strictEqual(
      loading.querySelectorAll('li').length,
      2,
      'skeleton rows reserve the space',
    );

    await render(
      <template>
        <ReadinessPanel @title='Checks' @variant='list' @gates={{NONE}} />
      </template>,
    );
    assert
      .dom('[data-test-pretui-readiness-empty]')
      .exists('no gates renders the empty state');
    assert.dom('[data-test-pretui-readiness-list]').doesNotExist();
  });
});
