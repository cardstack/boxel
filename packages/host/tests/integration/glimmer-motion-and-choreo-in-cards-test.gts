import { click, waitUntil } from '@ember/test-helpers';

import * as hostChoreo from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { getService } from '@universal-ember/test-support';
import { animationsSettled, whatIsBusy } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

// glimmer-motion and Choreo are platform-provided modules: the host serves
// them to card code through VirtualNetwork shims, handing cards the host's own
// module objects. The card modules here are realm source strings, so their
// imports resolve through those shims exactly as a user realm's do — Choreo's
// through the async shim.
const motionCardsSource = `
  import { CardDef, Component } from '@cardstack/base/card-api';
  import { hash } from '@ember/helper';
  import { on } from '@ember/modifier';
  import { tracked } from '@glimmer/tracking';
  import { modifier } from 'ember-modifier';
  import { motion, motionValue, styleEffect } from 'glimmer-motion';
  import { Choreo } from '@cardstack/choreo';

  export class FadeIn extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div
          data-test-fader
          {{motion
            initial=(hash opacity=0)
            animate=(hash opacity=1)
            transition=(hash duration=0.05)
          }}
        ></div>
      </template>
    };
  }

  export class ChoreoStage extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      @tracked show = true;
      hide = () => {
        this.show = false;
      };
      <template>
        <button data-test-hide {{on 'click' this.hide}}>Hide</button>
        <Choreo @id='card-stage' as |c|>
          {{#if this.show}}
            <div data-test-leaver {{motion id='leaver' role='card'}}>Leaver</div>
          {{/if}}
          <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @duration={{0.3}} />
        </Choreo>
      </template>
    };
  }

  export class BoundOpacity extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      opacity = motionValue(1);
      bind = modifier((element) => styleEffect(element, { opacity: this.opacity }));
      dim = () => this.opacity.set(0.25);
      <template>
        <button data-test-dim {{on 'click' this.dim}}>Dim</button>
        <div data-test-bound {{this.bind}}></div>
      </template>
    };
  }
`;

module('Integration | glimmer-motion and Choreo in cards', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupChoreo(hooks);
  let loader: Loader;

  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: { 'motion-cards.gts': motionCardsSource },
    });
  });

  async function renderIsolated(cardName: string) {
    let mod: Record<string, new () => CardDefType> = await loader.import(
      `${testRealmURL}motion-cards`,
    );
    await renderCard(loader, new mod[cardName](), 'isolated');
  }

  test('a card using {{motion}} animates to its target', async function (assert) {
    await renderIsolated('FadeIn');
    await animationsSettled();
    assert.strictEqual(
      (document.querySelector('[data-test-fader]') as HTMLElement).style
        .opacity,
      '1',
      'the modifier wrote the animated value to the element',
    );
  });

  test('a card using <Choreo> runs its exit timeline', async function (assert) {
    await renderIsolated('ChoreoStage');
    await animationsSettled();

    await click('[data-test-hide]');
    assert
      .dom('[data-choreo-orphans] [data-test-leaver]')
      .exists('the removed element moves to the orphan layer for its exit');

    await animationsSettled();
    assert
      .dom('[data-test-leaver]')
      .doesNotExist('it unmounts when its exit ends');
  });

  test("a card driving a style from glimmer-motion's motionValue re-export", async function (assert) {
    await renderIsolated('BoundOpacity');
    let bound = document.querySelector('[data-test-bound]') as HTMLElement;
    await waitUntil(() => bound.style.opacity === '1');

    await click('[data-test-dim]');
    await waitUntil(() => bound.style.opacity === '0.25');
    assert.strictEqual(
      bound.style.opacity,
      '0.25',
      'the style follows the value',
    );
  });

  test('cards get the host’s own module objects', async function (assert) {
    // One row per glimmer-motion and Choreo id `shimExternals` registers,
    // sync and async alike, each paired with the host's own import of it.
    let shims: [string, () => Promise<object>][] = [
      ['glimmer-motion', () => import('glimmer-motion')],
      [
        'glimmer-motion/layout-group',
        () => import('glimmer-motion/layout-group'),
      ],
      [
        'glimmer-motion/motion-config',
        () => import('glimmer-motion/motion-config'),
      ],
      ['glimmer-motion/presence', () => import('glimmer-motion/presence')],
      [
        'glimmer-motion/reorder/group',
        () => import('glimmer-motion/reorder/group'),
      ],
      [
        'glimmer-motion/reorder/item',
        () => import('glimmer-motion/reorder/item'),
      ],
      [
        'glimmer-motion/test-support',
        () => import('glimmer-motion/test-support'),
      ],
      ['@cardstack/choreo', () => import('@cardstack/choreo')],
      ['@cardstack/choreo/choreo', () => import('@cardstack/choreo/choreo')],
      ['@cardstack/choreo/steps', () => import('@cardstack/choreo/steps')],
      [
        '@cardstack/choreo/test-support',
        () => import('@cardstack/choreo/test-support'),
      ],
      ['@cardstack/choreo/film', () => import('@cardstack/choreo/film')],
      [
        '@cardstack/choreo/film/clip',
        () => import('@cardstack/choreo/film/clip'),
      ],
      [
        '@cardstack/choreo/film/film',
        () => import('@cardstack/choreo/film/film'),
      ],
      [
        '@cardstack/choreo/film/graph/adjust',
        () => import('@cardstack/choreo/film/graph/adjust'),
      ],
      [
        '@cardstack/choreo/film/graph/host',
        () => import('@cardstack/choreo/film/graph/host'),
      ],
      [
        '@cardstack/choreo/film/graph/nodes',
        () => import('@cardstack/choreo/film/graph/nodes'),
      ],
      [
        '@cardstack/choreo/film/joins',
        () => import('@cardstack/choreo/film/joins'),
      ],
      [
        '@cardstack/choreo/film/overlays',
        () => import('@cardstack/choreo/film/overlays'),
      ],
      [
        '@cardstack/choreo/film/picture',
        () => import('@cardstack/choreo/film/picture'),
      ],
      [
        '@cardstack/choreo/film/plate',
        () => import('@cardstack/choreo/film/plate'),
      ],
      [
        '@cardstack/choreo/film/player',
        () => import('@cardstack/choreo/film/player'),
      ],
      [
        '@cardstack/choreo/film/rail',
        () => import('@cardstack/choreo/film/rail'),
      ],
      [
        '@cardstack/choreo/film/titles',
        () => import('@cardstack/choreo/film/titles'),
      ],
    ];
    for (let [specifier, importFromHost] of shims) {
      let cardModule: Record<string, unknown> = await loader.import(specifier);
      let hostModule = (await importFromHost()) as Record<string, unknown>;
      let exportNames = Object.keys(hostModule);
      assert.ok(exportNames.length > 0, `${specifier} has exports`);
      assert.deepEqual(
        exportNames.filter((name) => cardModule[name] !== hostModule[name]),
        [],
        `every ${specifier} export a card sees is the host's own`,
      );
    }
  });

  test("a card's motion state is visible to the host's copies of the libraries", async function (assert) {
    await renderIsolated('ChoreoStage');
    await animationsSettled();

    assert.ok(
      hostChoreo.choreoHostById('card-stage'),
      "the card's <Choreo> registered in the host's Choreo registry",
    );

    await click('[data-test-hide]');
    assert.ok(
      whatIsBusy().some((reason) => reason.includes('<Choreo card-stage>')),
      `the host's glimmer-motion sees the card's run in flight (busy: ${whatIsBusy().join(', ')})`,
    );

    await animationsSettled();
    assert.deepEqual(whatIsBusy(), [], 'and sees it finish');
  });
});
