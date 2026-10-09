import Component from '@glimmer/component';
import { motion, scrollProgress, transformValue } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { tuneNumber } from '../lib/tuning';

export class Parallax extends Component {
  scroll = scrollProgress();

  progress = () => this.scroll.scrollYProgress.get();

  back = {
    scale: transformValue(
      () =>
        1 + this.progress() * tuneNumber('parallax', 0.28, 'Background zoom'),
    ),
    y: transformValue(
      () => this.progress() * tuneNumber('parallax', -220, 'Background travel'),
    ),
  };
  mid = {
    rotate: transformValue(
      () => this.progress() * tuneNumber('parallax', -12, 'Plate rotation'),
    ),
    x: transformValue(
      () =>
        this.progress() * tuneNumber('parallax', 56, 'Plate horizontal travel'),
    ),
    y: transformValue(
      () =>
        this.progress() * tuneNumber('parallax', -150, 'Plate vertical travel'),
    ),
  };
  word = {
    y: transformValue(
      () => this.progress() * tuneNumber('parallax', -110, 'Word travel'),
    ),
  };
  type = {
    y: transformValue(
      () => this.progress() * tuneNumber('parallax', -48, 'Heading travel'),
    ),
  };
  card = {
    y: transformValue(
      () => this.progress() * tuneNumber('parallax', 20, 'Card travel'),
    ),
  };

  <template>
    <div class='ex'>
      <div class='scroll-well' {{this.scroll.container}}>
        <div class='para-layer para-a' {{motion style=this.back}}></div>
        <div class='para-layer para-b' {{motion style=this.mid}}></div>
        <p class='para-word' {{motion style=this.word}}>DEPTH</p>
        <div class='scroll-pad para-pad'>
          <p class='para-kicker' {{motion style=this.type}}>Issue 07</p>
          <h3 class='para-title' {{motion style=this.type}}>Depth from a single
            scroll value.</h3>
          <div class='para-card' {{motion style=this.card}}>
            <div class='story'>
              <small>Three offsets. One progress.</small>
              <p>The wash leaves first. The plate holds. The type barely
                breathes.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <style scoped>
      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding matters as much as the inline: on a stage tall
           enough to fill the platter, content flush against the top and bottom
           of the recess reads as overflowed rather than placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .scroll-well {
        position: absolute;
        inset: 18px;
        /* the parallax layers translate sideways; only the vertical scroll is the
           demo, so the horizontal one is locked rather than left to wander */
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior-x: none;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--bg-well);
        container-type: size;
      }

      .scroll-pad {
        min-height: 640px;
        padding: 88px 18px 36px;
      }

      .para-pad {
        box-sizing: border-box;
        min-height: calc(100% + 300px);
        padding: 56cqh 22px 28px;
      }

      .para-kicker {
        position: relative;
        z-index: 1;
        margin: 0 0 8px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--copper-ink);
      }

      .para-title {
        position: relative;
        z-index: 1;
        margin: 0 0 28px;
        max-width: 12ch;
        font-family: var(--font-display);
        font-size: clamp(2rem, 7vw, 3.2rem);
        letter-spacing: -0.05em;
        line-height: 0.9;
      }

      .story {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 10px;
      }

      .story small {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ember-hot);
      }

      .story p {
        margin: 0;
        color: var(--ink-dim);
      }

      .para-layer {
        position: absolute;
        border-radius: 28px;
        pointer-events: none;
      }

      .para-a {
        width: 280px;
        height: 280px;
        left: -8%;
        top: 38cqh;
        background: radial-gradient(
          circle at 40% 40%,
          #ff6a3a,
          transparent 68%
        );
        opacity: 0.85;
        filter: blur(6px);
      }

      .para-b {
        width: 180px;
        height: 240px;
        right: -4%;
        top: 52cqh;
        background: linear-gradient(160deg, #e4a35a, #7a1408);
        opacity: 0.7;
        border-radius: 22px;
      }

      .para-word {
        position: absolute;
        left: 6%;
        top: 46cqh;
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(4.5rem, 18vw, 8rem);
        font-weight: 800;
        letter-spacing: -0.07em;
        line-height: 0.8;
        color: transparent;
        background: linear-gradient(
          180deg,
          rgba(var(--ink-rgb), 0.18),
          transparent
        );
        background-clip: text;
        -webkit-background-clip: text;
        pointer-events: none;
      }

      .para-card {
        position: relative;
        z-index: 1;
        padding: 18px;
        border-radius: 18px;
        background: rgba(22, 19, 17, 0.9);
        border: 1px solid var(--line-strong);
        backdrop-filter: blur(10px);
      }

      @container (max-width: 420px) {
        .para-title {
          font-size: 1.7rem;
        }

        .para-a {
          width: 160px;
          height: 160px;
        }

        .para-b {
          width: 110px;
          height: 140px;
        }

        .para-word {
          font-size: 3.2rem;
        }
      }

      .choreo-site:not([data-theme='light']) .scroll-well {
        background: #221e1a;
      }
    </style>
  </template>
}

export class ParallaxDemo extends GalleryDemo {
  static stage = Parallax;
}
