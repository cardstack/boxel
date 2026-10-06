// Pretui — proof for GraphOutline, the accessible peer surface of the node
// canvas. Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
//
// GraphOutline is deliberately engine-free so it can be rendered here at
// all: local `boxel test` cannot load the surfaces bundle. Every assertion
// below is structure, ARIA, text or an emitted callback — never a computed
// style, because `boxel test` stamps the scoped-CSS attribute and delivers
// no stylesheet.
import { module, test } from 'qunit';
import { click, render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { GraphOutline } from './components/graph-outline';
import type { OutlineEdge, OutlineNode } from './components/graph-outline';

const NODES: OutlineNode[] = [
  { id: 'sup', data: { title: 'Wuyi Origins', status: 'contracted' } },
  { id: 'lot', data: { title: 'Spring Lot 14' } },
  { id: 'ship', data: { title: 'Rotterdam Leg' } },
];

const EDGES: OutlineEdge[] = [
  { id: 'e1', source: 'sup', target: 'lot', label: 'supplies' },
  { id: 'e2', source: 'lot', target: 'ship' },
];

function rowFor(id: string): HTMLElement {
  let row = document.querySelector<HTMLElement>(
    `[data-test-pretui-graph-outline-row='${id}']`,
  );
  if (!row) {
    throw new Error(`no outline row for ${id}`);
  }
  return row;
}

function pickButton(id: string): HTMLElement {
  let button = document.querySelector<HTMLElement>(
    `[data-test-pretui-graph-outline-pick='${id}']`,
  );
  if (!button) {
    throw new Error(`no pick button for ${id}`);
  }
  return button;
}

module('Pretui | surfaces | GraphOutline', function (hooks) {
  setupCardTest(hooks);

  test('states the shape of the graph in a sentence', async function (assert) {
    await render(<template>
      <GraphOutline @nodes={{NODES}} @edges={{EDGES}} @label='Tea trade' />
    </template>);
    assert
      .dom('[data-test-pretui-graph-outline-headline]')
      .hasText('3 nodes, 2 connections.');
  });

  test('singular and plural are both correct', async function (assert) {
    const ONE: OutlineNode[] = [{ id: 'a' }];
    const ONE_EDGE: OutlineEdge[] = [{ source: 'a', target: 'a' }];
    await render(<template>
      <GraphOutline @nodes={{ONE}} @edges={{ONE_EDGE}} @label='Solo' />
    </template>);
    assert
      .dom('[data-test-pretui-graph-outline-headline]')
      .hasText('1 node, 1 connection.');
  });

  test('every node gets a row, and the empty graph gets none', async function (assert) {
    await render(<template>
      <GraphOutline @nodes={{NODES}} @edges={{EDGES}} @label='Tea trade' />
    </template>);
    assert
      .dom('[data-test-pretui-graph-outline] li')
      .exists({ count: 3 }, 'one row per node');
    assert.dom(rowFor('sup')).exists('named rows are addressable by id');
  });

  test('a node with no title falls back through label, then id', async function (assert) {
    const MIXED: OutlineNode[] = [
      { id: 'bare' },
      { id: 'labelled', data: { label: 'From the label' } },
      { id: 'named', ariaLabel: 'From ariaLabel', data: { title: 'ignored' } },
    ];
    const NONE: OutlineEdge[] = [];
    await render(<template>
      <GraphOutline @nodes={{MIXED}} @edges={{NONE}} @label='Fallbacks' />
    </template>);
    assert.dom(pickButton('bare')).hasText('bare', 'the id is the last resort');
    assert.dom(pickButton('labelled')).hasText('From the label');
    assert
      .dom(pickButton('named'))
      .hasText('From ariaLabel', 'ariaLabel wins over data.title');
  });

  test('edges are readable as text, in BOTH directions, with labels', async function (assert) {
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @mode='visible'
      />
    </template>);
    let source = rowFor('sup').textContent ?? '';
    assert.ok(
      source.includes('connects to Spring Lot 14 (supplies)'),
      `the outgoing edge names its label: ${source}`,
    );
    let middle = rowFor('lot').textContent ?? '';
    assert.ok(
      middle.includes('fed by Wuyi Origins (supplies)'),
      `the incoming direction is stated too: ${middle}`,
    );
    let sink = rowFor('ship').textContent ?? '';
    assert.ok(
      sink.includes('no outgoing connections'),
      'a sink says so rather than saying nothing',
    );
    assert.ok(sink.includes('fed by Spring Lot 14'), 'and names what feeds it');
  });

  test('the row button carries the whole row as its accessible name', async function (assert) {
    // The link text is aria-hidden so a screen reader hears the node once,
    // as one coherent phrase, instead of hearing the name and then the
    // links as two unrelated announcements.
    await render(<template>
      <GraphOutline @nodes={{NODES}} @edges={{EDGES}} @label='Tea trade' />
    </template>);
    let label = pickButton('sup').getAttribute('aria-label') ?? '';
    assert.ok(label.startsWith('Wuyi Origins'), `starts with the name: ${label}`);
    assert.ok(label.includes('connects to Spring Lot 14'), 'and states the edge');
    assert
      .dom('[data-test-pretui-graph-outline] .pgo-links')
      .hasAttribute('aria-hidden', 'true', 'the visible copy is not re-read');
  });

  test('activating a row reports the node id', async function (assert) {
    let picked: string[] = [];
    let onSelect = (id: string) => picked.push(id);
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @onSelect={{onSelect}}
      />
    </template>);
    await click(pickButton('ship'));
    assert.deepEqual(picked, ['ship'], 'the callback fires with the id');
  });

  test('the active node is marked, for the picture and for the reader', async function (assert) {
    const ACTIVE = 'lot';
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @activeId={{ACTIVE}}
      />
    </template>);
    assert.dom(rowFor('lot')).hasAttribute('data-active', 'true');
    assert.dom(pickButton('lot')).hasAttribute('aria-current', 'true');
    assert.dom(pickButton('sup')).hasAttribute('aria-current', 'false');
  });

  test('no connect controls at all when the graph is read-only', async function (assert) {
    await render(<template>
      <GraphOutline @nodes={{NODES}} @edges={{EDGES}} @label='Tea trade' />
    </template>);
    assert
      .dom('[data-test-pretui-graph-outline-arm="sup"]')
      .doesNotExist('no arming control without @onConnect');
    assert
      .dom('[data-test-pretui-graph-outline-relayout]')
      .doesNotExist('no relayout control without @onRelayout');
  });

  test('a keyboard user can draw an edge — the gesture upstream has no answer for', async function (assert) {
    let made: string[] = [];
    let onConnect = (source: string, target: string) =>
      made.push(`${source}>${target}`);
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @onConnect={{onConnect}}
      />
    </template>);

    assert
      .dom('[data-test-pretui-graph-outline-arm="sup"]')
      .hasAttribute('aria-pressed', 'false', 'nothing armed to begin with');

    await click('[data-test-pretui-graph-outline-arm="sup"]');
    assert
      .dom('[data-test-pretui-graph-outline-arm="sup"]')
      .hasAttribute('aria-pressed', 'true', 'the source is armed');
    assert.dom(rowFor('sup')).hasAttribute('data-source', 'true');

    // Every other row now offers itself as the target, by NAME, so a reader
    // tabbing through hears what activating it would do.
    assert.strictEqual(
      pickButton('ship').getAttribute('aria-label'),
      'Connect Wuyi Origins to Rotterdam Leg',
      'the target buttons rename themselves',
    );

    await click(pickButton('ship'));
    assert.deepEqual(made, ['sup>ship'], 'the connection is emitted');
    assert
      .dom(rowFor('sup'))
      .hasAttribute('data-source', 'false', 'and the mode disarms itself');
  });

  test('the armed state is announced in a live region that was there all along', async function (assert) {
    // A status element inserted at the moment it has something to say is
    // frequently never announced — assistive tech has to have been watching
    // it. So it is always in the DOM and only its text changes.
    let onConnect = () => {};
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @onConnect={{onConnect}}
      />
    </template>);
    assert
      .dom('[data-test-pretui-graph-outline-status]')
      .exists('the live region is present before it has anything to say')
      .hasAttribute('role', 'status')
      .hasAttribute('aria-live', 'polite')
      .hasText('', 'and empty');

    await click('[data-test-pretui-graph-outline-arm="sup"]');
    assert
      .dom('[data-test-pretui-graph-outline-status]')
      .hasText(
        'Connecting from Wuyi Origins. Choose a target, or press Escape to cancel.',
        'the announcement names the source and the way out',
      );
  });

  test('Escape cancels an armed connection', async function (assert) {
    let made: string[] = [];
    let onConnect = (source: string, target: string) =>
      made.push(`${source}>${target}`);
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @onConnect={{onConnect}}
      />
    </template>);
    await click('[data-test-pretui-graph-outline-arm="sup"]');
    await triggerKeyEvent(pickButton('ship'), 'keydown', 'Escape');
    assert
      .dom('[data-test-pretui-graph-outline-status]')
      .hasText('', 'the announcement clears');
    assert.dom(rowFor('sup')).hasAttribute('data-source', 'false');
    assert.deepEqual(made, [], 'nothing was connected');
  });

  test('re-activating the armed source cancels instead of self-connecting', async function (assert) {
    let made: string[] = [];
    let onConnect = (source: string, target: string) =>
      made.push(`${source}>${target}`);
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @onConnect={{onConnect}}
      />
    </template>);
    await click('[data-test-pretui-graph-outline-arm="sup"]');
    await click(pickButton('sup'));
    assert.deepEqual(made, [], 'a node is never connected to itself by accident');
    assert.dom(rowFor('sup')).hasAttribute('data-source', 'false', 'disarmed');
  });

  test('arming a second source moves the arm rather than stacking it', async function (assert) {
    let onConnect = () => {};
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @onConnect={{onConnect}}
      />
    </template>);
    await click('[data-test-pretui-graph-outline-arm="sup"]');
    await click('[data-test-pretui-graph-outline-arm="lot"]');
    assert.dom(rowFor('sup')).hasAttribute('data-source', 'false');
    assert.dom(rowFor('lot')).hasAttribute('data-source', 'true');
  });

  test('relayout is a real control when the caller supplies one', async function (assert) {
    let runs = 0;
    let onRelayout = () => (runs += 1);
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @onRelayout={{onRelayout}}
      />
    </template>);
    await click('[data-test-pretui-graph-outline-relayout]');
    assert.strictEqual(runs, 1, 'the layout callback fired');
  });

  test('the region names itself after the graph it describes', async function (assert) {
    await render(<template>
      <GraphOutline @nodes={{NODES}} @edges={{EDGES}} @label='Tea trade' />
    </template>);
    // The default mode is sr-only, which must still be REACHABLE — it is
    // clipped by CSS, never `hidden` and never `aria-hidden`.
    assert
      .dom('[data-test-pretui-graph-outline]')
      .hasAttribute('data-mode', 'sr-only')
      .doesNotHaveAttribute('aria-hidden', 'never hidden from assistive tech')
      .doesNotHaveAttribute('hidden', 'and never removed from the a11y tree');
  });

  test('an outline id can be supplied so a canvas can point aria-describedby at it', async function (assert) {
    const ID = 'pretui-test-outline';
    await render(<template>
      <GraphOutline
        @nodes={{NODES}}
        @edges={{EDGES}}
        @label='Tea trade'
        @outlineId={{ID}}
      />
    </template>);
    assert.dom('#pretui-test-outline').exists('the id lands on the region');
  });

  test('an empty graph still renders a mirror rather than vanishing', async function (assert) {
    const NONE_N: OutlineNode[] = [];
    const NONE_E: OutlineEdge[] = [];
    await render(<template>
      <GraphOutline @nodes={{NONE_N}} @edges={{NONE_E}} @label='Nothing' />
    </template>);
    assert
      .dom('[data-test-pretui-graph-outline-headline]')
      .hasText('0 nodes, 0 connections.');
    assert.dom('[data-test-pretui-graph-outline] li').doesNotExist('no rows');
  });
});
