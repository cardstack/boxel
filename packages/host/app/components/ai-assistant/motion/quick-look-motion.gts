import { array } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Choreo } from '@cardstack/choreo';
import { modifier } from 'ember-modifier';

import type AssistantQuickLookService from '@cardstack/host/services/assistant-quick-look';

import {
  DURATION,
  EASE,
  EASE_IN,
  MAX_FRAME_STEP,
  motionEnabled,
} from './tokens';

// Quick Look's motion, as one Choreo region around the assistant panel's
// content (ADR 007 §1.2: one engine reacts to rendered changes; nothing
// here is started by a caller). Read motion/README.md for the participants
// it expects and the ADR rule each step answers to.
//
// Participants (declared where the markup lives, never started from here):
//   role='quick-look'           the sheet: Pret UI's QuickLook
//                               (packages/pretui/components/quick-look.gts)
//   role='quick-look-backdrop'  its backdrop, the same component
//   {{beacon sourceKey}}        the pill or embed that opened it: CardPill and
//                               FilePill in the reader's bubble (attachments),
//                               card and file slots in an answer
//                               (rendered-markdown, via aibot-message)

interface Signature {
  Element: HTMLDivElement;
  Args: Record<string, never>;
  Blocks: { default: [] };
}
// The layer is the whole viewport: a Quick Look pops over the operator
// mode, not just the assistant panel. Mounted once in the submode layout;
// the pills it comes out of publish document-wide beacons, so they can be
// anywhere.

/**
 * The sheet comes out of the pill that opened it and goes back into it.
 * Opening and closing are the quick-look service's plain state changes; the
 * sheet is inserted or removed on that render pass, and this score is how
 * the region shows the pass (§1.1: state never waits on it).
 *
 * - an inserted sheet moves from the pill's box to its own, sized through a
 *   clip so its text and the card in it never stretch (`@size='crop'`,
 *   §1.5), easing out over the space duration (a card-sized change of
 *   place, 300–500 ms);
 * - a removed sheet moves back to the pill's box, easing in over the exit
 *   duration, and fades as it goes;
 * - the backdrop fades in and out.
 *
 * Under reduced motion the region's MotionConfig ('user') lands the moves
 * at once and keeps the fades (§1.5). In tests the region is not rendered
 * and the same markup stands in a plain box (§1.1: the same DOM either
 * way).
 */
export default class QuickLookMotion extends Component<Signature> {
  @service('assistant-quick-look')
  declare private quickLook: AssistantQuickLookService;

  private enabled = motionEnabled();

  // The pill the sheet last came out of. This is the motion layer's own
  // memory, not application state: the service forgets the source the
  // moment Quick Look closes, and the closing pass still needs to know
  // where to send the leaving sheet. Written after each render that has a
  // source, read only when the service no longer has one.
  private lastSource: string | undefined;

  private remember = modifier(
    (_element: HTMLElement, [key]: [string | undefined]) => {
      if (key) {
        this.lastSource = key;
      }
    },
  );

  // a name nothing claimed leaves that end of the flight alone
  private get source(): string {
    return this.quickLook.current?.sourceKey ?? this.lastSource ?? '';
  }

  <template>
    {{#if this.enabled}}
      <Choreo
        @id='assistant-quick-look'
        class='quick-look-region'
        @maxFrameStep={{MAX_FRAME_STEP}}
        ...attributes
        {{this.remember this.quickLook.current.sourceKey}}
        as |c|
      >
        {{yield}}
        <c.Parallel>
          <c.Move
            @of={{c.inserted 'quick-look'}}
            @from={{c.beacon this.source}}
            @size='crop'
            @duration={{DURATION.space}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.inserted 'quick-look-backdrop'}}
            @opacity={{array 0 1}}
            @duration={{DURATION.enter}}
            @ease={{EASE}}
          />
          <c.Move
            @of={{c.removed 'quick-look'}}
            @to={{c.beacon this.source}}
            @size='crop'
            @duration={{DURATION.exit}}
            @ease={{EASE_IN}}
          />
          <c.Tween
            @of={{c.removed 'quick-look'}}
            @opacity={{array 1 0}}
            @duration={{DURATION.exit}}
            @ease={{EASE_IN}}
          />
          <c.Tween
            @of={{c.removed 'quick-look-backdrop'}}
            @opacity={{array 1 0}}
            @duration={{DURATION.exit}}
            @ease={{EASE_IN}}
          />
        </c.Parallel>
      </Choreo>
    {{else}}
      <div class='quick-look-region' ...attributes>{{yield}}</div>
    {{/if}}
    <style scoped>
      /* the region is the viewport: the sheet, its backdrop and the
         region's own layers stand in it, above the operator mode; only an
         open Quick Look takes the pointer */
      .quick-look-region {
        position: fixed;
        inset: 0;
        z-index: var(--boxel-layer-modal-default);
        pointer-events: none;
        /* a centered sheet over the workspace, the way a card is looked at
           in operator mode: light, on the stack's surface */
        --pretui-quick-look-inset: max(6vh, 2rem)
          max(calc((100vw - 67.5rem) / 2), 2rem);
        --card: var(--boxel-light);
        --card-foreground: var(--boxel-dark);
        --foreground: var(--boxel-dark);
        --background: var(--boxel-light);
        --border: var(--boxel-200);
        --ink-2: var(--boxel-500);
        --ink-3: var(--boxel-450);
        --muted-foreground: var(--boxel-500);
        --primary: var(--boxel-highlight);
        --primary-foreground: var(--boxel-dark);
        --ring: var(--boxel-dark);
        --pretui-scrim: rgb(0 0 0 / 55%);
      }
      .quick-look-region > :deep(.pretui-quick-look) {
        pointer-events: auto;
      }
    </style>
  </template>
}
