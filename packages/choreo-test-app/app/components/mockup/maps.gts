import { Choreo } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

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
          {{! the transit network: three lines, each a pair of rotated
              strokes that meet at a bend, plus a white dot wherever two
              of them cross. Painted at all times, revealed only in
              transit mode. }}
          {{! ROUTES RUN ON ROADS. Each route shares its road's exact
              geometry — same origin, same length, same rotation, inset to
              sit centred in the carriageway — so the network reads as
              buses on streets rather than ribbons thrown over a map. The
              buses are markers pinned along those same lines. }}
          <div class="maps-transit">
            <div class="maps-route maps-route-a"></div>
            <div class="maps-route maps-route-b"></div>
            <div class="maps-route maps-route-c"></div>
            <div class="maps-bus maps-bus-a1"></div>
            <div class="maps-bus maps-bus-a2"></div>
            <div class="maps-bus maps-bus-b1"></div>
            <div class="maps-bus maps-bus-c1"></div>
            <div class="maps-stop maps-stop-a"></div>
            <div class="maps-stop maps-stop-b"></div>
            <div class="maps-stop maps-stop-c"></div>
          </div>
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

      /* Transit: the base map drains to near-neutral — water, park, roads and
         blocks all within a few points of grey — so the network is the only
         saturated thing on the screen. */
      .maps-ground-transit {
        background:
          radial-gradient(
            120% 70% at 50% 10%,
            hsl(214 8% 25%) 0%,
            hsl(214 9% 18%) 55%,
            hsl(214 10% 14%) 100%
          ),
          hsl(214 10% 14%);
      }

      .maps-ground-transit .maps-water {
        background: hsl(206 12% 23%);
      }

      .maps-ground-transit .maps-park {
        background: hsl(150 9% 23%);
      }

      .maps-ground-transit .maps-road {
        background: hsl(214 7% 31%);
      }

      .maps-ground-transit .maps-block {
        background: hsl(214 7% 20%);
      }

      /* ── the transit network ──────────────────────────────────── */

      /* Three lines, each a pair of rotated strokes meeting at a bend, all
         the same 6px weight with rounded caps. Rotated about their left
         edge, so a segment's stated left/top is the point it starts from. */
      .maps-transit {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
        transition: opacity 320ms ease;
      }

      .maps-ground-transit .maps-transit {
        opacity: 1;
      }

      /* blue: (10,236) → (176,300) → (330,292) */

      /* amber: (56,176) → (176,300) → (250,520) */

      /* green: (350,180) → (196,380) → (40,470) */

      .maps-stop {
        position: absolute;
        box-sizing: border-box;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: hsl(0 0% 100%);
        box-shadow: 0 1px 3px hsl(214 40% 6% / 0.55);
      }

      /* blue × amber, the one interchange, so it carries a wider ring */
      .maps-stop-a {
        left: 166px;
        top: 290px;
        width: 20px;
        height: 20px;
        border: 4px solid hsl(214 68% 55%);
      }

      /* blue × green */
      .maps-stop-b {
        left: 253px;
        top: 288px;
        border: 3.5px solid hsl(158 44% 44%);
      }

      /* amber × green */
      .maps-stop-c {
        left: 193px;
        top: 366px;
        border: 3.5px solid hsl(36 74% 55%);
      }

      /* Satellite: no cartography left, just ground and water — muted greens
         and browns, with two soft blooms standing in for terrain mottle. */
      .maps-ground-satellite {
        background:
          radial-gradient(
            70% 48% at 22% 34%,
            hsl(96 16% 24% / 0.5) 0%,
            hsl(96 16% 24% / 0) 70%
          ),
          radial-gradient(
            60% 42% at 78% 64%,
            hsl(44 14% 17% / 0.55) 0%,
            hsl(44 14% 17% / 0) 72%
          ),
          radial-gradient(
            120% 70% at 50% 10%,
            hsl(92 14% 21%) 0%,
            hsl(74 13% 16%) 55%,
            hsl(48 14% 12%) 100%
          ),
          hsl(48 14% 12%);
      }

      .maps-ground-satellite .maps-water {
        background: hsl(198 26% 17%);
      }

      .maps-ground-satellite .maps-park {
        background: hsl(108 20% 20%);
      }

      .maps-ground-satellite .maps-road {
        background: hsl(40 8% 30%);
      }

      .maps-ground-satellite .maps-block {
        background: hsl(36 10% 24%);
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

      /* THE ROUTES. Geometry copied from the roads above, not invented:
         a route is the road's own rect, thinned and centred. */
      .maps-route {
        position: absolute;
        border-radius: 3px;
        opacity: 0;
        transition: opacity 260ms ease;
      }
      .maps-route-a {
        left: -50px;
        top: 351px;
        width: 500px;
        height: 7px;
        transform: rotate(-6deg);
        background: hsl(214 72% 58%);
      }
      .maps-route-b {
        left: 126px;
        top: -60px;
        width: 7px;
        height: 980px;
        transform: rotate(9deg);
        background: hsl(36 78% 56%);
      }
      .maps-route-c {
        left: -70px;
        top: 550px;
        width: 540px;
        height: 6px;
        transform: rotate(22deg);
        background: hsl(158 48% 46%);
      }
      /* the buses: squat rounded markers sitting ON the line, turned to
         match the street they are running down */
      .maps-bus {
        position: absolute;
        width: 17px;
        height: 11px;
        border-radius: 3px;
        background: #f7f9fc;
        box-shadow: 0 1px 3px #00000073;
        opacity: 0;
        transition: opacity 260ms ease;
      }
      .maps-bus::after {
        content: "";
        position: absolute;
        inset: 2px 3px;
        border-radius: 1px;
        background: currentColor;
        opacity: 0.5;
      }
      .maps-bus-a1 {
        left: 96px;
        top: 336px;
        transform: rotate(-6deg);
        color: hsl(214 72% 45%);
      }
      .maps-bus-a2 {
        left: 292px;
        top: 316px;
        transform: rotate(-6deg);
        color: hsl(214 72% 45%);
      }
      .maps-bus-b1 {
        left: 152px;
        top: 226px;
        transform: rotate(9deg);
        color: hsl(36 78% 42%);
      }
      .maps-bus-c1 {
        left: 214px;
        top: 662px;
        transform: rotate(22deg);
        color: hsl(158 48% 34%);
      }
      /* only in transit mode — the network is the mode, not decoration */
      .maps-ground-transit .maps-route,
      .maps-ground-transit .maps-bus {
        opacity: 1;
      }
    </style>
  </template>
}

export default MapsApp;
