// Pretui — Popup: an anchored floating layer, positioned by measuring on open.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { resolvePlacement, resolveOpen, anchorTo } from '../internal/overlay';
import type { PopupPlacement, PlacementArgs, OpenArgs } from '../internal/overlay';

export interface PopupSignature {
  Args: OpenArgs &
    PlacementArgs & {
      placement?: PopupPlacement | string;
      distance?: number;
      matchWidth?: boolean;
      /** Scale the floating panel with a zoomable host surface. Applied as a
       * `transform`, clamped 0.4–2.5; 1 (the default) writes no transform. */
      scale?: number;
    };
  Blocks: { anchor: []; default: [] };
  Element: HTMLSpanElement;
}

/**
 * Headless anchored-positioning primitive (wa-popup, trimmed). Renders its
 * anchor inline and, while @open, a fixed-position container placed against
 * it. Fixed positioning is intentional — anchored overlays must escape
 * scroll clipping (lint warns; accepted, same as the Select backdrop).
 */
export class Popup extends Component<PopupSignature> {
  @tracked anchorEl?: HTMLElement;
  captureAnchor = modifier((el: HTMLElement) => {
    this.anchorEl = el;
  });
  get placement(): PopupPlacement {
    return resolvePlacement(this.args, 'bottom-start');
  }
  get open() {
    return resolveOpen(this.args) ?? false;
  }
  get distance() {
    return this.args.distance ?? 6;
  }
  get matchWidth() {
    return this.args.matchWidth ?? false;
  }
  <template>
    <span class='pretui-popup-anchor' {{this.captureAnchor}} ...attributes>
      {{yield to='anchor'}}
      {{#if this.open}}
        <span
          class='pretui-popup'
          {{anchorTo
            this.anchorEl
            this.placement
            this.distance
            this.matchWidth
            @scale
          }}
        >
          {{yield}}
        </span>
      {{/if}}
    </span>
    <style scoped>
      .pretui-popup-anchor {
        display: inline-block;
      }
      .pretui-popup {
        /* anchored overlays must escape scroll clipping; measured on open
           only — never during prerender (lint warns, accepted) */
        position: fixed;
        top: 0;
        left: 0;
        /* kit stacking scale (pretui-css.gts): `overlay` sits above
           `dropdown` because a Popup can CONTAIN a Select or Menu, and a
           containing panel must never paint under its own content.
           Dialog/Drawer are not on the scale in practice — showModal()
           promotes them to the top layer, above every z-index here. */
        z-index: var(--pretui-z-overlay, 70);
        display: block;
      }
    </style>
  </template>
}
