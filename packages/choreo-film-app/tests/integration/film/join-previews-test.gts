/**
 * THE WALL PLATE'S TRIGGERS CROSS THE FRAME. The page that frames a film
 * posts `{ type, join }`; the film plays that join through its own
 * `preview`, and hears nobody but the page framing it.
 */
import type { Join } from '@cardstack/choreo/film';
import { render } from '@ember/test-helpers';
import {
  JoinPreviews,
  PREVIEW_JOIN,
} from 'choreo-film-app/components/join-previews';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

function post(data: unknown, source: MessageEventSource | null) {
  window.dispatchEvent(new MessageEvent('message', { data, source }));
}

module('Integration | film | join previews', function (hooks) {
  setupRenderingTest(hooks);

  test('a join posted by the framing page plays through preview', async function (assert) {
    const played: Join[] = [];
    const preview = (join: Join) => played.push(join);
    await render(<template><JoinPreviews @preview={{preview}} /></template>);

    // the wire spelling the gallery's FilmLink sends, not this side's constant
    post({ type: 'choreo-film:preview-join', join: 'wipe' }, window.parent);
    post({ type: 'choreo-film:preview-join', join: 'iris' }, window.parent);

    assert.deepEqual(played, ['wipe', 'iris']);
  });

  test('anything else is not heard', async function (assert) {
    const played: Join[] = [];
    const preview = (join: Join) => played.push(join);
    await render(<template><JoinPreviews @preview={{preview}} /></template>);

    const stranger = new MessageChannel().port1;
    post({ type: PREVIEW_JOIN, join: 'wipe' }, stranger);
    post({ type: PREVIEW_JOIN, join: 'spin' }, window.parent);
    post({ type: PREVIEW_JOIN, join: 'toString' }, window.parent);
    post({ type: 'something-else', join: 'wipe' }, window.parent);
    post('wipe', window.parent);
    post(null, window.parent);

    assert.deepEqual(
      played,
      [],
      'a stranger, an unknown join and a foreign message all go unplayed'
    );
  });

  test('a film taken down stops listening', async function (assert) {
    const played: Join[] = [];
    const preview = (join: Join) => played.push(join);
    await render(<template><JoinPreviews @preview={{preview}} /></template>);
    await render(<template></template>);

    post({ type: PREVIEW_JOIN, join: 'wipe' }, window.parent);

    assert.deepEqual(played, []);
  });
});
