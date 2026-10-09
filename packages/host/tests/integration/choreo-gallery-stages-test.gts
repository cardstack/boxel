import { settled } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { choreoGalleryContents } from '../helpers/choreo-gallery';
import {
  frames,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';

import type { ComponentLike } from '@glint/template';

interface DemoInstance {
  data: {
    attributes: { slug: string; theater?: boolean };
    meta: { adoptsFrom: { module: string; name: string } };
  };
}

/**
 * Every demo in the gallery whose card class supplies a live stage, other than
 * the films (their stage is a frame around a document of its own, covered by
 * the films test).
 */
const STAGED = Object.entries(choreoGalleryContents())
  .filter(([path]) => /^demos\/[^/]+\.json$/.test(path))
  .map(([, source]) => JSON.parse(source as string) as DemoInstance)
  .filter(
    ({ data }) =>
      data.meta.adoptsFrom.module.startsWith('../stages/') &&
      !data.attributes.theater,
  )
  .map(({ data }) => ({
    slug: data.attributes.slug,
    module: data.meta.adoptsFrom.module.replace(/^\.\.\//, ''),
    name: data.meta.adoptsFrom.name,
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug));

module('Integration | Choreo gallery | stages', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  for (let demo of STAGED) {
    test(`the ${demo.slug} stage renders on its own`, async function (assert) {
      let module = await gallery.import<
        Record<string, { stage?: ComponentLike }>
      >(demo.module);
      let Stage = module[demo.name]?.stage;
      assert.ok(Stage, `${demo.module} supplies ${demo.name}.stage`);
      await gallery.renderStage(Stage!);
      await frames(4);
      await settled();
      let well = document.querySelector('.choreo-stage-well') as HTMLElement;
      assert.ok(well.querySelector('*'), 'the stage put something on the page');
      // a stage's outermost element may be a wrapper with no box of its own
      // (a LayoutGroup), so the stage's size is its largest box
      let area = Math.max(
        ...[...well.querySelectorAll('*')].map((el) => {
          let r = el.getBoundingClientRect();
          return r.width * r.height;
        }),
      );
      assert.true(area > 0, `and it has a size (${Math.round(area)}px²)`);
    });
  }
});
