// Pretui — runtime proof for the data foundation (data-component.gts).
// The four things a base class of this kind gets wrong in the wild, each
// asserted against the real renderer: (1) "No results" flashing over an
// in-flight request, (2) a stale response overwriting a newer one, (3) the
// polite live region announcing nothing (or announcing while loading), and
// (4) selection/sort that only works uncontrolled or only works controlled.
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { render, click, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { DataComponent } from './data-component';

interface Lot {
  id: string;
  tea: string;
  kg: number;
}

const LOTS: Lot[] = [
  { id: 'B-1', tea: 'Gyokuro', kg: 61 },
  { id: 'B-2', tea: 'Da Hong Pao', kg: 24 },
  { id: 'B-3', tea: 'Silver Needle', kg: 88 },
];

class Deferred {
  resolve!: (rows: Lot[]) => void;
  reject!: (error: Error) => void;
  promise: Promise<Lot[]>;
  constructor() {
    this.promise = new Promise<Lot[]>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class LoadState {
  @tracked key = 'a';
  pending: Deferred[] = [];
  load = (): Promise<Lot[]> => {
    let d = new Deferred();
    this.pending.push(d);
    return d.promise;
  };
}

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-data]') as HTMLElement;
}
function live(): string {
  let el = document.querySelector('[data-test-pretui-data-live]');
  return (el?.textContent ?? '').trim();
}
function rowEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.t-row')) as HTMLElement[];
}
function rowText(): string {
  return Array.from(document.querySelectorAll('.t-row'))
    .map((el) => (el.textContent ?? '').trim())
    .join('|');
}

module('Pretui | DataComponent', function (hooks) {
  setupCardTest(hooks);

  test('loading never reads as empty, and the count is announced on settle', async function (assert) {
    let state = new LoadState();
    await render(<template>
      <DataComponent
        @load={{state.load}}
        @loadKey={{state.key}}
        @itemNoun='lot'
        as |rows|
      >
        {{#each rows key='id' as |row|}}
          <span class='t-row'>{{row.tea}}</span>
        {{/each}}
      </DataComponent>
    </template>);

    assert.strictEqual(root().dataset.status, 'loading', 'starts loading');
    assert.strictEqual(root().getAttribute('aria-busy'), 'true', 'aria-busy');
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-empty]').length,
      0,
      'the empty state is NOT rendered while the request is in flight',
    );
    assert.strictEqual(live(), '', 'nothing is announced while loading');

    state.pending[0].resolve(LOTS);
    await settled();

    assert.strictEqual(root().dataset.status, 'ready', 'settles to ready');
    assert.strictEqual(root().getAttribute('aria-busy'), 'false', 'not busy');
    assert.strictEqual(live(), '3 lots', 'the count is announced, pluralised');
    assert.strictEqual(rowText(), 'Gyokuro|Da Hong Pao|Silver Needle');
  });

  test('an empty settle is `empty`, not `ready`', async function (assert) {
    let state = new LoadState();
    await render(<template>
      <DataComponent @load={{state.load}} @itemNoun='lot' as |rows|>
        {{#each rows key='id' as |row|}}
          <span class='t-row'>{{row.tea}}</span>
        {{/each}}
      </DataComponent>
    </template>);

    state.pending[0].resolve([]);
    await settled();

    assert.strictEqual(root().dataset.status, 'empty');
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-empty]').length,
      1,
      'the default EmptyState renders',
    );
    assert.strictEqual(live(), 'No lots', 'emptiness is announced too');
  });

  test('a rejection becomes the error status, as text, with a retry', async function (assert) {
    let state = new LoadState();
    await render(<template>
      <DataComponent @load={{state.load}} @itemNoun='lot' as |rows|>
        {{#each rows key='id' as |row|}}
          <span class='t-row'>{{row.tea}}</span>
        {{/each}}
      </DataComponent>
    </template>);

    state.pending[0].reject(new Error('the desk refused'));
    await settled();

    assert.strictEqual(root().dataset.status, 'error');
    let alert = document.querySelector('[data-test-pretui-alert]');
    assert.ok(alert, 'the failure surfaces through Alert');
    assert.ok(
      (alert?.textContent ?? '').includes('the desk refused'),
      'the message is TEXT, not colour alone',
    );
    assert.ok(live().includes('the desk refused'), 'the failure is announced');

    // Retry re-runs the loader through the reload epoch.
    await click('[data-test-pretui-data-retry]');
    assert.strictEqual(state.pending.length, 2, 'retry started a new request');
    state.pending[1].resolve(LOTS);
    await settled();
    assert.strictEqual(root().dataset.status, 'ready', 'and it recovers');
  });

  test('a stale response cannot overwrite a newer one', async function (assert) {
    let state = new LoadState();
    await render(<template>
      <DataComponent @load={{state.load}} @loadKey={{state.key}} as |rows|>
        {{#each rows key='id' as |row|}}
          <span class='t-row'>{{row.tea}}</span>
        {{/each}}
      </DataComponent>
    </template>);

    state.key = 'b';
    await settled();
    assert.strictEqual(
      state.pending.length,
      2,
      'changing @loadKey re-ran the loader',
    );

    // The OLDER request answers first-but-late. It must be discarded whole.
    state.pending[0].resolve([{ id: 'B-9', tea: 'STALE', kg: 1 }]);
    await settled();
    assert.strictEqual(rowText(), '', 'the stale rows were never written');
    assert.strictEqual(
      root().dataset.status,
      'loading',
      'and the component is still waiting for the request it actually wants',
    );

    state.pending[1].resolve(LOTS);
    await settled();
    assert.strictEqual(rowText(), 'Gyokuro|Da Hong Pao|Silver Needle');

    // Late failure of a retired request must not poison a good state either.
    state.pending[0].reject(new Error('too late'));
    await settled();
    assert.strictEqual(root().dataset.status, 'ready', 'still ready');
  });

  test('missing values sort last in both directions', async function (assert) {
    const GAPPY = [
      { id: 'B-1', tea: 'Gyokuro', kg: 61 },
      { id: 'B-2', tea: 'Unweighed', kg: null },
      { id: 'B-3', tea: 'Silver Needle', kg: 88 },
    ];
    await render(<template>
      <DataComponent @rows={{GAPPY}} as |rows data|>
        <button type='button' class='t-sort' {{on 'click' (fn data.toggleSort 'kg')}}>sort</button>
        {{#each rows key='id' as |row|}}<span class='t-row'>{{row.tea}}</span>{{/each}}
      </DataComponent>
    </template>);
    let order = () => Array.from(document.querySelectorAll('.t-row')).map((el) => el.textContent?.trim()).join('|');
    await click('.t-sort');
    assert.strictEqual(order(), 'Gyokuro|Silver Needle|Unweighed', 'ascending');
    await click('.t-sort');
    assert.strictEqual(order(), 'Silver Needle|Gyokuro|Unweighed', 'descending keeps the gap last');
  });

  test('all-selected means every visible row, and select-all keeps keys outside the view', async function (assert) {
    class Lots {
      @tracked rows: Lot[] = LOTS;
      keys: string[] = [];
      note = (keys: unknown[]) => (this.keys = keys as string[]);
    }
    let lots = new Lots();
    await render(<template>
      <DataComponent @rows={{lots.rows}} @selectionMode='multi' @onSelectionChange={{lots.note}} as |_rows data|>
        <button type='button' class='t-all' {{on 'click' data.selectAll}}>all</button>
        <span class='t-state'>{{if data.allSelected 'all' 'some'}}</span>
      </DataComponent>
    </template>);
    let state = () => document.querySelector('.t-state')?.textContent?.trim();
    await click('.t-all');
    assert.strictEqual(state(), 'all');
    lots.rows = [{ id: 'B-9', tea: 'Hojicha', kg: 12 }];
    await settled();
    assert.strictEqual(state(), 'some', 'three selected keys, none of them in view, is not all');
    await click('.t-all');
    assert.deepEqual(lots.keys, ['B-1', 'B-2', 'B-3', 'B-9'], 'selecting the view keeps the earlier keys');
    await click('.t-all');
    assert.deepEqual(lots.keys, ['B-1', 'B-2', 'B-3'], 'and deselecting it removes only the view');
  });

  test('eager rows take over from a load still in flight', async function (assert) {
    class Swap {
      @tracked rows: Lot[] | undefined = undefined;
    }
    let swap = new Swap();
    let loads = new LoadState();
    await render(<template>
      <DataComponent @load={{loads.load}} @rows={{swap.rows}} as |rows|>
        {{#each rows key='id' as |row|}}<span class='t-row'>{{row.tea}}</span>{{/each}}
      </DataComponent>
    </template>);
    assert.strictEqual(root().dataset.status, 'loading');
    swap.rows = LOTS;
    await settled();
    assert.strictEqual(root().dataset.status, 'ready', 'the eager rows are the truth now');
    loads.pending[0]?.reject(new Error('late failure'));
    await settled();
    assert.strictEqual(root().dataset.status, 'ready', 'and a late failure of the old load does not override them');
  });

  test('selection and sort work uncontrolled, and report every change', async function (assert) {
    let seen: unknown[] = [];
    let record = (keys: unknown[]) => seen.push(keys.join(','));
    await render(<template>
      <DataComponent
        @rows={{LOTS}}
        @selectionMode='multi'
        @onSelectionChange={{record}}
        as |rows data|
      >
        <button
          type='button'
          class='t-sort'
          {{on 'click' (fn data.toggleSort 'kg')}}
        >sort</button>
        <span class='t-count'>{{data.selectedKeys.length}}</span>
        <span class='t-aria'>{{data.ariaSort 'kg'}}</span>
        {{#each rows key='id' as |row index|}}
          <button
            type='button'
            class='t-row'
            {{on 'click' (fn data.toggleSelected row index)}}
          >{{row.tea}}</button>
        {{/each}}
      </DataComponent>
    </template>);

    assert.strictEqual(root().dataset.status, 'ready', 'eager rows are ready');
    assert.strictEqual(rowText(), 'Gyokuro|Da Hong Pao|Silver Needle');

    // asc → desc → unsorted, with aria-sort following.
    await click('.t-sort');
    assert.strictEqual(rowText(), 'Da Hong Pao|Gyokuro|Silver Needle', 'asc');
    assert.strictEqual(
      document.querySelector('.t-aria')?.textContent?.trim(),
      'ascending',
    );
    await click('.t-sort');
    assert.strictEqual(rowText(), 'Silver Needle|Gyokuro|Da Hong Pao', 'desc');
    await click('.t-sort');
    assert.strictEqual(rowText(), 'Gyokuro|Da Hong Pao|Silver Needle', 'off');

    // Multi-select, keyed by the row's own id via the documented fallback.
    await click(rowEls()[0]);
    await click(rowEls()[1]);
    assert.strictEqual(
      document.querySelector('.t-count')?.textContent?.trim(),
      '2',
      'two rows selected',
    );
    assert.deepEqual(seen, ['B-1', 'B-1,B-2'], 'every change was reported');
  });
});
