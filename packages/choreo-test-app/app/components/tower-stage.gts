import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion, viewTransition } from 'glimmer-motion';
import config from 'test-app/config/environment';

/**
 * The Towers film's catalog faces, on the Sylva pattern (sylva-stage.gts):
 * the demo page does not run the film in-process — a vendored three.js
 * world, a shader post pass and per-beat audio sharing a main thread with
 * the gallery's Magic Move is a pacing bug wearing a demo's clothes — so
 * the stage face mounts the theater route in an IFRAME (`?embed` strips
 * the gate, the transport and the dive, and begins muted), with the same
 * ⛶ Theater door Sylva's stage wears. The tile face is a placard: no
 * WebGL in a gallery card, ever.
 */
const EMBED = `${config.rootURL}_towers?embed`;
const FRAME_FROM = { opacity: 0, scale: 0.97 } as const;
const FRAME_TO = { opacity: 1, scale: 1 } as const;
const FRAME_IN = { duration: 0.5, ease: [0.22, 1, 0.36, 1] } as const;

export class TowerStage extends Component {
  /** which face to wear — decided by the box it wakes up in, like Sylva */
  @tracked private context: 'boot' | 'stage' | 'tile' = 'boot';

  @service declare private router: RouterService;

  private place = modifier((el: HTMLElement) => {
    if (this.context !== 'boot') {
      return;
    }
    const face = el.closest('.stage-wrap') ? 'stage' : 'tile';
    requestAnimationFrame(() => {
      if (this.context === 'boot') {
        this.context = face;
      }
    });
  });

  private get isStage() {
    return this.context === 'stage';
  }

  /** the same bitmap-morph crossing Sylva's theater button takes */
  private cross = (route: string) => {
    void viewTransition(async () => {
      await this.router.transitionTo(route);
    });
  };

  <template>
    <div class="tw-face" {{this.place}}>
      {{#if this.isStage}}
        {{! the demo page's face: the film in a frame, muted, tweened in —
            the heavy world stays in its own context and unmounts whole }}
        <div class="tw-embed">
          <iframe
            class="tw-frame"
            title="Towers — the film"
            src={{EMBED}}
            {{motion initial=FRAME_FROM animate=FRAME_TO transition=FRAME_IN}}
          ></iframe>
          <button
            type="button"
            class="tw-theater-btn"
            {{on "click" (fn this.cross "towers")}}
          >⛶ Theater</button>
        </div>
      {{else}}
        {{! the gallery card's face: a placard, not a world }}
        <div class="tw-tile" aria-hidden="true">
          <p class="tw-tile-k">天守</p>
          <p class="tw-tile-t">TOWERS</p>
          <p class="tw-tile-s">A construction study · a film cut by a score</p>
        </div>
      {{/if}}
    </div>

    <style>
      .tw-face {
        position: absolute;
        inset: 0;
      }

      /* the Sylva stage-face pattern, in this film's own palette — the
         sy-* rules live inside sylva-stage and do not travel */
      .tw-embed {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #ecdcbc;
        view-transition-name: tower-stage;
      }

      .tw-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        transform-origin: 50% 60%;
      }

      .tw-theater-btn {
        position: absolute;
        top: 14px;
        right: 14px;
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid rgba(168, 98, 31, 0.45);
        background: rgba(36, 27, 12, 0.6);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #f2e9d2;
        font:
          11px/1 ui-monospace,
          monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
      }

      .tw-theater-btn:hover {
        background: rgba(74, 52, 20, 0.85);
      }

      .tw-tile {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        background: radial-gradient(
          120% 90% at 30% 0%,
          rgba(255, 244, 214, 0.9) 0%,
          rgba(236, 220, 188, 0.98) 55%,
          #decba0 100%
        );
        color: #2e2515;
        text-align: center;
      }

      .tw-tile-k {
        margin: 0;
        font-family:
          "Iowan Old Style", Charter, "Palatino Linotype", Palatino, Georgia,
          serif;
        font-size: 64px;
        line-height: 1.1;
      }

      .tw-tile-t {
        margin: 6px 0 0;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.5em;
        text-indent: 0.5em;
      }

      .tw-tile-s {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.08em;
        color: #8b7c5c;
      }
    </style>
  </template>
}

export default TowerStage;
