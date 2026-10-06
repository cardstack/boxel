/**
 * A SEAM WRITTEN IN THE APP. The film's twelve joins are presentations —
 * a component given the outgoing still and told how long it has — and a
 * thirteenth written here satisfies the same contract with no library
 * privilege: a score names it with `<f.Join @presentation={{Curtain}}>`,
 * the compiler names it for the film and registers it, and `<Joins>`
 * plays it like any of the twelve. This is the acceptance test the
 * constructs doc asked for (docs/film-graph/CONSTRUCTS.md, "the join is
 * not an engine construct").
 */
import {
  type CompiledGraph,
  FilmGraph,
  Joins,
  type Presentation,
  PRESENTATIONS,
  type PresentationSignature,
  retire,
} from '@cardstack/choreo/film';
import { render, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

/** a curtain: the still drops out of frame */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
class Curtain extends Component<PresentationSignature> {
  <template>
    <img
      data-test-curtain
      class='curtain'
      src={{@still}}
      alt=''
      {{retire @seekable}}
    />
  </template>
}

/** a one-pixel still, so the presentation has something to hold */
const STILL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

module('Integration | film | a seam written in the app', function (hooks) {
  setupRenderingTest(hooks);

  test('a score brings a presentation; the compiler names it and the film plays it', async function (assert) {
    let compiled: CompiledGraph | null = null;
    const take = (c: CompiledGraph | null) => (compiled = c);
    await render(
      <template>
        <FilmGraph @onCompile={{take}} as |f|>
          <f.Spine @join='dip'>
            <f.Shot
              @name='a'
              @ticks={{2}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            />
            <f.Join @presentation={{Curtain}} @secs={{0.8}} />
            <f.Shot
              @name='b'
              @ticks={{2}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            />
            <f.Join @presentation='wipe' />
            <f.Shot
              @name='c'
              @ticks={{2}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            />
          </f.Spine>
        </FilmGraph>
      </template>,
    );
    await waitUntil(() => compiled != null, { timeout: 4000 });
    const c = compiled!;
    assert.strictEqual(
      c.beats[1]!.join,
      'presentation:1',
      'the row names the brought seam',
    );
    assert.strictEqual(c.beats[2]!.join, 'wipe', 'a named seam is itself');
    assert.strictEqual(
      c.presentations['presentation:1']?.component,
      Curtain,
      'the presentation is registered',
    );
    assert.strictEqual(
      c.presentations['presentation:1']?.secs,
      0.8,
      'with its length',
    );

    // the film's registry: its twelve, and the one the score brought
    const presentations: Record<string, Presentation> = {
      ...PRESENTATIONS,
      'presentation:1': { component: Curtain, secs: 0.8, still: true },
    };
    await render(
      <template>
        <Joins
          @kind='presentation:1'
          @stamp={{1}}
          @freeze={{STILL}}
          @presentations={{presentations}}
        />
      </template>,
    );
    assert
      .dom('[data-test-curtain]')
      .exists('the seam on screen is the curtain');
    assert
      .dom('[data-test-curtain]')
      .hasAttribute('src', STILL, 'holding the outgoing frame');
  });

  test('how deep a seam goes: the spine says, a chapter says, a join says', async function (assert) {
    let compiled: CompiledGraph | null = null;
    const take = (c: CompiledGraph | null) => (compiled = c);
    await render(
      <template>
        <FilmGraph @onCompile={{take}} as |f|>
          <f.Spine @join='wipe' @over='everything'>
            <f.Shot
              @name='a'
              @ticks={{2}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            />
            <f.Join @presentation='wipe' />
            <f.Shot
              @name='b'
              @ticks={{2}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            />
            <f.Join @presentation='dip' @over='picture' />
            <f.Shot
              @name='c'
              @ticks={{2}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            />
            <f.Chapter @n='02' @title='Shallow' @over='picture'>
              <f.Shot
                @name='d'
                @ticks={{2}}
                @dolly={{1}}
                @lookY={{0}}
                @pitch={{0}}
                @yaw={{0}}
              />
              <f.Join @presentation='melt' />
              <f.Shot
                @name='e'
                @ticks={{2}}
                @dolly={{1}}
                @lookY={{0}}
                @pitch={{0}}
                @yaw={{0}}
              />
            </f.Chapter>
          </f.Spine>
        </FilmGraph>
      </template>,
    );
    await waitUntil(() => compiled != null, { timeout: 4000 });
    const c = compiled!;
    assert.strictEqual(
      c.defaultOver,
      'everything',
      "the spine's depth is the film's default, not a column",
    );
    assert.strictEqual(
      c.beats[1]!.over,
      undefined,
      'so a row under the spine carries no depth of its own',
    );
    assert.strictEqual(
      c.beats[2]!.over,
      'picture',
      'a join that says otherwise is written on the row',
    );
    assert.strictEqual(
      c.beats[4]!.over,
      'picture',
      "and a chapter's depth reaches the seams inside it",
    );
  });

  test('a seam that needs a still and has none paints nothing', async function (assert) {
    await render(
      <template>
        <Joins
          @kind='wipe'
          @stamp={{1}}
          @freeze=''
          @presentations={{PRESENTATIONS}}
        />
      </template>,
    );
    assert.dom('.cf-swipe').doesNotExist('no still, no wipe');
    await render(
      <template>
        <Joins
          @kind='dip'
          @stamp={{2}}
          @freeze=''
          @presentations={{PRESENTATIONS}}
        />
      </template>,
    );
    assert.dom('.cf-dip').exists('a dip paints its veil even without a still');
  });
});
