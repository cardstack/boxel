import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DateTimeField from '@cardstack/base/datetime';
import enumField from '@cardstack/base/enum';
import TimerIcon from '@cardstack/boxel-icons/timer';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import { SlaTimerBadge } from './components/sla-timer-badge';
import { formatMinutes, timerSnapshot } from './utils/sla';

export const TIMER_KINDS = [
  'First response',
  'Next response',
  'Resolution',
] as const;

export const TimerKindField = enumField(StringField, {
  displayName: 'Timer Kind',
  options: TIMER_KINDS as unknown as string[],
});

/**
 * One SLA commitment on one ticket, and the clock running against it.
 *
 * `deadlineAt` is the load-bearing field. It is a plain wall-clock instant that
 * has ALREADY had business hours, holidays and every pause folded into it, and
 * it is written only by the commands that own the ticket's lifecycle. That is
 * what lets everything downstream — this field's computeds, the live badge, the
 * queue's sort — do nothing but subtract two numbers.
 */
export class SlaTimerField extends FieldDef {
  static displayName = 'SLA Timer';
  static icon = TimerIcon;

  @field kind = contains(TimerKindField);
  @field targetMinutes = contains(NumberField, {
    description: 'The committed target in minutes, copied from the policy.',
  });
  @field startedAt = contains(DateTimeField);
  @field deadlineAt = contains(DateTimeField, {
    description:
      'Business-hours-adjusted expiry. Written by commands, never by hand.',
  });
  @field satisfiedAt = contains(DateTimeField);
  @field pausedSince = contains(DateTimeField);
  @field breachedAt = contains(DateTimeField);

  // The three computeds below are the snapshot that prerendered views read.
  // They are correct as of the last write to the ticket and go stale between
  // writes — which is exactly right for a tile in a grid, and exactly wrong
  // for the ticket you have open, where the live badge recomputes instead.
  @field state = contains(StringField, {
    computeVia: function (this: SlaTimerField) {
      return timerSnapshot(this).state;
    },
  });

  @field percentRemaining = contains(NumberField, {
    computeVia: function (this: SlaTimerField) {
      return timerSnapshot(this).percentRemaining ?? undefined;
    },
  });

  @field label = contains(StringField, {
    computeVia: function (this: SlaTimerField) {
      return timerSnapshot(this).shortLabel;
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: SlaTimerField) {
      let snapshot = timerSnapshot(this);
      return `${this.kind ?? 'SLA'} — ${snapshot.shortLabel}`;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <SlaTimerBadge
        @facts={{@model}}
        @caption={{@model.kind}}
        @live={{true}}
        @showBar={{true}}
        class='sla-embedded'
      />
      <style scoped>
        .sla-embedded {
          width: 100%;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template><SlaTimerBadge @facts={{@model}} @live={{false}} /></template>
  };

  static edit = class Edit extends Component<typeof this> {
    get targetLabel() {
      let minutes = this.args.model.targetMinutes;
      return typeof minutes === 'number' ? formatMinutes(minutes) : '—';
    }

    setTarget = (value: string) => {
      let parsed = Number(value);
      this.args.model.targetMinutes = Number.isFinite(parsed)
        ? parsed
        : undefined;
    };

    <template>
      <div class='timer-edit'>
        <div class='timer-row'>
          <span class='timer-lbl'>Kind</span>
          <@fields.kind />
        </div>
        <div class='timer-row'>
          <span class='timer-lbl'>Target</span>
          <span class='timer-target'>
            <BoxelInput
              @type='number'
              @value={{@model.targetMinutes}}
              @onInput={{this.setTarget}}
              @disabled={{not @canEdit}}
            />
            <span class='timer-hint'>minutes — {{this.targetLabel}}</span>
          </span>
        </div>
        {{! Everything below is owned by the lifecycle commands. Editing a
            deadline by hand would let a ticket claim it met a target it
            missed, so these are shown as facts, not inputs. }}
        <div class='timer-readonly'>
          <SlaTimerBadge
            @facts={{@model}}
            @caption='Current state'
            @live={{true}}
            @showBar={{true}}
          />
          <p class='timer-note'>
            Started, deadline, pause and breach times are set by the ticket's
            actions — reply, set pending, resolve — so the clock always matches
            what actually happened.
          </p>
        </div>
      </div>
      <style scoped>
        .timer-edit {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          font-family: var(--font-sans, var(--boxel-font-family));
          color: var(--foreground, var(--boxel-dark));
        }
        .timer-row {
          display: grid;
          grid-template-columns: 5.5rem 1fr;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-width: 0;
        }
        .timer-lbl {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .timer-target {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-width: 0;
        }
        .timer-hint {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .timer-readonly {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          padding-top: var(--boxel-sp-xs);
          border-top: 1px dashed var(--border, var(--boxel-200));
        }
        .timer-note {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.45;
          color: var(--muted-foreground, var(--boxel-450));
          max-width: 46ch;
        }
      </style>
    </template>
  };
}
