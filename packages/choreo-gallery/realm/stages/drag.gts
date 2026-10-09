import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { preventSelect } from '../lib/pointer';
import { tuneNumber, tuneObject } from '../lib/tuning';

const dragTransition = {
  bounceDamping: 28,
  bounceStiffness: 560,
  power: 0.12,
  timeConstant: 120,
} as const;

export class DragWell extends Component {
  @tracked held = false;
  @tracked lock = false;
  frame: { current: HTMLElement | null } = { current: null };

  bindFrame = modifier((element: HTMLElement) => {
    this.frame.current = element;
    return () => {
      this.frame.current = null;
    };
  });

  grab = () => {
    this.held = true;
  };

  release = () => {
    this.held = false;
  };

  toggleLock = () => {
    this.lock = !this.lock;
  };

  <template>
    <div class='ex no-select' {{on 'selectstart' preventSelect}}>
      <button
        type='button'
        class={{if this.lock 'chip lock is-on' 'chip lock'}}
        {{on 'click' this.toggleLock}}
      >{{if this.lock 'x lock' 'free'}}</button>
      <figure class='crop-stage'>
        <div class={{if this.held 'crop is-held' 'crop'}} {{this.bindFrame}}>
          <div
            class='still'
            {{motion
              drag=true
              dragConstraints=this.frame
              dragDirectionLock=this.lock
              dragElastic=(tuneNumber 'drag' 0.12 'dragElastic')
              dragTransition=(tuneObject 'drag' dragTransition 'dragTransition')
              onDragStart=this.grab
              onDragEnd=this.release
            }}
          >
            <svg
              class='still-plate'
              viewBox='0 0 900 560'
              preserveAspectRatio='xMidYMid slice'
              aria-hidden='true'
            >
              <defs>
                <linearGradient id='still-night' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0' stop-color='#1c1612' />
                  <stop offset='1' stop-color='#0a0807' />
                </linearGradient>
                <linearGradient id='still-wall' x1='0' y1='0' x2='1' y2='0.2'>
                  <stop offset='0' stop-color='#2a211c' />
                  <stop offset='0.55' stop-color='#3a2218' />
                  <stop offset='1' stop-color='#1a1613' />
                </linearGradient>
                <radialGradient id='still-kiln' cx='38%' cy='48%' r='28%'>
                  <stop offset='0' stop-color='#fff3c4' />
                  <stop offset='0.18' stop-color='#ffb36a' />
                  <stop offset='0.42' stop-color='#ff3b1f' />
                  <stop offset='1' stop-color='#3a0c08' stop-opacity='0' />
                </radialGradient>
                <linearGradient id='still-floor' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0' stop-color='#2a1a14' />
                  <stop offset='1' stop-color='#0e0b09' />
                </linearGradient>
                <linearGradient id='still-pour' x1='0' y1='0' x2='1' y2='0'>
                  <stop offset='0' stop-color='#c42712' stop-opacity='0' />
                  <stop offset='0.28' stop-color='#ff6a3a' />
                  <stop offset='0.5' stop-color='#ffd7a8' />
                  <stop offset='0.72' stop-color='#ff3b1f' />
                  <stop offset='1' stop-color='#7a1408' stop-opacity='0' />
                </linearGradient>
                <linearGradient id='still-glass' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0' stop-color='#e4a35a' />
                  <stop offset='1' stop-color='#ff3b1f' />
                </linearGradient>
              </defs>
              <rect width='900' height='560' fill='url(#still-night)' />
              <rect
                x='0'
                y='86'
                width='900'
                height='248'
                fill='url(#still-wall)'
              />
              <g fill='url(#still-glass)'>
                <rect x='40' y='112' width='58' height='92' />
                <rect x='112' y='112' width='58' height='92' />
                <rect x='184' y='112' width='58' height='92' />
                <rect x='40' y='214' width='58' height='70' />
                <rect x='112' y='214' width='58' height='70' />
                <rect x='184' y='214' width='58' height='70' />
              </g>
              <g fill='none' stroke='#1a1410' stroke-width='5' opacity='0.7'>
                <rect x='40' y='112' width='58' height='92' />
                <rect x='112' y='112' width='58' height='92' />
                <rect x='184' y='112' width='58' height='92' />
                <rect x='40' y='214' width='58' height='70' />
                <rect x='112' y='214' width='58' height='70' />
                <rect x='184' y='214' width='58' height='70' />
                <path
                  d='M40 158 H242 M69 112 V204 M141 112 V204 M213 112 V204'
                />
              </g>
              <path d='M0 86 L900 86 L880 58 L20 58 Z' fill='#100d0b' />
              <g stroke='#080706' stroke-width='7' fill='none'>
                <path d='M30 58 L150 86' />
                <path d='M210 58 L330 86' />
                <path d='M410 58 L530 86' />
                <path d='M610 58 L730 86' />
                <path d='M790 58 L880 86' />
              </g>
              <path
                d='M214 318 C214 230 270 176 348 176 C426 176 482 230 482 318 L214 318 Z'
                fill='#140c0a'
              />
              <path
                d='M236 318 C236 242 286 198 348 198 C410 198 460 242 460 318'
                fill='url(#still-kiln)'
              />
              <ellipse
                cx='348'
                cy='318'
                rx='92'
                ry='18'
                fill='#ffb36a'
                opacity='0.55'
              />
              <rect
                x='0'
                y='318'
                width='900'
                height='242'
                fill='url(#still-floor)'
              />
              <path d='M0 400 L900 368 L900 560 L0 560 Z' fill='#120e0c' />
              <g stroke='#2a211c' stroke-width='1' opacity='0.45'>
                <path d='M0 360 L900 336' />
                <path d='M0 392 L900 368' />
                <path d='M0 428 L900 404' />
              </g>
              <path
                d='M48 436 C190 418 340 424 500 442 C650 458 780 450 872 434'
                fill='none'
                stroke='url(#still-pour)'
                stroke-width='22'
                stroke-linecap='round'
              />
              <g fill='#0b0908'>
                <rect x='620' y='246' width='176' height='12' />
                <rect x='620' y='288' width='176' height='10' />
                <rect x='620' y='328' width='176' height='10' />
                <rect x='636' y='246' width='14' height='148' />
                <rect x='676' y='234' width='14' height='160' />
                <rect x='716' y='252' width='14' height='142' />
                <rect x='756' y='228' width='14' height='166' />
              </g>
              <ellipse
                cx='348'
                cy='458'
                rx='130'
                ry='22'
                fill='#ff3b1f'
                opacity='0.2'
              />
            </svg>
            <span class='still-slate'>
              <small>Still 24 · Night shift</small>
              <b>Atlas</b>
            </span>
          </div>
          <span class='crop-ticks' aria-hidden='true'></span>
        </div>
        <figcaption>4:5 cover · drag to reframe</figcaption>
      </figure>
    </div>
    <style scoped>
      .chip {
        border: 1px solid var(--line);
        background: transparent;
        color: var(--ink-dim);
        border-radius: 999px;
        padding: 7px 12px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .chip.is-on {
        color: var(--ink);
        border-color: var(--line-strong);
        background: var(--bg-spot);
      }

      @media (hover: hover) {
        .chip:hover {
          color: var(--ink);
          border-color: var(--line-strong);
          background: var(--bg-spot);
        }
      }

      .chip.is-on {
        box-shadow: inset 0 0 0 1px rgba(255, 59, 31, 0.35);
        color: var(--ember-hot);
      }

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
           The block padding was missing for a long time and it showed on any stage
           tall enough to fill the platter: the content sat flush against the top and
           bottom of the recess while keeping its 16px at the sides, which reads as
           content that has overflowed rather than content that has been placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      .no-select,
      .no-select * {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }

      .crop-stage {
        display: grid;
        justify-items: center;
        gap: 10px;
        margin: 0;
      }

      .crop {
        position: relative;
        width: min(74cqw, 66cqh, 400px);
        aspect-ratio: 4 / 5;
        overflow: hidden;
        border: 2px solid rgba(255, 215, 168, 0.28);
        border-radius: 22px;
        background: var(--bg-well);
        touch-action: none;
        box-shadow: 0 22px 50px
          rgba(var(--shadow-rgb), calc(0.45 * var(--shadow-a)));
        transition:
          border-color 1.5s var(--ease),
          box-shadow 1.5s var(--ease);
      }

      .crop.is-held {
        border-color: #ff3b1f;
        box-shadow:
          0 0 0 1px rgba(255, 59, 31, 0.35),
          0 22px 50px rgba(255, 59, 31, 0.2);
        transition-duration: 0.1s;
      }

      .crop-ticks {
        pointer-events: none;
        position: absolute;
        inset: 10px;
        border: 1px solid rgba(var(--ink-rgb), 0.22);
        border-radius: 8px;
      }

      .crop-ticks::before,
      .crop-ticks::after {
        content: '';
        position: absolute;
        background: #f3ece3;
      }

      .crop-ticks::before {
        top: -1px;
        left: 28%;
        right: 28%;
        height: 1px;
      }

      .crop-ticks::after {
        left: -1px;
        top: 32%;
        bottom: 32%;
        width: 1px;
      }

      .still {
        position: absolute;
        top: -16%;
        left: -14%;
        width: 204%;
        height: 152%;
        color: var(--ink);
        cursor: grab;
        touch-action: none;
        user-select: none;
      }

      .still:active {
        cursor: grabbing;
      }

      .still-plate {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
      }

      .still-slate {
        position: absolute;
        left: 8%;
        top: 58%;
        display: flex;
        flex-direction: column;
        gap: 2px;
        pointer-events: none;
      }

      .still-slate small {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(var(--ink-rgb), 0.72);
      }

      .still-slate b {
        font-family: var(--font-display);
        font-size: clamp(2rem, 8cqw, 3.1rem);
        letter-spacing: -0.05em;
        line-height: 0.9;
        text-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
      }

      .crop-stage figcaption {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      .lock {
        position: absolute;
        left: 14px;
        top: 14px;
        z-index: 3;
      }

      @container (max-width: 420px) {
        .crop {
          width: min(92%, 100%);
          max-width: 100%;
        }

        .crop {
          width: min(72cqw, 58cqh, 260px);
        }
      }

      @media (max-width: 720px) {
        .chip {
          padding: 9px 14px;
        }
      }

      .choreo-site:not([data-theme='light']) .crop {
        background: #221e1a;
      }
    </style>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneNumber('drag', 0.12, 'dragElastic');
tuneObject('drag', dragTransition, 'dragTransition');

export class DragWellDemo extends GalleryDemo {
  static stage = DragWell;
}
