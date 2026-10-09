import { module, test } from 'qunit';

import { choreoGalleryContents } from '../helpers/choreo-gallery';
import { setupChoreoGalleryTest } from '../helpers/choreo-gallery-stage';
import { renderCard } from '../helpers/render-component';

import type * as DemoModule from '../../../choreo-gallery/realm/demo';
import type * as GalleryModule from '../../../choreo-gallery/realm/gallery';

interface Instance {
  data: {
    attributes: Record<string, unknown> & {
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

function rest() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

/**
 * A <Presence initial={false}> blocks the entrance of its children — and the
 * presence context is inherited, so it blocks every motion node BELOW them
 * too. In a gallery whose cards are whole demos that means the demos mount
 * already finished: rows that should wait for the scroll arrive in place, and
 * a looping keyframe animation is seeded at its last frame instead of running.
 */
module(
  'Integration | Choreo gallery | gallery demos stay alive',
  function (hooks) {
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
      await renderCard(
        gallery.loader,
        new ChoreoGallery({ demos }),
        'isolated',
      );
    }

    test('a whileInView row still waits to be scrolled into view', async function (assert) {
      await renderGallery();
      await rest();

      const rows = [...document.querySelectorAll<HTMLElement>('.pour')];
      assert.ok(rows.length > 6, `the pour log rendered: ${rows.length} rows`);

      // the column scrolls inside the card, so the rows below the fold have not
      // crossed the band yet and must still be at rest
      const waiting = rows.filter(
        (row) => Number(getComputedStyle(row).opacity) < 0.5,
      );
      assert.ok(
        waiting.length > 0,
        `rows below the fold are still waiting: ${rows
          .map((r) => getComputedStyle(r).opacity)
          .join(',')}`,
      );
    });

    test('a looping keyframe animation is running', async function (assert) {
      await renderGallery();
      await rest();

      const morph = document.querySelector('.morph');
      assert.ok(morph, 'the keyframes demo rendered');
      const running = morph!
        .getAnimations()
        .concat([...(morph!.parentElement?.getAnimations() ?? [])]);
      const animating =
        running.length > 0 || Number(getComputedStyle(morph!).opacity) < 1;
      assert.ok(animating, `something is animating on it: ${running.length}`);
    });
  },
);
