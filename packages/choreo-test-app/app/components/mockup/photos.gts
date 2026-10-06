import { Choreo } from '@cardstack/choreo';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

/**
 * A fake "Photos" screen for the phone mockup. Fills the 390 x 844 screen box
 * the caller already owns; this component only paints the inside.
 *
 * The point is a screen a finger can USE while the phone itself is being
 * animated from the outside — so the grid is real buttons, and opening a
 * thumbnail is a Choreo crossing rather than a cut. Thumbnail and large view
 * carry the SAME `{{motion id=...}}`, so the region pairs them and the small
 * tile flies into the big one; closing plays the same flight backwards.
 *
 * A region does not compile a score on its first render. That is expected:
 * the first pass is the baseline the second pass is measured against.
 *
 * Hue 32 is the Photos app's slot on the mockup home screen's colour wheel.
 */
interface Photo {
  id: string;
  label: string;
  /** 1-12: picks the CSS gradient, so no image ever has to load */
  tone: number;
}

const PHOTOS: Photo[] = [
  { id: 'harbour', label: 'Harbour, 6am', tone: 1 },
  { id: 'kiln', label: 'Kiln room', tone: 2 },
  { id: 'ferry', label: 'Late ferry', tone: 3 },
  { id: 'orchard', label: 'Orchard row', tone: 4 },
  { id: 'stairwell', label: 'Stairwell', tone: 5 },
  { id: 'saltflat', label: 'Salt flat', tone: 6 },
  { id: 'awning', label: 'Awning, noon', tone: 7 },
  { id: 'quarry', label: 'Quarry edge', tone: 8 },
  { id: 'nightbus', label: 'Night bus', tone: 9 },
  { id: 'glasshouse', label: 'Glasshouse', tone: 10 },
  { id: 'dunes', label: 'Dunes', tone: 11 },
  { id: 'lantern', label: 'Lantern', tone: 12 },
];

/** one spring for the whole crossing — heavy enough to read on camera */
const spring = { damping: 26, stiffness: 260 };

interface PhotosAppSignature {
  Element: HTMLDivElement;
}

export class PhotosApp extends Component<PhotosAppSignature> {
  /** id of the photo showing large, or null when the grid is showing */
  @tracked openId: string | null = null;

  get photos(): Photo[] {
    return PHOTOS;
  }

  /** the open photo, or null — a block param so the template narrows it */
  get open(): Photo | null {
    return PHOTOS.find((photo) => photo.id === this.openId) ?? null;
  }

  isOpen = (id: string): boolean => this.openId === id;

  openPhoto = (id: string): void => {
    this.openId = id;
  };

  close = (): void => {
    this.openId = null;
  };

  <template>
    <div class="photos-app" ...attributes>
      <div class="photos-head">
        <h1 class="photos-title">Recents</h1>
        <span class="photos-count">{{this.photos.length}} photos</span>
      </div>

      <Choreo class="photos-stage" as |c|>
        <div class="photos-grid">
          {{#each this.photos key="id" as |photo|}}
            {{#if (this.isOpen photo.id)}}
              {{! the tile the large view is standing in for: an empty well,
                  so the grid keeps its shape while the shot is away }}
              <span class="photos-well"></span>
            {{else}}
              <button
                type="button"
                class="photos-shot photos-tone-{{photo.tone}}"
                aria-label={{photo.label}}
                {{motion id=photo.id role="shot"}}
                {{on "click" (fn this.openPhoto photo.id)}}
              ></button>
            {{/if}}
          {{/each}}
        </div>

        {{#let this.open as |open|}}
          {{#if open}}
            <div class="photos-viewer">
              <div class="photos-viewer-bar">
                <span class="photos-viewer-label">{{open.label}}</span>
                <button
                  type="button"
                  class="photos-close"
                  aria-label="Close"
                  {{on "click" this.close}}
                >×</button>
              </div>
              {{! SAME id as the tile, so the region reads one identity
                  moving rather than one leaving and another arriving }}
              <div
                class="photos-large photos-tone-{{open.tone}}"
                {{motion id=open.id role="shot"}}
              ></div>
            </div>
          {{/if}}
        {{/let}}

        {{! @size="scale" is load-bearing, not decoration.

            The default layout mode writes real width/height for the
            flight — and the large view is CENTRED by the viewer's flex
            box, so shrinking it to the tile's size moves its own layout
            origin down by half the difference. FLIP had already measured
            the translate against the full-size position, so the flight
            began 116px below the thumbnail (76 painted px on a 1:1 2D
            phone) and closed with the same jump mirrored. The size
            animation was feeding back into the very layout the delta was
            measured from.

            Under 'scale' the box never changes size, so nothing reflows
            and the delta stays true. Both ends are aspect-ratio 1, so the
            per-axis scale is uniform and nothing stretches. }}
        <c.Move @of={{c.moved "shot"}} @size="scale" @spring={{spring}} />
      </Choreo>

      <div class="photos-home"></div>
    </div>

    <style>
      .photos-app {
        position: absolute;
        inset: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: hsl(32 24% 7%);
        color: hsl(32 20% 92%);
        font-family:
          -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        user-select: none;
        -webkit-user-select: none;
      }

      .photos-head {
        flex: none;
        padding: 44px 18px 12px;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        background: hsl(32 26% 9%);
        border-bottom: 1px solid hsl(32 20% 15%);
      }

      .photos-title {
        margin: 0;
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: hsl(32 30% 95%);
      }

      .photos-count {
        font-size: 12px;
        color: hsl(32 14% 55%);
      }

      .photos-stage {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      .photos-grid {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 3px;
        padding: 3px;
        align-content: start;
      }

      .photos-well {
        display: block;
        aspect-ratio: 1;
        border-radius: 2px;
        background: hsl(32 20% 12%);
      }

      .photos-shot {
        display: block;
        width: 100%;
        aspect-ratio: 1;
        padding: 0;
        border: 0;
        border-radius: 2px;
        cursor: pointer;
      }

      .photos-viewer {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 14px;
        padding: 16px;
        background: hsl(32 26% 6%);
      }

      .photos-viewer-bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
      }

      .photos-viewer-label {
        font-size: 13px;
        color: hsl(32 18% 72%);
      }

      .photos-close {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 15px;
        background: hsl(32 22% 18%);
        color: hsl(32 24% 90%);
        font-size: 19px;
        line-height: 1;
        cursor: pointer;
      }

      .photos-large {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 10px;
      }

      .photos-home {
        flex: none;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: hsl(32 26% 9%);
      }

      .photos-home::after {
        content: "";
        width: 134px;
        height: 5px;
        border-radius: 3px;
        background: hsl(32 12% 76%);
      }

      .photos-tone-1 {
        background: linear-gradient(150deg, hsl(32 70% 52%), hsl(14 55% 26%));
      }

      .photos-tone-2 {
        background: linear-gradient(200deg, hsl(46 78% 58%), hsl(24 62% 30%));
      }

      .photos-tone-3 {
        background: linear-gradient(120deg, hsl(200 45% 44%), hsl(32 50% 26%));
      }

      .photos-tone-4 {
        background: linear-gradient(165deg, hsl(88 40% 44%), hsl(38 58% 28%));
      }

      .photos-tone-5 {
        background: linear-gradient(210deg, hsl(28 30% 62%), hsl(28 26% 22%));
      }

      .photos-tone-6 {
        background: linear-gradient(140deg, hsl(40 26% 82%), hsl(34 40% 40%));
      }

      .photos-tone-7 {
        background: linear-gradient(185deg, hsl(10 68% 54%), hsl(36 60% 32%));
      }

      .photos-tone-8 {
        background: linear-gradient(130deg, hsl(52 42% 56%), hsl(20 40% 24%));
      }

      .photos-tone-9 {
        background: linear-gradient(225deg, hsl(258 34% 40%), hsl(32 44% 24%));
      }

      .photos-tone-10 {
        background: linear-gradient(160deg, hsl(160 34% 48%), hsl(40 52% 30%));
      }

      .photos-tone-11 {
        background: linear-gradient(195deg, hsl(36 62% 66%), hsl(26 48% 34%));
      }

      .photos-tone-12 {
        background: linear-gradient(115deg, hsl(20 74% 58%), hsl(44 46% 28%));
      }
    </style>
  </template>
}

export default PhotosApp;
