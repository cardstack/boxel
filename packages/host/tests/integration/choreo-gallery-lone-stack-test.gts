import { settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';

import { LayoutGroup, motion, Presence } from 'glimmer-motion';
import { module, test } from 'qunit';

import { setupChoreoGalleryTest } from '../helpers/choreo-gallery-stage';

import type { ComponentLike } from '@glint/template';

const keyOf = (item: { id: string }) => item.id;
const gone = { opacity: 0, scale: 0.96 };
const here = { opacity: 1, scale: 1 };
const leaves = { opacity: 0, scale: 0.96 };
const settle = { bounce: 0.12, type: 'spring', visualDuration: 0.42 } as const;

class Shown {
  @tracked ids = ['one', 'two'];

  get items() {
    return this.ids.map((id) => ({ id }));
  }

  drop = () => {
    this.ids = ['two'];
  };
}

function isFirst(id: string) {
  return id === 'one';
}

function rest() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

/**
 * A leaver whose subtree holds `layoutId`s of its own.
 *
 * `<Lightbox>` carries `layoutId="atlas-card"`, `"atlas-name"` and so on inside
 * its own `<LayoutGroup>`. When the card containing it leaves, each of those is
 * the only member of its stack — nothing else on the page shares the id, so
 * there is no counterpart and no crossfade to hand over to.
 */
module('Integration | Choreo gallery | a lone stack', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);
  let Lightbox: ComponentLike;

  hooks.beforeEach(async function () {
    Lightbox = await gallery.stage('lightbox', 'Lightbox');
  });

  test('a leaver holding lone layoutIds leaves the DOM', async function (assert) {
    const state = new Shown();

    const Harness = <template>
      <LayoutGroup>
        <div class='grid' style='position:relative'>
          <Presence
            @items={{state.items}}
            @key={{keyOf}}
            @mode='popLayout'
            @initial={{false}}
            as |item h|
          >
            <article
              class='card'
              data-card={{item.id}}
              {{motion
                presence=h
                layout=true
                initial=gone
                animate=here
                exit=leaves
                transition=settle
              }}
            >
              {{! only ONE card carries the demo, so its layoutIds are
                  unique on the page and each stack has a single member —
                  two copies would share the ids and stack in pairs, which
                  is a different bug }}
              <div class='card-stage'>
                {{#if (isFirst item.id)}}<Lightbox />{{else}}plain{{/if}}
              </div>
            </article>
          </Presence>
        </div>
      </LayoutGroup>
    </template>;
    await gallery.renderStage(Harness);
    await rest();
    assert.strictEqual(
      document.querySelectorAll('[data-card]').length,
      2,
      'both cards are up',
    );

    state.drop();
    await settled();
    await rest();

    assert.strictEqual(
      document.querySelectorAll('[data-card]').length,
      1,
      'the leaver left the DOM rather than lingering at opacity 0',
    );
  });
});
