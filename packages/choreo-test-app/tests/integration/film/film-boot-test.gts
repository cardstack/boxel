/**
 * A FILM BOOTS FROM ITS GRAPH. No `@beats`, no `@chapters`: the rows
 * arrive a frame after render, from the score in the default block, and
 * the door has to stand up in the meantime without a row to stand on.
 * This is the crash Phase 2's migration shipped and the headless peek
 * caught — a field initialiser read the first row's camera at
 * construction — pinned so it cannot come back.
 */
import { render, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { Film, IframePicture } from 'glimmer-motion/film';
import { module, test } from 'qunit';
import { SagradaScore } from 'test-app/components/films/sagrada-score';
import { TowersScore } from 'test-app/components/films/towers-score';

module('Integration | film | boot from the graph', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('Sagrada Família stands its door up from the graph alone', async function (assert) {
    await render(
      <template>
        <Film @name="sagrada-boot" @menuTitle="SAGRADA FAMÍLIA">
          <:picture as |register|>
            <IframePicture
              @register={{register}}
              @src="about:blank"
              @assets="/"
              @title="Sagrada Família"
              @standing={{0}}
            />
          </:picture>
          <:gate as |f|>
            <p data-test-runtime>{{f.runtime}}</p>
          </:gate>
          <:default as |f|>
            <SagradaScore @f={{f}} />
          </:default>
        </Film>
      </template>
    );
    assert
      .dom('.cf-page')
      .exists('the film rendered without a row to stand on');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-runtime]')
          ?.textContent?.includes('5 min'),
      { timeout: 4000 }
    );
    assert
      .dom('[data-test-runtime]')
      .hasText('5 min 20 s', "the door's runtime is the graph's 340 s");
  });

  test('Towers stands its door up from the graph alone', async function (assert) {
    await render(
      <template>
        <Film @name="towers-boot" @menuTitle="TOWERS">
          <:picture as |register|>
            <IframePicture
              @register={{register}}
              @src="about:blank"
              @assets="/"
              @title="Towers"
              @standing={{4.4}}
            />
          </:picture>
          <:gate as |f|>
            <p data-test-runtime>{{f.runtime}}</p>
          </:gate>
          <:default as |f|>
            <TowersScore @f={{f}} />
          </:default>
        </Film>
      </template>
    );
    assert
      .dom('.cf-page')
      .exists('the film rendered without a row to stand on');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-runtime]')
          ?.textContent?.includes('4 min'),
      { timeout: 4000 }
    );
    assert
      .dom('[data-test-runtime]')
      .hasText('4 min 22 s', "the door's runtime is the graph's");
  });
});
