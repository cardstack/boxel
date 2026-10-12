// PretuiNote's isolated page links back to the component it annotates.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PretuiNote } from './pretui-note';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Isolated = PretuiNote.isolated as any;

const NoteField = <template>Needs a loading state</template>;

module('Pretui | PretuiNote', function (hooks) {
  setupCardTest(hooks);

  test("the note opens its target by the target's prefix-form id", async function (assert) {
    let viewed: unknown[] = [];
    let viewCard = (card: unknown) => viewed.push(card);
    let targetId = '@cardstack/catalog/Spec/pretui-button';
    let model = {
      note: 'Needs a loading state',
      status: 'open',
      target: { id: targetId, componentName: 'Button' },
    };
    let fields = { note: NoteField };
    await render(
      <template>
        <Isolated @model={{model}} @fields={{fields}} @viewCard={{viewCard}} />
      </template>,
    );
    await click('[data-test-pretui-note-target]');
    assert.deepEqual(viewed, [targetId]);
  });
});
