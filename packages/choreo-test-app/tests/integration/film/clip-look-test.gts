/**
 * AN ADJUSTMENT THAT IS NOT THE PICTURE'S.
 *
 * `f.picture.Look` reaches the WebGL page's own grade, and for a long
 * while that was the only actor with a vocabulary — a clip was a DOM
 * element with a source and a window and nothing else, so a video inset
 * over a graded picture was ungraded and there was no way to say
 * otherwise. `f.clip.Look` is the clip actor's own set, declared by the
 * film because the film draws the clip layer, and collected by the CLIP
 * rather than by the beat.
 */
import { render, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { type CompiledGraph, FilmGraph } from 'glimmer-motion/film';
import { module, test } from 'qunit';

module('Integration | film | a look held on a clip', function (hooks) {
  setupRenderingTest(hooks);

  test('the look lands on the clip, not on the beat', async function (assert) {
    let compiled: CompiledGraph | null = null;
    const take = (c: CompiledGraph | null) => (compiled = c);
    await render(
      <template>
        <FilmGraph @onCompile={{take}} as |f|>
          <f.Spine>
            <f.Shot
              @name="a"
              @ticks={{3}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.Inset @src="one.mp4" @x={{60}} @y={{10}} @w={{30}}>
                <f.clip.Look @sat={{0.2}} @con={{1.3}} @blur={{2}} />
              </f.Inset>
              {{! a second clip, ungraded, on its own lane }}
              <f.Inset @src="two.mp4" @x={{6}} @y={{55}} @w={{24}} />
            </f.Shot>
          </f.Spine>
        </FilmGraph>
      </template>
    );
    await waitUntil(() => compiled != null, { timeout: 4000 });
    const beat = compiled!.beats[0]!;
    assert.strictEqual(beat.clips?.length, 2, 'both clips are on the row');
    assert.deepEqual(
      beat.clips![0]!.look,
      { blur: 2, con: 1.3, sat: 0.2 },
      'the first wears what was attached to it'
    );
    assert.strictEqual(
      beat.clips![1]!.look,
      undefined,
      'and the second, on its own lane, wears nothing'
    );
    assert.notOk(
      'look' in beat,
      'the look never reached the beat: it is the clip actor’s'
    );
  });

  test('two looks on one clip merge, later winning', async function (assert) {
    let compiled: CompiledGraph | null = null;
    const take = (c: CompiledGraph | null) => (compiled = c);
    await render(
      <template>
        <FilmGraph @onCompile={{take}} as |f|>
          <f.Spine>
            <f.Shot
              @name="a"
              @ticks={{3}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.Inset @src="one.mp4">
                <f.clip.Look @sat={{0.2}} @bri={{0.8}} />
                <f.clip.Look @bri={{1.4}} @sepia={{0.3}} />
              </f.Inset>
            </f.Shot>
          </f.Spine>
        </FilmGraph>
      </template>
    );
    await waitUntil(() => compiled != null, { timeout: 4000 });
    assert.deepEqual(
      compiled!.beats[0]!.clips![0]!.look,
      { bri: 1.4, sat: 0.2, sepia: 0.3 },
      'an adjustment layer stack: the nearer one wins the keys it names'
    );
  });
});
