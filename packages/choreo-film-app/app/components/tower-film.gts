import { Film, IframePicture } from '@cardstack/choreo/film';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { TowersScore } from 'choreo-film-app/components/films/towers-score';
import { JoinPreviews } from 'choreo-film-app/components/join-previews';
import { assetURL } from 'choreo-film-app/lib/assets';
import {
  BUILD,
  GRADES,
  LOOK_FX,
  LUT_AMOUNT,
  STANDING,
  VO_GAIN,
  WORLD_TYPE,
} from 'choreo-film-app/lib/films/towers';
import { tuneNumber } from 'choreo-film-app/lib/tuning';

// Declare the film variables before asynchronous picture loading.
function rigMid() {
  return tuneNumber('towers', 7.065, 'Camera rig height (units)', 1, 14, 0.001);
}
rigMid();
function cloudHaze() {
  return tuneNumber('towers', 0.17, 'Cloud haze', 0, 1, 0.01);
}
cloudHaze();
function lutAmount() {
  return tuneNumber('towers', LUT_AMOUNT, 'Color grade strength', 0, 1, 0.01);
}
lutAmount();

export default class TowerFilm extends Component<{
  Args: {
    embed?: boolean;
    /** the picture's page, as markup: see lib/picture-document */
    picture?: string;
  };
}> {
  grades = GRADES;
  voGain = VO_GAIN;
  worldType = WORLD_TYPE;

  get assets(): string {
    return assetURL('towers/');
  }

  get src(): string {
    return assetURL('towers-model.html');
  }

  /**
   * HOW THE FILM SEEKS. `?seek=exact` makes it a pure function of its
   * clock — scrub anywhere, render any frame — at the cost of the hand;
   * the default is the chased, hand-held cut (see `<Film @seek>`).
   */
  get seek(): 'cut' | 'exact' {
    return new URLSearchParams(window.location.search).get('seek') === 'exact'
      ? 'exact'
      : 'cut';
  }

  get embed(): boolean {
    return (
      (this.args.embed ?? false) || /[?&]embed\b/.test(window.location.search)
    );
  }

  <template>
    <Film
      @name="towers"
      @build={{BUILD}}
      @menuTitle="TOWERS"
      @menuSub="A construction study · chapters"
      @voGain={{this.voGain}}
      @rail={{false}}
      @embed={{@embed}}
      @seek={{this.seek}}
    >
      {{! THE PICTURE is a component, not fourteen arguments: the page
      behind the iframe, where its files live, how it is seated before the
      door, its rig and its moods — and it declares the adjustments a shot
      may hold on it, f.picture.* }}
      <:picture as |register|>
        <IframePicture
          @register={{register}}
          @src={{this.src}}
          @srcdoc={{@picture}}
          @assets={{this.assets}}
          @title="Towers"
          @standing={{STANDING}}
          @rigMid={{(rigMid)}}
          @cloudHaze={{(cloudHaze)}}
          @lutAmount={{(lutAmount)}}
          @grades={{this.grades}}
          @lookFx={{LOOK_FX}}
          @worldType={{this.worldType}}
        />
      </:picture>
      {{! FRONT MATTER. The gate runs the title package: a rule draws down
      like a hanging scroll, the kanji settle out of a blur one after the
      other, the wordmark tracks in, and the seal stamps last — the same
      seal-red the lineup stamps with. }}
      <:gate as |f|>
        <span class="cf-gate-vert" aria-hidden="true">天守 — 構造の研究</span>
        <div class="cf-gate-in cf-matter">
          <i class="cf-mg-rule" aria-hidden="true"></i>
          <p class="cf-gate-k">
            <span class="cf-gate-ghost" aria-hidden="true">天守</span>
            <span class="cf-mg-g1">天</span><span class="cf-mg-g2">守</span></p>
          <p class="cf-gate-t cf-mg-mark">TOWERS</p>
          <p class="cf-gate-s cf-mg-sub">A construction study ·
            {{f.runtime}}</p>
          {{! the claim, on the door: nothing here is a file. One quiet
          sentence in the film's own serif, and a whisper of caps under it
          — a title card, not a spec sheet }}
          <p class="cf-gate-live">Live composite: a three.js scene, motion
            graphics and a mixed score, rendered in the browser at the moment of
            viewing. No video file exists.</p>
          <p class="cf-gate-live-k">Generated with AI · Directed by Chris Tse ·
            2026</p>
          <span class="cf-mg-seal" aria-hidden="true">普請</span>
          <div class="cf-gate-row cf-mg-row">
            <button
              type="button"
              class="cf-go"
              {{on "click" (fn f.begin true)}}
            >▶ Begin with sound</button>
            <button
              type="button"
              class="cf-go is-quiet"
              {{on "click" (fn f.begin false)}}
            >Begin muted</button>
          </div>
        </div>
        <p class="cf-gate-index" aria-hidden="true">
          <span>壱 — CONTEXT</span>
          <span>弐 — HISTORY</span>
          <span>参 — CONSTRUCTION</span>
          <span>肆 — DETAIL</span>
          <span>伍 — COMPARISON</span>
        </p>
      </:gate>

      {{! BACK MATTER — the same package, run in reverse order of
      importance: the end glyph, the mark, then the credits a finished
      film owes. }}
      <:end as |f|>
        <i class="cf-mg-rule" aria-hidden="true"></i>
        <p class="cf-end-k"><span class="cf-mg-g1">終</span></p>
        <p class="cf-end-t cf-mg-mark">TOWERS</p>
        <p class="cf-end-s cf-mg-sub">A construction study</p>
        <span class="cf-mg-seal" aria-hidden="true">天守</span>
        <p class="cf-mg-credits">
          <span>Picture — rendered live in your browser · no video file</span>
          <span>Made entirely with AI · directed by a human</span>
          <span>Director — Chris Tse</span>
          <span>Motion engine — Choreo by Cardstack</span>
          <span>Scene — threeui · Meng To</span>
          <span>Voice — Calvin · ElevenLabs</span>
        </p>
        <div class="cf-gate-row cf-mg-row">
          <button type="button" class="cf-go" {{on "click" f.restart}}>↺ Watch
            again</button>
          <button type="button" class="cf-go is-quiet" {{on "click" f.toc}}>☰
            Chapters</button>
        </div>
      </:end>

      {{! THE SCORE: the film, written as a graph — a spine of chapters
      and shots with everything attached under the shot it belongs to.
      It compiles to the same rows the beat table used to hand in
      (tests/integration/film/graph-test.gts proves it, row for row). }}
      <:default as |f|>
        <TowersScore @f={{f}} />
        {{! the wall plate's join triggers, from the page framing the film }}
        <JoinPreviews @preview={{f.preview}} />
      </:default>
    </Film>

    {{! THE IDENTITY. The construct's default is the second film's voice;
    this one is set beside mincho kanji and stands in front of a keep, so
    it takes a warm old-style serif for the display and the phrases, a
    plain sans for the small mechanical labels, and a vertical hanko for
    the seal. Everything below overrides only what the keep says
    differently. }}
    <style>
      .cf-page.is-towers {
        --cf-display:
          "Iowan Old Style", "Charter", "Palatino Linotype", Palatino,
          "Book Antiqua", Georgia, serif;
        --cf-serif: var(--cf-display);
        --cf-ui:
          "Helvetica Neue", "Franklin Gothic Medium", Inter, system-ui,
          sans-serif;
      }

      .is-towers .cf-kicker {
        letter-spacing: 0.17em;
        color: var(--cf-ink3);
      }

      .is-towers .cf-kicker::after {
        background: var(--cf-accent);
        flex: 1;
        min-width: 0;
      }

      /* the construct sets a Latin headline in the chapter's colour; this
         film's headlines are ink whatever the script, and its red is kept
         for the one thing happening now */
      .is-towers .cf-kanji.is-latin {
        color: var(--cf-ink);
        /* the serif's regular, like the kanji: a headline in this face is
           big, not bold */
        font-weight: 400;
      }

      .is-towers .cf-romaji {
        font-size: clamp(12px, 1.02vw, 15px);
        letter-spacing: 0.15em;
        color: var(--cf-ink);
      }

      .is-towers .cf-gloss {
        font-family: var(--cf-display);
        font-size: clamp(13px, 1.06vw, 16px);
        font-style: italic;
      }

      /* a phrase is a headline in the serif: two seconds on screen, read
         at a glance, never past two lines */
      .is-towers .cf-say {
        font-size: clamp(20px, 2.15vw, 37px);
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        line-height: 1.24;
        max-width: 26ch;
        text-wrap: balance;
      }

      /* "The shock runs into the hill" — an impact that lands, digs a
         hair past its mark, and settles; "that weight is what steadies
         it" — the kawara line carries mass and settles once */
      .is-towers .sx-ishi2-0 {
        animation: cf-plumb 7s cubic-bezier(0.6, 0, 0.1, 1) both;
      }

      .is-towers .sx-ishi2-2 {
        animation: cf-sink 8s cubic-bezier(0.34, 1.3, 0.36, 1) both;
      }

      .is-towers .sx-kawara-2 {
        animation: cf-sink 9s cubic-bezier(0.5, 1.2, 0.4, 1) both;
      }

      .is-towers .cf-plate .cf-ghost {
        opacity: calc(0.07 * var(--cf-ghost-a, 1));
      }

      .is-towers .cf-subs {
        font-family: var(--cf-ui);
        font-size: 15px;
        max-width: 66ch;
      }

      /* the spine: vertical Japanese down the inside of the frame */
      .is-towers .cf-gate-vert {
        font-family: var(--cf-display);
        font-weight: 400;
        font-size: clamp(13px, 1.3vw, 18px);
        letter-spacing: 0.42em;
      }

      .is-towers .cf-gate-k {
        font-weight: 400;
        font-size: min(22vh, 17vw);
        letter-spacing: 0;
      }

      /* the seal: the lineup's stamp, miniature — a vertical hanko */
      /* the vertical stamp, in the door's own unit: it is a piece of the
         poster's composition, not a fixed badge stuck on top of it, so it
         shrinks with everything else rather than growing into the frame */
      .is-towers .cf-mg-seal {
        top: calc(8 * var(--gu, 1px));
        right: calc(-34 * var(--gu, 1px));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: calc(34 * var(--gu, 1px));
        height: calc(58 * var(--gu, 1px));
        writing-mode: vertical-rl;
        font-family: var(--cf-display);
        font-weight: 400;
        font-size: calc(19 * var(--gu, 1px));
        letter-spacing: 0.14em;
        text-indent: 0;
        text-transform: none;
        border-radius: calc(3 * var(--gu, 1px));
      }

      .is-towers .cf-end-k {
        font-weight: 400;
        font-size: min(18vh, 19vw);
        letter-spacing: 0;
      }

      /* ---- the cutting room ------------------------------------------ *
         The dive itself is the app's own template (.dive/.dd, app.css);
         this wrapper just seats it on the app's page ground below the
         film, and the joins strip is the one film-only element. */
      .cf-notes {
        background: var(--bg-page);
        border-top: 1px solid var(--line);
        padding: 10px clamp(20px, 5vw, 60px) 80px;
      }

      .cf-notes .dive {
        max-width: 1080px;
        margin: 0 auto;
      }

      .cf-notes-link {
        max-width: 1080px;
        margin: 0 auto;
        padding: 14px 0 0;
      }

      .cf-link {
        color: var(--ink);
        text-decoration: none;
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .cf-link:hover {
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      .dd-joins {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .dd-joins button {
        appearance: none;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        border: 1px solid var(--line);
        background: transparent;
        color: var(--ink);
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        padding: 8px 13px;
        border-radius: 10px;
        cursor: pointer;
        transition:
          transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
          border-color 180ms ease;
      }

      .dd-joins button:hover {
        transform: translateY(-2px);
        border-color: var(--ember);
      }

      .dd-joins button i {
        font-style: normal;
        font-size: 10px;
        font-weight: 500;
        color: color-mix(in srgb, var(--ink) 60%, var(--bg-page));
      }
    </style>
  </template>
}
