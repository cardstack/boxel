import Component from '@glimmer/component';
import { Film, IframePicture } from 'glimmer-motion/film';
import config from 'test-app/config/environment';

/**
 * THE TRANSITION REEL — the film construct pointed at something that is
 * not a building, to see whether the seam system holds up outside the two
 * films it was lifted from.
 *
 * It is deliberately made of what this repository already has: five
 * poster plates, one short loop for the picture-in-picture, and nothing
 * fetched. What it demonstrates, in order:
 *
 * 1. SEAMS IN THREE PLACES AT ONCE. A `wipe` and an `iris` are shapes and
 *    play as overlays in this document; a `blend`, a `melt` and a `dip`
 *    are mixes and play in the picture's glass, in light; and four more
 *    are SHADERS the picture itself declares (`ridged-burn`, `sdf-iris`,
 *    `chromatic-split`, `light-leak`) and the score names exactly the same
 *    way. The film does not know which is which.
 * 2. PICTURE-IN-PICTURE WITH ITS OWN FADE. `f.Inset` places a layer in
 *    percent of the frame, with its own in and out.
 * 3. THE FRAME TWEAKED PER SHOT. `f.picture.Look` moves the grade this
 *    picture actually implements — exposure, contrast, saturation, the
 *    vignette — and `f.picture.Build @subject` chooses the plate.
 * 4. GPU EFFECTS. Everything above the plate is one fragment shader: the
 *    grade, the vignette, the grain and every seam in the glass.
 */
export default class ReelFilm extends Component<{
  Args: { embed?: boolean };
}> {
  /* the grades this picture understands, by the names a score uses */
  grades = {
    cool: {
      bri: 0.92,
      con: 1.06,
      cool: [0.86, 0.94, 1.06] as [number, number, number],
      gradeA: 1,
      hue: 0,
      sat: 0.9,
      sep: 0,
      vigA: 0.5,
      warm: [1, 1, 1] as [number, number, number],
    },
    flat: {
      bri: 1,
      con: 1,
      cool: [1, 1, 1] as [number, number, number],
      gradeA: 0,
      hue: 0,
      sat: 1,
      sep: 0,
      vigA: 0.2,
      warm: [1, 1, 1] as [number, number, number],
    },
    hot: {
      bri: 1.16,
      con: 1.14,
      cool: [1, 1, 1] as [number, number, number],
      gradeA: 1,
      hue: 0,
      sat: 1.24,
      sep: 0,
      vigA: 0.1,
      warm: [1.08, 1.02, 0.92] as [number, number, number],
    },
    silver: {
      bri: 1.02,
      con: 1.2,
      cool: [1, 1, 1] as [number, number, number],
      gradeA: 1,
      hue: 0,
      sat: 0.12,
      sep: 0,
      vigA: 0.7,
      warm: [1, 1, 1] as [number, number, number],
    },
  };

  get assets(): string {
    return config.rootURL;
  }

  get src(): string {
    return `${config.rootURL}asset/reel-plate.html`;
  }

  get embed(): boolean {
    return (
      (this.args.embed ?? false) || /[?&]embed\b/.test(window.location.search)
    );
  }

  get seek(): 'cut' | 'exact' {
    return new URLSearchParams(window.location.search).get('seek') === 'cut'
      ? 'cut'
      : 'exact';
  }

  <template>
    <Film
      @name="reel"
      @menuTitle="THE TRANSITION REEL"
      @menuSub="every seam this engine can play · chapters"
      @rail={{true}}
      @embed={{this.embed}}
      @seek={{this.seek}}
      @join="blend"
      @over="everything"
    >
      <:picture as |register|>
        {{! the picture DECLARES four seams; a score reaches them by name }}
        <IframePicture
          @register={{register}}
          @src={{this.src}}
          @assets={{this.assets}}
          @title="Plates"
          @standing={{0}}
          @grades={{this.grades}}
          @seams={{this.seamNames}}
        />
      </:picture>

      <:gate as |f|>
        <p class="reel-lede">Nine seams, three of them shaders the picture
          brought.
          {{f.runtime}}.</p>
      </:gate>

      <:default as |f|>
        <f.Spine @join="blend" @over="everything">
          <f.Chapter @n="01" @title="The mixes">
            <f.Shot
              @name="open"
              @ticks={{2}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{0}} />
              <f.picture.Look @grade="flat" />
              <f.Type
                @mode="title"
                @kicker="THE TRANSITION REEL"
                @word="SEAMS"
                @says={{this.openLines}}
              />
            </f.Shot>

            <f.Join @presentation="blend" />
            <f.Shot
              @name="blend"
              @ticks={{2}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{1}} />
              <f.picture.Look @grade="hot" />
              <f.Type @mode="lower" @kicker="IN THE GLASS" @word="BLEND" />
            </f.Shot>

            <f.Join @presentation="melt" />
            <f.Shot
              @name="melt"
              @ticks={{2}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{2}} />
              <f.picture.Look @grade="cool" />
              <f.Type @mode="lower" @kicker="IN THE GLASS" @word="MELT" />
            </f.Shot>

            <f.Join @presentation="dip" @to="#120a06" />
            <f.Shot
              @name="dip"
              @ticks={{2}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{3}} />
              <f.picture.Look @grade="silver" />
              <f.Type @mode="lower" @kicker="THROUGH A COLOUR" @word="DIP" />
            </f.Shot>
          </f.Chapter>

          <f.Chapter @n="02" @title="The shapes">
            <f.Join @presentation="wipe" @over="everything" />
            <f.Shot
              @name="wipe"
              @ticks={{2}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{4}} />
              <f.picture.Look @grade="flat" />
              <f.Type @mode="lower" @kicker="AN OVERLAY, SWEPT" @word="WIPE" />
            </f.Shot>

            <f.Join @presentation="iris" />
            <f.Shot
              @name="iris"
              @ticks={{2}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{0}} />
              <f.picture.Look @grade="hot" />
              <f.Type @mode="lower" @kicker="AN OVERLAY, CLOSED" @word="IRIS" />
            </f.Shot>
          </f.Chapter>

          <f.Chapter @n="03" @title="The picture's own">
            <f.Join @presentation="ridged-burn" @secs={{0.9}} />
            <f.Shot
              @name="burn"
              @ticks={{2}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{1}} />
              <f.picture.Look @grade="cool" />
              <f.Type
                @mode="lower"
                @kicker="A SHADER THE PICTURE BROUGHT"
                @word="BURN"
              />
            </f.Shot>

            <f.Join @presentation="sdf-iris" @secs={{0.8}} />
            <f.Shot
              @name="sdf"
              @ticks={{2}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{2}} />
              <f.picture.Look @grade="flat" />
              <f.Type
                @mode="lower"
                @kicker="A SHADER THE PICTURE BROUGHT"
                @word="SDF"
              />
            </f.Shot>

            <f.Join @presentation="chromatic-split" @secs={{0.7}} />
            <f.Shot
              @name="split"
              @ticks={{2}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{3}} />
              <f.picture.Look @grade="silver" />
              <f.Type
                @mode="lower"
                @kicker="A SHADER THE PICTURE BROUGHT"
                @word="SPLIT"
              />
            </f.Shot>

            <f.Join @presentation="light-leak" @secs={{1}} />
            <f.Shot
              @name="leak"
              @ticks={{3}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{4}} />
              <f.picture.Look @grade="hot" />
              <f.Type
                @mode="lower"
                @kicker="A SHADER THE PICTURE BROUGHT"
                @word="LEAK"
              />
              {{! THE PICTURE IN THE PICTURE: a layer, placed in percent of
              the frame, with its own fade in and out }}
              {{! AND THE LAYER IS GRADED, not just placed. `f.clip.Look`
              is the clip actor's own adjustment — the first in this
              vocabulary that belongs to something other than the
              picture. }}
              <f.Inset
                @src="xstress-loop.mp4"
                @x={{62}}
                @y={{14}}
                @w={{30}}
                @radius={{3}}
                @fade={{0.5}}
                @at={{0.6}}
                @for={{4.4}}
              >
                <f.clip.Look @sat={{0.15}} @con={{1.25}} @bri={{0.92}} />
              </f.Inset>
            </f.Shot>
          </f.Chapter>

          <f.Chapter @n="04" @title="Two at once">
            <f.Join @presentation="melt" />
            <f.Shot
              @name="both"
              @ticks={{4}}
              @cut={{true}}
              @dolly={{1}}
              @lookY={{0}}
              @pitch={{0}}
              @yaw={{0}}
            >
              <f.picture.Build @subject={{0}} />
              <f.picture.Look @grade="cool" />
              <f.Type
                @mode="lower"
                @kicker="A LAYER AND A GRADE"
                @word="TOGETHER"
                @says={{this.closeLines}}
              />
              <f.Inset
                @src="xstress-loop.mp4"
                @x={{6}}
                @y={{54}}
                @w={{26}}
                @radius={{50}}
                @fade={{0.7}}
                @at={{0.4}}
                @for={{6.4}}
              />
              <f.Inset
                @src="still/macbook.webp"
                @still={{true}}
                @x={{40}}
                @y={{18}}
                @w={{24}}
                @radius={{2}}
                @fade={{0.6}}
                @at={{1.8}}
                @for={{5}}
              >
                <f.clip.Look @sepia={{0.5}} @bri={{1.1}} @blur={{0.6}} />
              </f.Inset>
            </f.Shot>
          </f.Chapter>
        </f.Spine>
      </:default>
    </Film>
  </template>

  seamNames = ['ridged-burn', 'sdf-iris', 'chromatic-split', 'light-leak'];
  openLines = ['Nine seams.', 'Three of them the picture brought.'];
  closeLines = ['Two layers, one grade,', 'and every seam on one clock.'];
}
