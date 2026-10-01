// Pretui — Toaster usage page.
//
// The page has to demonstrate three things a screenshot cannot: that the
// clock pauses when you hover, that the cap queues rather than drops, and
// that dismissing the toast you are focused on hands focus somewhere sensible
// instead of the body. So the stage is a real store with real buttons, and
// the hints tell the reader which keys to press.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Toaster, ToastStore } from './toaster';
import type { ToastPlacement, ToastTone } from './toaster';

const PLACEMENTS = [
  'top-start',
  'top',
  'top-end',
  'bottom-start',
  'bottom',
  'bottom-end',
];

const RECEIPTS: { tone: ToastTone; title: string; message?: string }[] = [
  {
    tone: 'success',
    title: 'Lot 4417 published',
    message: 'Visible to the desk in a moment.',
  },
  {
    tone: 'info',
    title: 'Cupping notes synced',
  },
  {
    tone: 'warning',
    title: 'Arrival date is in the past',
    message: 'The lot will sort to the bottom of the board.',
  },
  {
    tone: 'danger',
    title: 'Could not reach the warehouse',
    message: 'Nothing was saved. Try again when the link is back.',
  },
  {
    tone: 'neutral',
    title: 'Draft autosaved',
  },
];

class ToasterState extends GlimmerComponent {
  toasts = new ToastStore();

  @tracked placement = 'bottom-end';
  @tracked limit = 3;
  @tracked seconds = 6;
  @tracked pauseOnHover = true;
  @tracked nth = 0;
  @tracked undone = '—';

  setPlacement = (value: string) => (this.placement = value);
  setLimit = (value: number | null) => (this.limit = value ?? 3);
  setSeconds = (value: number | null) => (this.seconds = value ?? 6);
  setPauseOnHover = (value: boolean) => (this.pauseOnHover = value);

  get placementValue() {
    return this.placement as ToastPlacement;
  }

  /** Deterministic rotation through the fixture set — `Math.random()` is
   * forbidden in a realm, and a cycle is the better demo anyway because the
   * reader can predict what comes next. */
  private next() {
    let receipt = RECEIPTS[this.nth % RECEIPTS.length];
    this.nth = this.nth + 1;
    return receipt;
  }

  push = () => {
    let receipt = this.next();
    this.toasts.show({
      title: receipt.title,
      message: receipt.message,
      tone: receipt.tone,
      duration: this.seconds,
    });
  };

  pushSticky = () => {
    this.toasts.show({
      title: 'Reindexing the realm',
      message: 'This one has no clock — it waits to be dismissed.',
      tone: 'info',
      duration: 0,
    });
  };

  pushUndo = () => {
    this.toasts.show({
      title: 'Lot 4417 archived',
      tone: 'neutral',
      duration: this.seconds,
      actionLabel: 'Undo',
      onAction: () => (this.undone = 'Lot 4417 restored'),
    });
  };

  pushFive = () => {
    for (let i = 0; i < 5; i++) {
      let receipt = this.next();
      this.toasts.show({
        title: receipt.title,
        message: receipt.message,
        tone: receipt.tone,
        duration: this.seconds,
      });
    }
  };

  clearAll = () => this.toasts.clear();
}

class ToasterUsage extends ToasterState {
  <template>
    <FreestyleUsage
      @name='Toaster'
      @description='The host Toast never had: a positioned region that stacks, ages and dismisses toasts. The auto-dismiss clock is a CSS animation rather than a timer, so pause-on-hover and pause-on-focus are animation-play-state and no elapsed time is ever measured or re-armed — which is what makes it legal in a realm and what stops it hanging a test suite. Severity picks the live-region politeness (role=alert for warning and danger, role=status otherwise), the cap is a real queue whose clocks have not started, F6 moves focus into the region and back out, and dismissing a focused toast hands focus to its neighbour rather than dropping it on the body.'
    >
      <:example>
        <div class='tst-row'>
          <Button @tone='primary' @appearance='accent' {{on 'click' this.push}}>
            Show a toast
          </Button>
          <Button @tone='neutral' @appearance='outlined' {{on 'click' this.pushFive}}>
            Show five at once
          </Button>
          <Button @tone='neutral' @appearance='outlined' {{on 'click' this.pushUndo}}>
            With an action
          </Button>
          <Button @tone='neutral' @appearance='outlined' {{on 'click' this.pushSticky}}>
            Sticky
          </Button>
          <Button @tone='neutral' @appearance='plain' {{on 'click' this.clearAll}}>
            Clear
          </Button>
        </div>
        <p class='tst-hint'>Hover the stack and the bars stop; move away and they
          carry on from where they were. Press
          <em>F6</em>
          to put focus inside the region, arrow through with Tab, dismiss with
          Enter — focus lands on the next toast, and on the last one it goes
          back to where you pressed F6. Push five with a limit of three and the
          extra two wait
          <em>unstarted</em>: their clock begins when they appear.</p>
        <p class='tst-log'>last action: <strong>{{this.undone}}</strong></p>

        <Toaster
          @store={{this.toasts}}
          @placement={{this.placementValue}}
          @limit={{this.limit}}
          @duration={{this.seconds}}
          @pauseOnHover={{this.pauseOnHover}}
        />
      </:example>
      <:api as |Args|>
        <Args.Base
          @name='store'
          @description='A ToastStore instance — the imperative half. store.show({title, message, tone, duration, actionLabel, onAction}) returns an id; store.dismiss(id) and store.clear() do what they say. Showing with an id that already exists replaces that toast in place, which is how a Saving… becomes a Saved without the stack jumping. It is a class you instantiate rather than a module singleton, because module-scope mutable state in a realm is evaluated by the indexer, shared by every card that imports it, and impossible to reset between tests.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='toasts / onDismiss'
          @description='The controlled alternative to a store: pass the array yourself and remove from it when onDismiss fires. Both halves exist because a host that can only be told a toast left is not a host a parent controls.'
          @hideControls={{true}}
        />
        <Args.String
          @name='placement'
          @description='Where the stack sits. Logical start and end rather than left and right, so RTL is free. The React spellings bottom-right, top-left and friends are accepted and mapped, as is the position alias.'
          @value={{this.placement}}
          @options={{PLACEMENTS}}
          @defaultValue='bottom-end'
          @onInput={{this.setPlacement}}
        />
        <Args.Number
          @name='limit'
          @description='How many toasts render at once. The rest queue and are NOT in the DOM, so their clock has not started — Sonner keeps every toast alive behind the cap, which means the ones you never saw expire unseen.'
          @value={{this.limit}}
          @min={{1}}
          @max={{6}}
          @defaultValue={{4}}
          @onInput={{this.setLimit}}
        />
        <Args.Number
          @name='duration'
          @description='Default seconds before a toast ages out; a toast can override it, and 0 makes one sticky. Seconds, not milliseconds — a bare 4000 in a prop is a unit no caller can check.'
          @value={{this.seconds}}
          @min={{1}}
          @max={{20}}
          @defaultValue={{5}}
          @onInput={{this.setSeconds}}
        />
        <Args.Bool
          @name='pauseOnHover'
          @description='Pauses every clock in the region while the pointer is over it, matching the Sonner and Mantine default of pausing the whole stack rather than one toast. pauseOnFocus does the same for focus-within and pauseWhenHidden for a backgrounded tab.'
          @value={{this.pauseOnHover}}
          @defaultValue={{true}}
          @onInput={{this.setPauseOnHover}}
        />
        <Args.Base
          @name='label / dismissLabel / hotkey'
          @description='The region name announced to assistive tech, the dismiss control name, and whether F6 cycles focus into the region. F6 is the platform key for moving between panes and it is the only way a keyboard reader reaches a toast at all before it ages out.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='toast'
          @description='Render the toast body yourself. The chrome stays ours — region, roles, live-region politeness, the clock, the dismiss control and the focus handling are the parts that are easy to get wrong.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .tst-row {
        display: flex;
        align-items: center;
        gap: var(--space-3, 8px);
        flex-wrap: wrap;
      }
      .tst-hint {
        margin: var(--space-4, 11px) 0 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .tst-hint em {
        font-style: normal;
        font-weight: 600;
        color: var(--foreground);
      }
      .tst-log {
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .tst-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
    </style>
  </template>
}

export const DEMOS_TOASTER: Record<string, unknown> = {
  Toaster: ToasterUsage,
};
