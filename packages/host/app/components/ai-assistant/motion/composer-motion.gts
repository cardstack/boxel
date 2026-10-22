import { array } from '@ember/helper';
import Component from '@glimmer/component';

import { Choreo } from '@cardstack/choreo';

import {
  DURATION,
  EASE,
  EASE_IN,
  MAX_FRAME_STEP,
  motionEnabled,
} from './tokens';

interface Signature {
  Element: HTMLDivElement;
  Args: Record<string, never>;
  Blocks: { default: [] };
}

// How far the cap travels as it rises out from behind the message box.
const CAP_RISE = 12;
// How far the New Messages chip rises into its row.
const CHIP_RISE = 8;

/**
 * The composer: the New Messages chip, the cap on the box's top edge and
 * the box. Its participants (declared where they render):
 *
 * - `role='chip'`, id `unread`: the New Messages row.
 * - `role='cap'`, id `composer-cap`: the cap.
 * - `role='cap-status'`, id `cap-status`: the cap's status row, re-rendered
 *   whenever what it says changes, so the old and new rows pair.
 *
 * The cap rises out from behind the box (the box sits above it) and sinks
 * back when it leaves; a status change crossfades the old row into the
 * new one in place (`@swap='during'`); a cap that gains or loses a row
 * moves to its new place and takes its new size at once. Every move here
 * is translate-only: Choreo's crop scales by width with the top pinned, so
 * it would scale the cap's words and step list. The chip rises in and
 * fades out.
 */
export class ComposerMotion extends Component<Signature> {
  private enabled = motionEnabled();

  <template>
    {{#if this.enabled}}
      <Choreo
        @id='assistant-composer'
        @maxFrameStep={{MAX_FRAME_STEP}}
        ...attributes
        as |c|
      >
        {{yield}}
        <c.Parallel>
          <c.Tween
            @of={{c.inserted 'cap'}}
            @opacity={{array 0 1}}
            @y={{array CAP_RISE 0}}
            @duration={{DURATION.enter}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.removed 'cap'}}
            @opacity={{array 1 0}}
            @y={{array 0 CAP_RISE}}
            @duration={{DURATION.exit}}
            @ease={{EASE_IN}}
          />
          <c.Move
            @of={{c.moved 'cap'}}
            @duration={{DURATION.move}}
            @ease={{EASE}}
            @size={{false}}
          />
          <c.Move
            @of={{c.received 'cap-status'}}
            @duration={{DURATION.feedback}}
            @ease={{EASE}}
            @size={{false}}
            @swap='during'
          />
          <c.Tween
            @of={{c.inserted 'chip'}}
            @opacity={{array 0 1}}
            @y={{array CHIP_RISE 0}}
            @duration={{DURATION.enter}}
            @ease={{EASE}}
          />
          <c.Tween
            @of={{c.removed 'chip'}}
            @opacity={{array 1 0}}
            @duration={{DURATION.exit}}
            @ease={{EASE_IN}}
          />
        </c.Parallel>
      </Choreo>
    {{else}}
      <div ...attributes>{{yield}}</div>
    {{/if}}
  </template>
}
