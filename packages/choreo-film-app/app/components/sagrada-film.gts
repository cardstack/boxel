import { Film, IframePicture } from '@cardstack/choreo/film';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { SagradaScore } from 'choreo-film-app/components/films/sagrada-score';
import { assetURL } from 'choreo-film-app/lib/assets';
import {
  BUILD,
  CITY_GLASS,
  CLOCK,
  GRADES,
  LOOK_FX,
  LUT_AMOUNT,
  seat,
  T_TODAY,
  VO_GAIN,
} from 'choreo-film-app/lib/films/sagrada';
import { firstFrame } from 'choreo-film-app/lib/first-frame';
import { tuneNumber } from 'choreo-film-app/lib/tuning';

// Declare the film variables before asynchronous picture loading.
function rigMid() {
  return tuneNumber('sagrada', 6.6, 'Camera rig height (units)', 1, 14, 0.001);
}
rigMid();
function lutAmount() {
  return tuneNumber('sagrada', LUT_AMOUNT, 'Color grade strength', 0, 1, 0.01);
}
lutAmount();

export default class SagradaFilm extends Component<{
  Args: {
    embed?: boolean;
    /** the picture's page, as markup: see lib/picture-document */
    picture?: string;
  };
}> {
  grades = GRADES;
  lookFx = LOOK_FX;
  voGain = VO_GAIN;
  clock = CLOCK;
  seat = seat;

  /* the demo page mounts this route in an iframe with ?embed; the film
     engine reads the query itself, but the wall plate below the picture
     is this component's own and has to be told */
  get embed(): boolean {
    return (
      (this.args.embed ?? false) || /[?&]embed\b/.test(window.location.search)
    );
  }

  get assets(): string {
    return assetURL('sagrada/');
  }

  get src(): string {
    return assetURL('sagrada-model.html');
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

  <template>
    <Film
      @name="sagrada"
      @build={{BUILD}}
      @menuTitle="SAGRADA FAMÍLIA"
      @menuSub="A construction study · chapters"
      @voGain={{this.voGain}}
      @clock={{this.clock}}
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
          @title="Sagrada Família"
          @standing={{T_TODAY}}
          @seat={{this.seat}}
          @rigMid={{(rigMid)}}
          @cityGlass={{CITY_GLASS}}
          @lutAmount={{(lutAmount)}}
          @grades={{this.grades}}
          @lookFx={{this.lookFx}}
        />
      </:picture>
      {{! FRONT MATTER. Keep the title package clear of oversized years;
      the date remains in the spine and navigation. }}
      <:gate as |f|>
        {{! the door stands on the picture once it is seated: tell the page
        that framed this film, which is holding its poster up until then }}
        {{#if f.ready}}<span hidden {{firstFrame}}></span>{{/if}}
        {{! the spine: the film's name written down the edge }}
        <span class="cf-gate-vert" aria-hidden="true">Temple Expiatori de la
          Sagrada Família — 1882</span>
        <div class="cf-gate-in cf-matter">
          <i class="cf-mg-rule" aria-hidden="true"></i>
          <p class="cf-gate-t cf-mg-mark">SAGRADA FAMÍLIA</p>
          <p class="cf-gate-s cf-mg-sub">A construction study ·
            {{f.runtime}}</p>
          <span class="cf-mg-seal" aria-hidden="true">Obra</span>
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
        {{! the index: five chapters in a strip along the foot }}
        <p class="cf-gate-index" aria-hidden="true">
          <span>I — THE SITE</span>
          <span>II — SILENCE</span>
          <span>III — THE LONG BUILD</span>
          <span>IV — THE TOWERS</span>
          <span>V — THE PLAN</span>
        </p>
      </:gate>

      {{! BACK MATTER — the same package in reverse order of importance }}
      <:end as |f|>
        <i class="cf-mg-rule" aria-hidden="true"></i>
        <p class="cf-end-t cf-mg-mark">SAGRADA FAMÍLIA</p>
        <p class="cf-end-s cf-mg-sub">A construction study</p>
        <span class="cf-mg-seal" aria-hidden="true">Obra</span>
        <p class="cf-mg-credits">
          <span>Model built from the published plans</span>
          <span>Record · sagradafamilia.org</span>
          <span>Cut by a score · Choreo</span>
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
        <SagradaScore @f={{f}} />
      </:default>
    </Film>

    {{! THE IDENTITY. The construct sets the film in the basilica's own
    2026 centenary voice by default — heavy grotesque capitals in flat
    colour on stone paper, one red — so all this film adds is the faces
    themselves. The wall plate BELOW the picture (and nothing above it):
    a film that arrives with its commentary attached is asking to be read
    rather than watched, so the dive waits under the frame where Towers
    keeps its own, and the only thing over the picture is the mark. }}
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap");
    </style>
  </template>
}
