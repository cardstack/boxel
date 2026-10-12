import type { TOC } from '@ember/component/template-only';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';

/**
 * THE POSTER TILE — the face a film wears in the gallery.
 *
 * A gallery tile cannot run a film. The grid mounts forty-odd demos at
 * once and the films are the most expensive things in the building, so
 * no tile runs WebGL. What goes there instead is what a cinema puts
 * outside itself — a poster: the picture's own sky, its silhouette, the
 * title package it wears on its own gate, and one door.
 *
 * The picture is a STILL OF THE FILM ITSELF — one frame read back off
 * the picture's own canvas through the port's `snapshot()`, the same
 * call every still join makes, captured headless at a named shot and
 * committed as a webp. Nothing is drawn twice: the poster is the film,
 * graded as the film grades it. Sylva's works the same way.
 *
 * The lower third is the film's OWN gate copy — kicker, wordmark, line —
 * so the card and the door it opens say the same thing in the same
 * order. Colours arrive as custom properties from the caller; the shape
 * is shared, the palette is the film's.
 */
export const FilmTile: TOC<{
  Args: {
    /** the film's gate kicker, e.g. 'A construction study' */
    eyebrow: string;
    /** where the subject sits in the still, as `object-position` — the
     *  card is never 16:9, so the crop has to be told what to keep */
    focus?: string;
    /** what the ring does, for a screen reader */
    label: string;
    /** the gate's one line under the wordmark */
    line: string;
    /** the wordmark */
    name: string;
    /** open the film in theater; without it the ring is drawn but inert */
    open?: () => void;
    /** `--ft-*` custom properties: floor, ink, key, sky, sub */
    palette: string;
    /** a frame of the film, read back through the picture's snapshot() */
    poster: string;
  };
}> = <template>
  <div class='ft-tile' style={{htmlSafe @palette}}>
    <img
      class='ft-art'
      src={{@poster}}
      alt=''
      style={{if @focus (htmlSafe (concat 'object-position:' @focus))}}
    />
    <div class='ft-scrim' aria-hidden='true'></div>
    {{! the door: a disc with a hairline ring, and nothing to read }}
    {{#if @open}}
      <button
        type='button'
        class='ft-play'
        aria-label={{@label}}
        {{on 'click' @open}}
      ></button>
    {{else}}
      <span class='ft-play' aria-hidden='true'></span>
    {{/if}}
    <div class='ft-third' aria-hidden='true'>
      <p class='ft-eyebrow'>{{@eyebrow}}</p>
      <p class='ft-name'>{{@name}}</p>
      <p class='ft-line'>{{@line}}</p>
    </div>
  </div>

  <style scoped>
    .ft-tile {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: var(--ft-sky, #101014);
    }

    /* the still is 16:9 and the card is not: CROP, never letterbox —
       a band of empty sky above a poster reads as a mistake. The frame
       is held slightly above centre, where these two films put their
       subject. */
    .ft-art {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 50% 42%;
    }

    /* the title package needs a floor to stand on, and the ring needs
       the middle held back a little */
    .ft-scrim {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(
          58% 48% at 50% 42%,
          rgba(0, 0, 0, 0) 40%,
          var(--ft-veil, rgba(0, 0, 0, 0.26)) 100%
        ),
        linear-gradient(
          rgba(0, 0, 0, 0) 46%,
          var(--ft-floor, rgba(0, 0, 0, 0.82)) 100%
        );
    }

    .ft-play {
      position: absolute;
      left: 50%;
      top: 42%;
      width: 88px;
      height: 88px;
      padding: 0;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      border: 1px solid var(--ft-rim, rgba(255, 255, 255, 0.6));
      background: var(--ft-disc, rgba(18, 16, 12, 0.42));
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      cursor: pointer;
      transition: transform 200ms ease;
    }

    /* the quiet outer ring — the film's own key colour, half lit */
    .ft-play::before {
      content: '';
      position: absolute;
      inset: -28px;
      border-radius: 50%;
      border: 1px solid var(--ft-ring, rgba(255, 255, 255, 0.24));
    }

    /* the play mark, nudged off centre the way a play triangle must be
       to LOOK centred inside a circle */
    .ft-play::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-42%, -50%);
      border-style: solid;
      border-width: 10px 0 10px 17px;
      border-color: transparent transparent transparent var(--ft-mark, #ffffff);
    }

    .ft-play:hover {
      transform: translate(-50%, -50%) scale(1.06);
    }

    .ft-third {
      position: absolute;
      right: 18px;
      bottom: 14px;
      left: 18px;
    }

    .ft-eyebrow {
      margin: 0 0 5px;
      font:
        500 9px/1 ui-monospace,
        monospace;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: var(--ft-key, #d8a24a);
    }

    .ft-name {
      margin: 0 0 3px;
      font:
        300 26px/1 ui-sans-serif,
        system-ui,
        sans-serif;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: var(--ft-ink, rgba(255, 255, 255, 0.96));
    }

    .ft-line {
      margin: 0;
      font:
        300 13px/1.3 ui-serif,
        Georgia,
        serif;
      color: var(--ft-sub, rgba(255, 255, 255, 0.7));
    }

    /* a small card is a stamp: the ring would cover the poster and the
       wordmark would wrap, so both stand down */
    @container (max-width: 300px) {
      .ft-play {
        width: 62px;
        height: 62px;
      }
      .ft-name {
        font-size: 20px;
        letter-spacing: 0.24em;
      }
    }
  </style>
</template>;
