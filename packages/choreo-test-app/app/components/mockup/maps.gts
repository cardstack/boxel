import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion } from 'glimmer-motion';

/**
 * A fake Maps screen for the phone mockup demos. No images, no network,
 * nothing outside the framework: the city is four rotated divs, a park and a
 * bay, and the only moving parts are the ones the screen's own taps produce.
 *
 * Sized for exactly 390 x 844 CSS px (the mockup's screen box). The whole
 * screen is one <Choreo> region, because a tap on a pin is a single render
 * pass with two halves that have to be read together: the old sheet card
 * leaves and the new one arrives in the same seat. Scored as a changeset
 * (removed fades, inserted fades up from below, the newly selected pin pops)
 * rather than left to CSS transitions that cannot agree on ordering.
 *
 * A region compiles no score on its very first render — there is no previous
 * pass to diff against — so the opening frame is simply the map, at rest.
 */

interface Place {
  category: string;
  distance: string;
  glyph: string;
  id: string;
  name: string;
}

interface Pin {
  glyph: string;
  id: string;
  selected: boolean;
}

type Mode = 'map' | 'satellite' | 'transit';

const PLACES: Place[] = [
  {
    category: 'Coffee shop',
    distance: '0.3 mi · 6 min walk',
    glyph: 'C',
    id: 'roast',
    name: 'Ferry Building Roast',
  },
  {
    category: 'Park',
    distance: '0.6 mi · 12 min walk',
    glyph: 'P',
    id: 'green',
    name: 'Alder Street Green',
  },
  {
    category: 'Transit station',
    distance: '0.9 mi · 4 min ride',
    glyph: 'T',
    id: 'quay',
    name: 'Quayside Station',
  },
  {
    category: 'Museum',
    distance: '1.2 mi · 8 min drive',
    glyph: 'M',
    id: 'harbor',
    name: 'Harbor Museum',
  },
];

export class MapsApp extends Component {
  /**
   * Which tap produced this pass. The pin pop is scored only when the
   * selection is what changed — switching Map ⇄ Transit ⇄ Satellite is a
   * repaint, and a pin that jumps every time the treatment changes reads as
   * a glitch rather than as an answer to the tap.
   */
  @tracked lastTap: 'mode' | 'pin' = 'mode';
  @tracked mode: Mode = 'map';
  @tracked selectedId = 'roast';

  get pins(): Pin[] {
    return PLACES.map((place) => ({
      glyph: place.glyph,
      id: place.id,
      selected: place.id === this.selectedId,
    }));
  }

  get selectedPlace(): Place {
    return PLACES.find((place) => place.id === this.selectedId) ?? PLACES[0]!;
  }

  /**
   * The card's Choreo identity carries the place in it, so a swap is a
   * genuine remove + insert. A stable id would make the arriving card claim
   * the leaving one as its counterpart — kept, not inserted — and the
   * crossfade below would have nothing to name.
   */
  get sheetId(): string {
    return `sheet-${this.selectedId}`;
  }

  get pinTapped(): boolean {
    return this.lastTap === 'pin';
  }

  get groundClass(): string {
    return `maps-ground maps-ground-${this.mode}`;
  }

  select = (id: string) => {
    if (id === this.selectedId) {
      return;
    }
    this.lastTap = 'pin';
    this.selectedId = id;
  };

  setMode = (mode: Mode) => {
    this.lastTap = 'mode';
    this.mode = mode;
  };

  isMode = (mode: Mode): boolean => {
    return this.mode === mode;
  };

  <template>
    <div class="maps-app">
      <Choreo class="maps-stage" as |c|>
        {{! the city: a gradient ground, a bay, a park block and four road
            strips. Every one of them is a div with a rotation on it. }}
        <div class={{this.groundClass}}>
          <div class="maps-water"></div>
          <div class="maps-park"></div>
          <div class="maps-road maps-road-a"></div>
          <div class="maps-road maps-road-b"></div>
          <div class="maps-road maps-road-c"></div>
          <div class="maps-road maps-road-d"></div>
          <div class="maps-block maps-block-a"></div>
          <div class="maps-block maps-block-b"></div>
          <div class="maps-block maps-block-c"></div>
        </div>

        <div class="maps-statusbar">
          <span class="maps-clock">9:41</span>
          <span class="maps-status-icons">
            <span class="maps-signal">
              <span class="maps-bar maps-bar-1"></span>
              <span class="maps-bar maps-bar-2"></span>
              <span class="maps-bar maps-bar-3"></span>
              <span class="maps-bar maps-bar-4"></span>
            </span>
            <span class="maps-battery"><span
                class="maps-battery-fill"
              ></span></span>
          </span>
        </div>

        <div class="maps-search">
          <span class="maps-search-glass"></span>
          <span class="maps-search-text">Search Maps</span>
        </div>

        <div class="maps-segmented">
          <button
            type="button"
            class="maps-seg {{if (this.isMode 'map') 'maps-seg-on'}}"
            {{on "click" (fn this.setMode "map")}}
          >Map</button>
          <button
            type="button"
            class="maps-seg {{if (this.isMode 'transit') 'maps-seg-on'}}"
            {{on "click" (fn this.setMode "transit")}}
          >Transit</button>
          <button
            type="button"
            class="maps-seg {{if (this.isMode 'satellite') 'maps-seg-on'}}"
            {{on "click" (fn this.setMode "satellite")}}
          >Satellite</button>
        </div>

        {{#each this.pins key="id" as |pin|}}
          <button
            type="button"
            class="maps-pin maps-pin-{{pin.id}}
              {{if pin.selected 'maps-pin-on'}}"
            {{motion id=pin.id role="pin"}}
            {{on "click" (fn this.select pin.id)}}
          >
            <span class="maps-pin-head">{{pin.glyph}}</span>
            <span class="maps-pin-stem"></span>
          </button>
        {{/each}}

        <div class="maps-sheet">
          <div class="maps-sheet-grip"></div>
          {{! keyed on the place, so choosing another one destroys this card
              and builds the next: one pass, one leaver, one arrival. }}
          {{#each (array this.selectedPlace) key="id" as |place|}}
            <div
              class="maps-sheet-card"
              {{motion id=this.sheetId role="sheet"}}
            >
              <div class="maps-sheet-name">{{place.name}}</div>
              <div class="maps-sheet-category">{{place.category}}</div>
              <div class="maps-sheet-distance">{{place.distance}}</div>
              <button type="button" class="maps-directions">
                <span class="maps-directions-arrow"></span>
                Directions
              </button>
            </div>
          {{/each}}
        </div>

        <div class="maps-home-indicator"></div>

        {{! One pass, three things at once: the outgoing card fades where it
            stands (Choreo holds a leaver on screen for exactly as long as a
            step names it), the incoming one rises the last 14px into the
            same seat, and the pin that was tapped pops. }}
        <c.Parallel>
          <c.Tween
            @of={{c.removed "sheet"}}
            @opacity={{array 1 0}}
            @duration={{0.16}}
          />
          <c.Tween
            @of={{c.inserted "sheet"}}
            @opacity={{array 0 1}}
            @y={{array 14 0}}
            @duration={{0.3}}
          />
          {{#if this.pinTapped}}
            <c.Tween
              @of={{c.id this.selectedId}}
              @scale={{array 1 1.25}}
              @duration={{0.32}}
              @ease="easeOut"
            />
          {{/if}}
        </c.Parallel>
      </Choreo>
    </div>

    <style>
      .maps-app {
        position: absolute;
        inset: 0;
        overflow: hidden;
        width: 390px;
        height: 844px;
        background: hsl(210 30% 10%);
        color: hsl(210 20% 96%);
        font-family:
          -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue",
          system-ui, sans-serif;
        user-select: none;
        -webkit-font-smoothing: antialiased;
      }

      .maps-stage {
        position: absolute;
        inset: 0;
      }

      /* ── the city ─────────────────────────────────────────────── */

      .maps-ground {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background:
          radial-gradient(
            120% 70% at 50% 10%,
            hsl(210 26% 26%) 0%,
            hsl(210 28% 19%) 55%,
            hsl(210 30% 14%) 100%
          ),
          hsl(210 30% 14%);
        transition: background 320ms ease;
      }

      .maps-water {
        position: absolute;
        left: -80px;
        top: 505px;
        width: 330px;
        height: 380px;
        border-radius: 46px;
        transform: rotate(-9deg);
        background: hsl(205 62% 30%);
        transition: background 320ms ease;
      }

      .maps-park {
        position: absolute;
        left: 208px;
        top: 196px;
        width: 176px;
        height: 138px;
        border-radius: 20px;
        transform: rotate(3deg);
        background: hsl(146 34% 30%);
        transition: background 320ms ease;
      }

      .maps-road {
        position: absolute;
        border-radius: 3px;
        background: hsl(210 16% 42%);
        transition: background 320ms ease;
      }

      .maps-road-a {
        left: -50px;
        top: 342px;
        width: 500px;
        height: 26px;
        transform: rotate(-6deg);
      }

      .maps-road-b {
        left: 118px;
        top: -60px;
        width: 22px;
        height: 980px;
        transform: rotate(9deg);
      }

      .maps-road-c {
        left: -70px;
        top: 545px;
        width: 540px;
        height: 16px;
        transform: rotate(22deg);
      }

      .maps-road-d {
        left: 268px;
        top: -80px;
        width: 15px;
        height: 940px;
        transform: rotate(-13deg);
      }

      .maps-block {
        position: absolute;
        border-radius: 6px;
        background: hsl(210 18% 24%);
        transition: background 320ms ease;
      }

      .maps-block-a {
        left: 24px;
        top: 210px;
        width: 74px;
        height: 92px;
        transform: rotate(9deg);
      }

      .maps-block-b {
        left: 160px;
        top: 430px;
        width: 96px;
        height: 68px;
        transform: rotate(-6deg);
      }

      .maps-block-c {
        left: 292px;
        top: 452px;
        width: 84px;
        height: 104px;
        transform: rotate(-13deg);
      }

      /* Transit: the ground drains of colour and the roads come forward as
         lines, the way a transit diagram reads. */
      .maps-ground-transit {
        background:
          radial-gradient(
            120% 70% at 50% 10%,
            hsl(210 12% 27%) 0%,
            hsl(210 12% 20%) 55%,
            hsl(210 14% 15%) 100%
          ),
          hsl(210 14% 15%);
      }

      .maps-ground-transit .maps-water {
        background: hsl(205 24% 27%);
      }

      .maps-ground-transit .maps-park {
        background: hsl(146 12% 27%);
      }

      .maps-ground-transit .maps-road {
        background: hsl(196 76% 52%);
      }

      .maps-ground-transit .maps-block {
        background: hsl(210 8% 23%);
      }

      /* Satellite: no cartography left, just ground and water. */
      .maps-ground-satellite {
        background:
          radial-gradient(
            120% 70% at 50% 10%,
            hsl(78 22% 26%) 0%,
            hsl(60 18% 18%) 55%,
            hsl(40 20% 12%) 100%
          ),
          hsl(40 20% 12%);
      }

      .maps-ground-satellite .maps-water {
        background: hsl(212 58% 16%);
      }

      .maps-ground-satellite .maps-park {
        background: hsl(104 32% 22%);
      }

      .maps-ground-satellite .maps-road {
        background: hsl(38 14% 38%);
      }

      .maps-ground-satellite .maps-block {
        background: hsl(34 16% 27%);
      }

      /* ── chrome ───────────────────────────────────────────────── */

      .maps-statusbar {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 54px;
        padding: 14px 30px 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .maps-clock {
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.2px;
        text-shadow: 0 1px 3px hsl(210 40% 8% / 0.6);
      }

      .maps-status-icons {
        display: flex;
        align-items: center;
        gap: 7px;
      }

      .maps-signal {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 11px;
      }

      .maps-bar {
        width: 3px;
        border-radius: 1px;
        background: hsl(210 20% 96%);
      }

      .maps-bar-1 {
        height: 4px;
      }

      .maps-bar-2 {
        height: 6px;
      }

      .maps-bar-3 {
        height: 9px;
      }

      .maps-bar-4 {
        height: 11px;
        opacity: 0.4;
      }

      .maps-battery {
        width: 24px;
        height: 12px;
        border: 1.5px solid hsl(210 20% 96% / 0.6);
        border-radius: 3px;
        padding: 1.5px;
        display: block;
      }

      .maps-battery-fill {
        display: block;
        width: 68%;
        height: 100%;
        border-radius: 1px;
        background: hsl(210 20% 96%);
      }

      .maps-search {
        position: absolute;
        left: 16px;
        right: 16px;
        top: 62px;
        height: 42px;
        border-radius: 13px;
        background: hsl(210 26% 16% / 0.86);
        border: 1px solid hsl(210 20% 96% / 0.1);
        box-shadow: 0 8px 22px hsl(210 45% 6% / 0.4);
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 13px;
      }

      .maps-search-glass {
        width: 11px;
        height: 11px;
        border: 1.8px solid hsl(210 12% 62%);
        border-radius: 50%;
        position: relative;
        flex: 0 0 auto;
      }

      .maps-search-glass::after {
        content: "";
        position: absolute;
        right: -4px;
        bottom: -3px;
        width: 6px;
        height: 1.8px;
        border-radius: 1px;
        background: hsl(210 12% 62%);
        transform: rotate(45deg);
      }

      .maps-search-text {
        font-size: 15px;
        color: hsl(210 12% 62%);
      }

      .maps-segmented {
        position: absolute;
        left: 16px;
        right: 16px;
        top: 116px;
        display: flex;
        gap: 3px;
        padding: 3px;
        border-radius: 11px;
        background: hsl(210 28% 14% / 0.88);
        border: 1px solid hsl(210 20% 96% / 0.08);
        box-shadow: 0 8px 22px hsl(210 45% 6% / 0.35);
      }

      .maps-seg {
        flex: 1 1 0;
        appearance: none;
        border: 0;
        margin: 0;
        padding: 7px 0;
        border-radius: 8px;
        background: transparent;
        color: hsl(210 12% 70%);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background-color 200ms ease,
          color 200ms ease;
      }

      .maps-seg-on {
        background: hsl(210 88% 54%);
        color: hsl(210 40% 99%);
      }

      /* ── pins ─────────────────────────────────────────────────── */

      .maps-pin {
        position: absolute;
        appearance: none;
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        font: inherit;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        z-index: 2;
      }

      .maps-pin-roast {
        left: 66px;
        top: 296px;
      }

      .maps-pin-green {
        left: 262px;
        top: 232px;
      }

      .maps-pin-quay {
        left: 146px;
        top: 424px;
      }

      .maps-pin-harbor {
        left: 296px;
        top: 386px;
      }

      .maps-pin-head {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: hsl(210 22% 92%);
        color: hsl(210 40% 18%);
        border: 2px solid hsl(210 40% 12% / 0.35);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.2px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 10px hsl(210 45% 6% / 0.45);
        transition:
          width 220ms ease,
          height 220ms ease,
          background-color 220ms ease,
          color 220ms ease,
          font-size 220ms ease;
      }

      .maps-pin-stem {
        width: 2px;
        height: 9px;
        border-radius: 0 0 2px 2px;
        background: hsl(210 22% 92%);
        box-shadow: 0 2px 5px hsl(210 45% 6% / 0.5);
      }

      .maps-pin-on {
        z-index: 3;
      }

      .maps-pin-on .maps-pin-head {
        width: 38px;
        height: 38px;
        font-size: 16px;
        background: hsl(6 82% 56%);
        color: hsl(6 60% 98%);
        border-color: hsl(210 40% 99% / 0.9);
      }

      .maps-pin-on .maps-pin-stem {
        background: hsl(6 82% 56%);
      }

      /* ── bottom sheet ─────────────────────────────────────────── */

      .maps-sheet {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 244px;
        border-radius: 22px 22px 0 0;
        background: hsl(210 30% 12% / 0.95);
        border-top: 1px solid hsl(210 20% 96% / 0.12);
        box-shadow: 0 -12px 34px hsl(210 50% 4% / 0.5);
        z-index: 4;
      }

      .maps-sheet-grip {
        position: absolute;
        left: 50%;
        top: 9px;
        width: 38px;
        height: 5px;
        margin-left: -19px;
        border-radius: 3px;
        background: hsl(210 14% 62% / 0.6);
      }

      /* Absolutely placed so the leaver and the arrival share one seat and
         genuinely cross, rather than the sheet growing to hold both. */
      .maps-sheet-card {
        position: absolute;
        left: 20px;
        right: 20px;
        top: 26px;
      }

      .maps-sheet-name {
        font-size: 20px;
        line-height: 25px;
        font-weight: 700;
        letter-spacing: -0.3px;
      }

      .maps-sheet-category {
        margin-top: 4px;
        font-size: 14px;
        color: hsl(210 14% 68%);
      }

      .maps-sheet-distance {
        margin-top: 2px;
        font-size: 14px;
        color: hsl(210 60% 68%);
      }

      .maps-directions {
        margin-top: 18px;
        width: 100%;
        appearance: none;
        border: 0;
        padding: 13px 0;
        border-radius: 13px;
        background: hsl(210 88% 54%);
        color: hsl(210 40% 99%);
        font: inherit;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .maps-directions-arrow {
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 11px solid hsl(210 40% 99%);
        transform: rotate(38deg);
      }

      .maps-home-indicator {
        position: absolute;
        left: 50%;
        bottom: 8px;
        width: 134px;
        height: 5px;
        margin-left: -67px;
        border-radius: 3px;
        background: hsl(210 15% 82% / 0.8);
        z-index: 5;
      }
    </style>
  </template>
}

export default MapsApp;
