import { click } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { choreoGalleryContents } from '../helpers/choreo-gallery';
import { setupChoreoGalleryTest } from '../helpers/choreo-gallery-stage';
import { renderCard } from '../helpers/render-component';

import type * as DemoModule from '../../../choreo-gallery/realm/demo';
import type * as GalleryModule from '../../../choreo-gallery/realm/gallery';

interface Instance {
  data: {
    attributes: Record<string, unknown> & {
      group?: string;
      lesson?: Record<string, unknown>;
      walkthrough?: Record<string, unknown>[];
    };
    meta: { adoptsFrom: { module: string; name: string } };
    relationships?: Record<string, { links: { self: string } }>;
  };
}

const CONTENTS = choreoGalleryContents();
const instance = (path: string) =>
  JSON.parse(CONTENTS[path] as string) as Instance;

/** the demos the gallery's index links, in the order it links them */
const LINKED = Object.entries(instance('index.json').data.relationships ?? {})
  .map(([key, { links }]) => ({
    at: Number(/^demos\.(\d+)$/.exec(key)?.[1] ?? NaN),
    slug: links.self.replace(/^\.\/demos\//, ''),
  }))
  .filter(({ at }) => !Number.isNaN(at))
  .sort((a, b) => a.at - b.at)
  .map(({ slug }) => slug);

/** the catalog: every linked demo, with the group it files under */
const catalog = LINKED.map((slug) => ({
  slug,
  group: instance(`demos/${slug}.json`).data.attributes.group,
}));

function chip(label: string) {
  const found = [...document.querySelectorAll('.chip')].find(
    (c) => c.textContent?.trim() === label,
  );
  if (!found) {
    throw new Error(`no chip named ${label}`);
  }
  return found;
}

/**
 * `animationsSettled()` cannot be used here: this gallery contains demos that
 * loop forever, so the page is never idle by design. Wait out the card spring
 * instead — what is being asserted is the resting state, not the path to it.
 */
function afterTheSwitch() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

/** cards a reader can actually see */
function visible() {
  return [...document.querySelectorAll<HTMLElement>('.card')].filter(
    (card) => Number(getComputedStyle(card).opacity) > 0.5,
  );
}

module('Integration | Choreo gallery | gallery filter', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  /** the gallery card, built from the realm's own index and demo instances */
  async function renderGallery() {
    let { DemoLesson, WalkthroughStep } =
      await gallery.import<typeof DemoModule>('demo');
    let demos = await Promise.all(
      LINKED.map(async (slug) => {
        let { data } = instance(`demos/${slug}.json`);
        let { module, name } = data.meta.adoptsFrom;
        let classes = await gallery.import<
          Record<string, new (attrs: object) => DemoModule.GalleryDemo>
        >(module.replace(/^\.\.\//, ''));
        let { lesson, walkthrough, ...attributes } = data.attributes;
        return new classes[name]!({
          ...attributes,
          lesson: lesson ? new DemoLesson(lesson) : undefined,
          walkthrough: (walkthrough ?? []).map(
            (step) => new WalkthroughStep(step),
          ),
        });
      }),
    );
    let { ChoreoGallery } =
      await gallery.import<typeof GalleryModule>('gallery');
    await renderCard(gallery.loader, new ChoreoGallery({ demos }), 'isolated');
  }

  test('filtering out and back leaves every card on screen', async function (assert) {
    await renderGallery();
    await afterTheSwitch();
    assert.strictEqual(visible().length, catalog.length, 'all of them at rest');

    await click(chip('Drag'));
    await afterTheSwitch();
    const drag = catalog.filter((demo) => demo.group === 'Drag').length;
    assert.strictEqual(visible().length, drag, 'only the drag demos');

    await click(chip('All'));
    await afterTheSwitch();
    assert.strictEqual(
      visible().length,
      catalog.length,
      `and back to all of them (dom=${document.querySelectorAll('.card').length})`,
    );
  });
});
