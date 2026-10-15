/**
 * The guides, their links and the lab: a guide renders from the realm with
 * its live demo embedded, every tile and demo page links its demo's guide,
 * and the lab tunes a demo through `demoTuning`.
 */
import { click, render, waitFor, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { live, liveAll } from '@cardstack/choreo/test-support';
import { modifier } from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';
import { module, test } from 'qunit';

import { CardContextName } from '@cardstack/runtime-common';

import { choreoGalleryGuides } from '../helpers/choreo-gallery';
import {
  GALLERY_DEMOS,
  galleryInstance,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';
import { testRealmURL } from '../helpers/index';

import type * as DemoModule from '../../../choreo-gallery/realm/demo';
import type * as LabModule from '../../../choreo-gallery/realm/lib/lab';
import type * as PresetsModule from '../../../choreo-gallery/realm/lib/presets';
import type * as TuningModule from '../../../choreo-gallery/realm/lib/tuning';
import type { ComponentLike } from '@glint/template';

const GUIDES = choreoGalleryGuides();

const guideURL = (slug: string) => `${testRealmURL}docs/guides/${slug}.md`;

/** the guide a demo's lesson names */
const guideOf = (slug: string) =>
  galleryInstance(`demos/${slug}.json`).data.attributes.lesson?.[
    'guide'
  ] as string;

type MarkdownSignature = {
  Args: {
    cardReferenceBaseUrl: string;
    content: string;
    linkedCards: DemoModule.GalleryDemo[];
  };
};

/**
 * The card context the host's overlay gives a document: an embedded card opens
 * on a click anywhere inside it, and the innermost card a click reaches is the
 * one it opens. Each open is recorded.
 */
class OpensOnClick extends GlimmerComponent<{
  Args: { opened: string[] };
  Blocks: { default: [] };
}> {
  opensOnClick = modifier(
    (element: HTMLElement, _: unknown[], named: { cardId?: string }) => {
      let open = (event: Event) => {
        event.stopPropagation();
        this.args.opened.push(named.cardId ?? 'card');
      };
      element.addEventListener('click', open);
      return () => element.removeEventListener('click', open);
    },
  );

  @provide(CardContextName)
  get cardContext() {
    return { cardComponentModifier: this.opensOnClick };
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

module('Integration | Choreo gallery | guides and the lab', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  /** one demo the index links, as a card instance at its realm id */
  async function demoCard(slug: string) {
    let { DemoLesson, WalkthroughStep } =
      await gallery.import<typeof DemoModule>('demo');
    let { data } = galleryInstance(`demos/${slug}.json`);
    let { module: path, name } = data.meta.adoptsFrom;
    let classes = await gallery.import<
      Record<string, new (attrs: object) => DemoModule.GalleryDemo>
    >(path.replace(/^\.\.\//, ''));
    let { lesson, walkthrough, ...attributes } = data.attributes;
    return new classes[name]!({
      id: `${testRealmURL}demos/${slug}`,
      ...attributes,
      lesson: lesson ? new DemoLesson(lesson) : undefined,
      walkthrough: (walkthrough ?? []).map((step) => new WalkthroughStep(step)),
    });
  }

  test('a guide renders from the realm with its live demo embedded', async function (assert) {
    let content = GUIDES['core-start']!;
    assert.true(
      content.includes('::card[../../demos/enter]'),
      'the guide embeds the enter demo',
    );
    let enter = await demoCard('enter');
    let MarkdownTemplate = (
      (await gallery.loader.import(
        '@cardstack/base/default-templates/markdown',
      )) as { default: ComponentLike<MarkdownSignature> }
    ).default;
    let linkedCards = [enter];
    let base = guideURL('core-start');

    await render(
      <template>
        <MarkdownTemplate
          @content={{content}}
          @linkedCards={{linkedCards}}
          @cardReferenceBaseUrl={{base}}
        />
      </template>,
    );
    await waitFor('.markdown-bfm-card-slot--block .tile', { timeout: 10_000 });

    assert
      .dom('h2#user-content-installing-the-library')
      .exists('the guide’s own prose renders');
    let embed = live('.markdown-bfm-card-slot--block .tile')!;
    assert
      .dom(embed.querySelector('.tile-title'))
      .hasText('Enter', 'the embed is the enter demo');
    assert.ok(
      embed.querySelector('.tile-stage .banner'),
      'its live stage renders its notices',
    );
    assert
      .dom(embed.querySelector('.guide-link'))
      .hasAttribute(
        'href',
        guideURL(guideOf('enter')),
        'and links the guide its lesson names',
      );

    await click(embed.querySelector('.lab-toggle')!);
    await waitFor('.markdown-bfm-card-slot--block [data-demo-lab="enter"]');
    assert
      .dom('.markdown-bfm-card-slot--block [data-demo-lab="enter"]')
      .exists('the embedded demo opens its lab');
  });

  test('an embedded demo keeps its own clicks, and opens its card from what it is', async function (assert) {
    let enter = await demoCard('enter');
    let MarkdownTemplate = (
      (await gallery.loader.import(
        '@cardstack/base/default-templates/markdown',
      )) as { default: ComponentLike<MarkdownSignature> }
    ).default;
    let content = GUIDES['core-start']!;
    let linkedCards = [enter];
    let base = guideURL('core-start');
    let opened: string[] = [];

    await render(
      <template>
        <OpensOnClick @opened={{opened}}>
          <MarkdownTemplate
            @content={{content}}
            @linkedCards={{linkedCards}}
            @cardReferenceBaseUrl={{base}}
          />
        </OpensOnClick>
      </template>,
    );
    await waitFor('.markdown-bfm-card-slot--block .tile', { timeout: 10_000 });
    let embed = live('.markdown-bfm-card-slot--block .tile')!;

    let stageButton =
      embed.querySelector<HTMLButtonElement>('.tile-stage button');
    assert.ok(stageButton, 'the stage has a control of its own');
    await click(stageButton!);
    await click(embed.querySelector('.lab-toggle')!);
    await waitFor('.markdown-bfm-card-slot--block [data-demo-lab] .lab-replay');
    await click(
      live('.markdown-bfm-card-slot--block [data-demo-lab] .lab-replay')!,
    );
    let guide = embed.querySelector<HTMLAnchorElement>('.guide-link')!;
    guide.addEventListener('click', (event) => event.preventDefault());
    await click(guide);
    assert.deepEqual(
      opened,
      [],
      'the stage, the lab and the guide link keep their clicks',
    );

    await click(embed.querySelector('.tile-title')!);
    assert.strictEqual(
      opened.length,
      1,
      'a click on what the demo is opens its card',
    );
  });

  test('every tile and the demo page link the guide their lesson names', async function (assert) {
    await gallery.renderGallery();
    // a tile shows its guide link once it has measured room for its stage
    await waitUntil(
      () =>
        liveAll('[data-gallery-tile] .guide-link').length ===
        GALLERY_DEMOS.length,
      { timeout: 10_000 },
    );

    let links = liveAll<HTMLAnchorElement>('[data-gallery-tile] .guide-link');
    assert.strictEqual(links.length, GALLERY_DEMOS.length, 'one per tile');
    for (let slug of GALLERY_DEMOS) {
      let guide = guideOf(slug);
      assert.ok(GUIDES[guide], `${slug}'s guide, ${guide}, is in the realm`);
      assert
        .dom(`[data-gallery-tile='${slug}'] .guide-link`)
        .hasAttribute('href', guideURL(guide), `${slug} links ${guide}`);
    }

    await gallery.renderDemo('keyframes');
    await waitFor('[data-demo="keyframes"]');
    assert
      .dom('.demo-links .guide-link')
      .hasAttribute(
        'href',
        guideURL(guideOf('keyframes')),
        'the demo page links its guide',
      );
  });

  test('the lab tunes the demo through demoTuning', async function (assert) {
    let { demoTuning } =
      await gallery.import<typeof TuningModule>('lib/tuning');
    let { demoPresets } =
      await gallery.import<typeof PresetsModule>('lib/presets');
    await gallery.renderDemo('enter');
    await waitFor('[data-demo="enter"]');

    assert.dom('.lab-toggle').hasAttribute('aria-expanded', 'false');
    await click('.lab-toggle');
    await waitFor('[data-demo-lab="enter"]');
    assert.dom('.lab-toggle').hasAttribute('aria-expanded', 'true');

    let lab = live('[data-demo-lab="enter"]')!;
    let tuneNamed = (name: string) =>
      [...lab.querySelectorAll<HTMLButtonElement>('.dial-tune')].find(
        (button) => button.textContent?.trim() === name,
      );
    let preset = demoPresets['enter']![0]!;
    await waitUntil(() => tuneNamed(preset.name), { timeout: 5_000 });
    assert.true(
      Object.keys(demoTuning('enter').definitions).length > 0,
      'the stage registered its values',
    );
    assert.deepEqual(
      demoTuning('enter').values,
      {},
      'the demo runs as written until the lab changes something',
    );

    await click(tuneNamed(preset.name)!);
    await waitUntil(() => Object.keys(demoTuning('enter').values).length > 0);
    assert.deepEqual(
      demoTuning('enter').values,
      preset.values,
      `wearing ${preset.name} writes its values into demoTuning`,
    );

    let notice = live('[data-demo-stage] .banner');
    await click('[data-demo-lab="enter"] .lab-replay');
    await waitFor('[data-demo-stage] .banner');
    assert.notStrictEqual(
      live('[data-demo-stage] .banner'),
      notice,
      'replay mounts the stage afresh',
    );

    await click('.lab-toggle');
    assert.dom('[data-demo-lab]').doesNotExist('the lab closes');
    assert.deepEqual(
      demoTuning('enter').values,
      {},
      'and the demo is back as it was written',
    );
  });

  test('labs open on one demo share its tuning, and the last to close resets it', async function (assert) {
    let { demoTuning, tuneNumber } =
      await gallery.import<typeof TuningModule>('lib/tuning');
    let { DemoLab } = await gallery.import<typeof LabModule>('lib/lab');
    const SIZE = 'Size (px)';
    let tuned = (value: number) =>
      waitUntil(() => demoTuning('test-shared-lab').values[SIZE] === value);
    tuneNumber('test-shared-lab', 1, SIZE);

    let page = new DemoLab('test-shared-lab', 'Shared');
    page.dial.set(SIZE, 2);
    await tuned(2);

    let guide = new DemoLab('test-shared-lab', 'Shared');
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(
      demoTuning('test-shared-lab').values[SIZE],
      2,
      'a second lab opening on the demo keeps the tuning the first one made',
    );
    assert.strictEqual(guide.dial.raw[SIZE], 2, 'and shows it');

    guide.dial.set(SIZE, 3);
    await tuned(3);
    assert.strictEqual(
      page.dial.raw[SIZE],
      3,
      'both labs show the edit one of them made',
    );

    guide.teardown();
    await Promise.resolve();
    assert.deepEqual(
      demoTuning('test-shared-lab').values,
      { [SIZE]: 3 },
      'closing one lab leaves the demo tuned while another is open',
    );
    page.dial.set(SIZE, 4);
    await tuned(4);
    assert.strictEqual(
      demoTuning('test-shared-lab').values[SIZE],
      4,
      'and the lab still open still tunes it',
    );

    page.teardown();
    assert.deepEqual(
      demoTuning('test-shared-lab').values,
      {},
      'closing the last lab puts the demo back as it was written',
    );
  });

  test('the lab writes only the values that differ from the demo’s own', async function (assert) {
    let { changedValues } = await gallery.import<typeof LabModule>('lib/lab');
    let definitions = {
      Carry: { type: 'spring', stiffness: 130, damping: 15 },
      'Delay (s)': [0.2, 0, 1, 0.01],
    } as const;
    assert.deepEqual(
      changedValues(definitions as never, {
        Carry: { type: 'spring', stiffness: 130, damping: 15 },
        'Delay (s)': 0.2,
        'Carry.__mode': 'advanced',
      }),
      {},
      'the demo’s own values are no edit',
    );
    assert.deepEqual(
      changedValues(definitions as never, {
        Carry: { type: 'spring', stiffness: 130, damping: 15, mass: 2 },
        'Delay (s)': 0.5,
      }),
      {
        Carry: { type: 'spring', stiffness: 130, damping: 15, mass: 2 },
        'Delay (s)': 0.5,
      },
      'a field the editor adds is an edit, and so is a moved number',
    );
  });

  test('a film has no lab: it plays in a document the lab cannot reach', async function (assert) {
    await gallery.renderDemo('towers');
    await waitFor('[data-demo="towers"]');
    assert.dom('.lab-toggle').doesNotExist();
    assert.dom('.demo-links .guide-link').exists('the guide link still is');
  });
});
