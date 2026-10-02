/**
 * A STEPPED RENDER MOVES THE CAMERA.
 *
 * `renderAt(t)` is how a film is recorded deterministically
 * (`scripts/film-render.mjs` calls it once per frame), and the claim of
 * `@seek='exact'` is that the frame it stands up is the frame playing
 * there would have drawn. It was not: `?from=0` puts the title card up
 * and leaves the film unbooted, an unbooted film has no score — the
 * whole `<Choreo>` is behind `{{#if this.booted}}` — so `fold`'s
 * `run.time = t` wrote to a null run and every rendered frame carried
 * the head beat's pose. Measured on towers, half a degree of yaw across
 * 273 seconds where the compiled path sweeps 380. The renderer never
 * clicked anything, so it hit this every single time.
 *
 * The pose is read from the picture itself (`public/test-picture.html`
 * keeps every `pose()` it is handed), because the lens the picture was
 * told to take is the only lens that ends up in a frame.
 */
import { render, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { Film, IframePicture } from 'glimmer-motion/film';
import { module, test } from 'qunit';

/** what the film publishes for a renderer to drive it by */
interface Handle {
  exact: boolean;
  renderAt: (seconds: number) => Promise<void>;
  seconds: () => number;
}

/** the picture's page keeps what it was asked to draw */
interface PicturePage extends Window {
  __poses?: { az?: number }[];
}

const NAME = 'render-at';
const DEG = 180 / Math.PI;

function handle(): Handle | undefined {
  return (window as unknown as { __choreo?: Record<string, Handle> })
    .__choreo?.[NAME];
}

/** the last lens the film handed the picture, in degrees of yaw */
function yaw(): number {
  const page = (document.querySelector('.cf-frame') as HTMLIFrameElement)
    .contentWindow as PicturePage;
  const poses = page.__poses ?? [];
  return (poses[poses.length - 1]?.az ?? 0) * DEG;
}

module('Integration | film | renderAt', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  hooks.afterEach(function () {
    delete (window as unknown as { __choreo?: Record<string, Handle> })
      .__choreo?.[NAME];
  });

  test('a stepped render flies the camera the score wrote', async function (assert) {
    await render(
      <template>
        {{! four shots a quarter turn apart: a camera that advances at all
        cannot come out of this looking still }}
        <Film
          @name={{NAME}}
          @menuTitle="A RENDER"
          @seek="exact"
          @rail={{false}}
        >
          <:picture as |register|>
            <IframePicture
              @register={{register}}
              @src="/test-picture.html"
              @assets="/"
              @title="a picture that only remembers"
              @standing={{0}}
            />
          </:picture>
          <:default as |f|>
            <f.Spine>
              {{! a chapter, because the transport's playbar reads one }}
              <f.Chapter @n="01" @title="A TURN">
                <f.Shot
                  @name="north"
                  @ticks={{4}}
                  @dolly={{1}}
                  @lookY={{0}}
                  @pitch={{8}}
                  @yaw={{0}}
                />
                <f.Shot
                  @name="east"
                  @ticks={{4}}
                  @dolly={{1}}
                  @lookY={{0}}
                  @pitch={{8}}
                  @yaw={{90}}
                />
                <f.Shot
                  @name="south"
                  @ticks={{4}}
                  @dolly={{1}}
                  @lookY={{0}}
                  @pitch={{8}}
                  @yaw={{180}}
                />
                <f.Shot
                  @name="west"
                  @ticks={{4}}
                  @dolly={{1}}
                  @lookY={{0}}
                  @pitch={{8}}
                  @yaw={{270}}
                />
              </f.Chapter>
            </f.Spine>
          </:default>
        </Film>
      </template>
    );

    await waitUntil(() => (handle()?.seconds() ?? 0) > 0, { timeout: 4000 });
    const film = handle()!;
    assert.true(
      film.exact,
      'the film seeks exactly, or there is nothing to render'
    );
    assert.strictEqual(film.seconds(), 32, 'four shots of four ticks');

    /* THIS IS WHAT A RENDERER MEETS: a door, and no score behind it. The
       renderer has no hands, and nothing about `?from=0` says lobby. */
    assert.dom('.cf-gate').exists('the film is standing behind its door');

    await waitUntil(
      () =>
        (
          (document.querySelector('.cf-frame') as HTMLIFrameElement | null)
            ?.contentWindow as PicturePage | null
        )?.__poses != null,
      { timeout: 4000 }
    );

    const at: number[] = [];
    for (let i = 0; i <= 8; i += 1) {
      await film.renderAt((film.seconds() * i) / 8);
      at.push(yaw());
    }

    const span = Math.max(...at) - Math.min(...at);
    assert.true(
      span > 180,
      `the lens crossed ${span.toFixed(1)}° of yaw over nine stills (${at
        .map((d) => d.toFixed(1))
        .join(', ')})`
    );
    assert.true(
      at[8]! > at[0]!,
      'and it crossed them in the direction the score wrote'
    );
    assert
      .dom('.cf-gate')
      .doesNotExist('the render opened the door itself, and muted');
  });

  test('the same time renders the same lens', async function (assert) {
    await render(
      <template>
        <Film
          @name={{NAME}}
          @menuTitle="A RENDER"
          @seek="exact"
          @rail={{false}}
        >
          <:picture as |register|>
            <IframePicture
              @register={{register}}
              @src="/test-picture.html"
              @assets="/"
              @title="a picture that only remembers"
              @standing={{0}}
            />
          </:picture>
          <:default as |f|>
            <f.Spine>
              {{! a chapter, because the transport's playbar reads one }}
              <f.Chapter @n="01" @title="A TURN">
                <f.Shot
                  @name="north"
                  @ticks={{4}}
                  @dolly={{1}}
                  @lookY={{0}}
                  @pitch={{8}}
                  @yaw={{0}}
                />
                <f.Shot
                  @name="west"
                  @ticks={{4}}
                  @dolly={{1}}
                  @lookY={{0}}
                  @pitch={{8}}
                  @yaw={{270}}
                />
              </f.Chapter>
            </f.Spine>
          </:default>
        </Film>
      </template>
    );

    await waitUntil(() => (handle()?.seconds() ?? 0) > 0, { timeout: 4000 });
    const film = handle()!;
    await waitUntil(
      () =>
        (
          (document.querySelector('.cf-frame') as HTMLIFrameElement | null)
            ?.contentWindow as PicturePage | null
        )?.__poses != null,
      { timeout: 4000 }
    );

    /* a render is a pure function of one number: walk away and come back */
    await film.renderAt(6);
    const first = yaw();
    await film.renderAt(14);
    await film.renderAt(6);
    assert.strictEqual(
      yaw(),
      first,
      'the sixth second is the sixth second, whatever was rendered between'
    );
  });
});
