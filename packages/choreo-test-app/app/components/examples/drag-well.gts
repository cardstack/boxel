import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import { tuneNumber, tuneObject } from 'test-app/lib/demo-tuning';
import { preventSelect } from 'test-app/lib/pointer';

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
    <div class="ex no-select" {{on "selectstart" preventSelect}}>
      <button
        type="button"
        class={{if this.lock "chip lock is-on" "chip lock"}}
        {{on "click" this.toggleLock}}
      >{{if this.lock "x lock" "free"}}</button>
      <figure class="crop-stage">
        <div class={{if this.held "crop is-held" "crop"}} {{this.bindFrame}}>
          <div
            class="still"
            {{motion
              drag=true
              dragConstraints=this.frame
              dragDirectionLock=this.lock
              dragElastic=(tuneNumber "drag" 0.12 "dragElastic")
              dragTransition=(tuneObject "drag" dragTransition "dragTransition")
              onDragStart=this.grab
              onDragEnd=this.release
            }}
          >
            <svg
              class="still-plate"
              viewBox="0 0 900 560"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="still-night" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#1c1612" />
                  <stop offset="1" stop-color="#0a0807" />
                </linearGradient>
                <linearGradient id="still-wall" x1="0" y1="0" x2="1" y2="0.2">
                  <stop offset="0" stop-color="#2a211c" />
                  <stop offset="0.55" stop-color="#3a2218" />
                  <stop offset="1" stop-color="#1a1613" />
                </linearGradient>
                <radialGradient id="still-kiln" cx="38%" cy="48%" r="28%">
                  <stop offset="0" stop-color="#fff3c4" />
                  <stop offset="0.18" stop-color="#ffb36a" />
                  <stop offset="0.42" stop-color="#ff3b1f" />
                  <stop offset="1" stop-color="#3a0c08" stop-opacity="0" />
                </radialGradient>
                <linearGradient id="still-floor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#2a1a14" />
                  <stop offset="1" stop-color="#0e0b09" />
                </linearGradient>
                <linearGradient id="still-pour" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stop-color="#c42712" stop-opacity="0" />
                  <stop offset="0.28" stop-color="#ff6a3a" />
                  <stop offset="0.5" stop-color="#ffd7a8" />
                  <stop offset="0.72" stop-color="#ff3b1f" />
                  <stop offset="1" stop-color="#7a1408" stop-opacity="0" />
                </linearGradient>
                <linearGradient id="still-glass" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#e4a35a" />
                  <stop offset="1" stop-color="#ff3b1f" />
                </linearGradient>
              </defs>
              <rect width="900" height="560" fill="url(#still-night)" />
              <rect
                x="0"
                y="86"
                width="900"
                height="248"
                fill="url(#still-wall)"
              />
              <g fill="url(#still-glass)">
                <rect x="40" y="112" width="58" height="92" />
                <rect x="112" y="112" width="58" height="92" />
                <rect x="184" y="112" width="58" height="92" />
                <rect x="40" y="214" width="58" height="70" />
                <rect x="112" y="214" width="58" height="70" />
                <rect x="184" y="214" width="58" height="70" />
              </g>
              <g fill="none" stroke="#1a1410" stroke-width="5" opacity="0.7">
                <rect x="40" y="112" width="58" height="92" />
                <rect x="112" y="112" width="58" height="92" />
                <rect x="184" y="112" width="58" height="92" />
                <rect x="40" y="214" width="58" height="70" />
                <rect x="112" y="214" width="58" height="70" />
                <rect x="184" y="214" width="58" height="70" />
                <path
                  d="M40 158 H242 M69 112 V204 M141 112 V204 M213 112 V204"
                />
              </g>
              <path d="M0 86 L900 86 L880 58 L20 58 Z" fill="#100d0b" />
              <g stroke="#080706" stroke-width="7" fill="none">
                <path d="M30 58 L150 86" />
                <path d="M210 58 L330 86" />
                <path d="M410 58 L530 86" />
                <path d="M610 58 L730 86" />
                <path d="M790 58 L880 86" />
              </g>
              <path
                d="M214 318 C214 230 270 176 348 176 C426 176 482 230 482 318 L214 318 Z"
                fill="#140c0a"
              />
              <path
                d="M236 318 C236 242 286 198 348 198 C410 198 460 242 460 318"
                fill="url(#still-kiln)"
              />
              <ellipse
                cx="348"
                cy="318"
                rx="92"
                ry="18"
                fill="#ffb36a"
                opacity="0.55"
              />
              <rect
                x="0"
                y="318"
                width="900"
                height="242"
                fill="url(#still-floor)"
              />
              <path d="M0 400 L900 368 L900 560 L0 560 Z" fill="#120e0c" />
              <g stroke="#2a211c" stroke-width="1" opacity="0.45">
                <path d="M0 360 L900 336" />
                <path d="M0 392 L900 368" />
                <path d="M0 428 L900 404" />
              </g>
              <path
                d="M48 436 C190 418 340 424 500 442 C650 458 780 450 872 434"
                fill="none"
                stroke="url(#still-pour)"
                stroke-width="22"
                stroke-linecap="round"
              />
              <g fill="#0b0908">
                <rect x="620" y="246" width="176" height="12" />
                <rect x="620" y="288" width="176" height="10" />
                <rect x="620" y="328" width="176" height="10" />
                <rect x="636" y="246" width="14" height="148" />
                <rect x="676" y="234" width="14" height="160" />
                <rect x="716" y="252" width="14" height="142" />
                <rect x="756" y="228" width="14" height="166" />
              </g>
              <ellipse
                cx="348"
                cy="458"
                rx="130"
                ry="22"
                fill="#ff3b1f"
                opacity="0.2"
              />
            </svg>
            <span class="still-slate">
              <small>Still 24 · Night shift</small>
              <b>Atlas</b>
            </span>
          </div>
          <span class="crop-ticks" aria-hidden="true"></span>
        </div>
        <figcaption>4:5 cover · drag to reframe</figcaption>
      </figure>
    </div>
  </template>
}

// Declare the demo variables before the first interactive Choreo pass.
tuneNumber('drag', 0.12, 'dragElastic');
tuneObject('drag', dragTransition, 'dragTransition');
