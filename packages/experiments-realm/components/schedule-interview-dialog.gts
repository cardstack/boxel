import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { BoxelInput, Button } from '@cardstack/boxel-ui/components';
// Live cross-realm import — same alias pattern as person-base.gts's
// ImageSourceField. `anchoring='center'` gives a viewport-centered modal
// popover with its own dim backdrop, dismiss-on-Esc/outside-click, and
// focus trap — the same contract boxel-ui's `Modal` gives, themed via the
// anchor's resolved tokens.
import Popover from '@cardstack/catalog/46f065-popover/popover';

import type { Candidate } from '../candidate';
import type { Employee } from '../employee';
import type { Meeting } from '../meeting';
import { INTERVIEW_ROUND_OPTIONS } from '../interview-round-field';

// Working window and slot size for the picker. One hour per slot matches the
// command's DEFAULT_INTERVIEW_MINUTES, so a slot shown as free here is
// exactly the interval the command will re-check server-side.
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 17;
const SLOT_MINUTES = 60;

function durationMs(duration?: {
  value?: number | null;
  unit?: string | null;
}): number {
  let value = duration?.value;
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return SLOT_MINUTES * 60000;
  }
  switch (duration?.unit) {
    case 'minutes':
      return value * 60000;
    case 'hours':
      return value * 3600000;
    case 'days':
      return value * 86400000;
    default:
      return SLOT_MINUTES * 60000;
  }
}

function toDateStr(d: Date): string {
  let y = d.getFullYear();
  let m = String(d.getMonth() + 1).padStart(2, '0');
  let day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface SlotState {
  hour: number;
  label: string;
  free: boolean;
  reason?: string;
}

interface ScheduleInterviewDialogSignature {
  Args: {
    candidate: Candidate;
    employees: Employee[];
    meetings: Meeting[];
    isRunning?: boolean;
    error?: string;
    onConfirm: (opts: {
      date: Date;
      interviewers: Employee[];
      roundType: string;
      ignoreConflicts: boolean;
    }) => void;
    onCancel: () => void;
  };
  Element: HTMLElement;
}

// Plain Glimmer component, one instance popped near the top of the tracker's
// template (same placement idiom as RejectCandidateDialog). The parent
// renders it inside {{#if}}, so open → close → reopen always starts from a
// fresh instance; no manual reset bookkeeping.
//
// The slot row is availability-aware: for the chosen interviewer(s) and day
// it computes which hourly slots (9:00–17:00) are still free from the live
// meetings the tracker already holds, so the recruiter picks a conflict-free
// time instead of typing one blind. ScheduleInterviewCommand re-checks
// server-side and throws on a clash; that error surfaces here (role='alert')
// with a deliberate "book anyway" override.
export class ScheduleInterviewDialog extends GlimmerComponent<ScheduleInterviewDialogSignature> {
  roundTypeOptions = INTERVIEW_ROUND_OPTIONS;

  @tracked dateStr = toDateStr(new Date());
  @tracked selectedInterviewerIds: string[] = [];
  @tracked roundType = 'technical';
  @tracked selectedHour: number | undefined;

  get availableEmployees(): Employee[] {
    return (this.args.employees ?? []).filter(
      (e) => e && e.status !== 'offboarded',
    );
  }

  get selectedInterviewers(): Employee[] {
    return this.availableEmployees.filter(
      (e) => e.id && this.selectedInterviewerIds.includes(e.id),
    );
  }

  isInterviewerSelected = (employee: Employee): boolean => {
    return Boolean(
      employee.id && this.selectedInterviewerIds.includes(employee.id),
    );
  };

  toggleInterviewer = (employee: Employee) => {
    let id = employee.id;
    if (!id) {
      return;
    }
    this.selectedInterviewerIds = this.selectedInterviewerIds.includes(id)
      ? this.selectedInterviewerIds.filter((x) => x !== id)
      : [...this.selectedInterviewerIds, id];
  };

  setRoundType = (value: string) => {
    this.roundType = value;
  };

  setDate = (value: string) => {
    this.dateStr = value;
  };

  setSlot = (hour: number) => {
    this.selectedHour = hour;
  };

  private slotStart(hour: number): Date | undefined {
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(this.dateStr ?? '');
    if (!match) {
      return undefined;
    }
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      hour,
      0,
      0,
      0,
    );
  }

  // The selected interviewers' existing meetings on any day — the overlap
  // test below confines them to the chosen slot's interval, so no separate
  // same-day filter is needed.
  private get relevantMeetings(): Meeting[] {
    let ids = this.selectedInterviewerIds;
    if (!ids.length) {
      return [];
    }
    return (this.args.meetings ?? []).filter(
      (m) =>
        m.date &&
        (m.interviewers ?? []).some((i) => i?.id && ids.includes(i.id)),
    );
  }

  get slots(): SlotState[] {
    let now = Date.now();
    let meetings = this.relevantMeetings;
    let result: SlotState[] = [];
    for (let hour = WORK_START_HOUR; hour < WORK_END_HOUR; hour++) {
      let start = this.slotStart(hour);
      let label = `${((hour + 11) % 12) + 1}:00 ${hour < 12 ? 'AM' : 'PM'}`;
      if (!start) {
        result.push({ hour, label, free: false, reason: 'Pick a date first' });
        continue;
      }
      let startMs = start.getTime();
      let endMs = startMs + SLOT_MINUTES * 60000;
      if (endMs <= now) {
        result.push({ hour, label, free: false, reason: 'In the past' });
        continue;
      }
      let clash = meetings.find((m) => {
        let mStart = new Date(m.date!).getTime();
        if (isNaN(mStart)) {
          return false;
        }
        let mEnd = mStart + durationMs(m.duration);
        return startMs < mEnd && mStart < endMs;
      });
      if (clash) {
        result.push({
          hour,
          label,
          free: false,
          reason: `Booked: ${clash.title ?? 'Meeting'}`,
        });
      } else {
        result.push({ hour, label, free: true });
      }
    }
    return result;
  }

  get freeSlotCount(): number {
    return this.slots.filter((s) => s.free).length;
  }

  get selectedSlotState(): SlotState | undefined {
    return this.slots.find((s) => s.hour === this.selectedHour);
  }

  // Busy slots stay selectable — the picker STEERS toward free slots but the
  // COMMAND is the enforcement point (it throws a named conflict, surfaced
  // below with the override). Only past slots are hard-disabled: there is no
  // legitimate "book it anyway" for a time that has already gone by.
  get canConfirm(): boolean {
    let slot = this.selectedSlotState;
    return Boolean(
      !this.args.isRunning &&
      this.selectedInterviewers.length &&
      slot &&
      slot.reason !== 'In the past',
    );
  }

  private buildConfirm(ignoreConflicts: boolean) {
    if (this.selectedHour == null) {
      return;
    }
    let date = this.slotStart(this.selectedHour);
    if (!date) {
      return;
    }
    this.args.onConfirm({
      date,
      interviewers: this.selectedInterviewers,
      roundType: this.roundType,
      ignoreConflicts,
    });
  }

  confirm = () => {
    if (!this.canConfirm) {
      return;
    }
    this.buildConfirm(false);
  };

  // Deliberate human override after the command reported a conflict — the
  // same escape hatch as the command's own `ignoreConflicts` input.
  confirmOverride = () => {
    if (this.args.isRunning || !this.selectedInterviewers.length) {
      return;
    }
    this.buildConfirm(true);
  };

  get title(): string {
    return this.args.candidate?.name
      ? `Schedule interview — ${this.args.candidate.name}`
      : 'Schedule interview';
  }

  <template>
    <Popover
      @anchor='.tracker'
      @open={{true}}
      @kind='edit'
      @anchoring='center'
      @size='auto'
      @backdrop='dim'
      @trapFocus={{true}}
      @label={{this.title}}
      @onDismiss={{@onCancel}}
    >
      <:edit>
        <div class='schedule-dialog'>
          <div class='sd-head'>
            <h2 class='sd-title'>{{this.title}}</h2>
            <button
              type='button'
              class='sd-close'
              aria-label='Close'
              {{on 'click' @onCancel}}
            >✕</button>
          </div>
          <div class='sd-body'>
            <p class='sd-sub'>Pick interviewers, a day, and a free slot — slots
              already booked for the chosen interviewers are disabled.</p>

            <div class='sd-field'>
              <span
                class='sd-label'
                id='sd-interviewers-label'
              >Interviewers</span>
              <div
                class='sd-toggle-row'
                role='group'
                aria-labelledby='sd-interviewers-label'
              >
                {{#each this.availableEmployees key='id' as |employee|}}
                  <Button
                    type='button'
                    @kind='default'
                    @size='auto'
                    class='sd-toggle-btn'
                    aria-pressed={{if
                      (this.isInterviewerSelected employee)
                      'true'
                      'false'
                    }}
                    {{on 'click' (fn this.toggleInterviewer employee)}}
                  >{{employee.name}}</Button>
                {{/each}}
              </div>
            </div>

            <div class='sd-field'>
              <span class='sd-label' id='sd-round-label'>Round</span>
              <div
                class='sd-toggle-row'
                role='group'
                aria-labelledby='sd-round-label'
              >
                {{#each this.roundTypeOptions as |option|}}
                  <Button
                    type='button'
                    @kind='default'
                    @size='auto'
                    class='sd-toggle-btn'
                    aria-pressed={{if
                      (eq this.roundType option.value)
                      'true'
                      'false'
                    }}
                    {{on 'click' (fn this.setRoundType option.value)}}
                  >{{option.label}}</Button>
                {{/each}}
              </div>
            </div>

            <div class='sd-field'>
              <label class='sd-label' for='sd-date'>Date</label>
              <BoxelInput
                id='sd-date'
                class='sd-date'
                @type='date'
                @value={{this.dateStr}}
                @onInput={{this.setDate}}
              />
            </div>

            <div class='sd-field'>
              <span class='sd-label' id='sd-slots-label'>
                Time
                {{#if this.selectedInterviewers.length}}
                  ·
                  {{this.freeSlotCount}}
                  of
                  {{this.slots.length}}
                  slots free
                {{else}}
                  · pick interviewers to see availability
                {{/if}}
              </span>
              <div
                class='sd-slot-row'
                role='group'
                aria-labelledby='sd-slots-label'
              >
                {{#each this.slots key='hour' as |slot|}}
                  <Button
                    type='button'
                    @kind='default'
                    @size='auto'
                    class='sd-slot-btn {{unless slot.free "busy"}}'
                    aria-pressed={{if
                      (eq this.selectedHour slot.hour)
                      'true'
                      'false'
                    }}
                    @disabled={{eq slot.reason 'In the past'}}
                    title={{slot.reason}}
                    {{on 'click' (fn this.setSlot slot.hour)}}
                  >{{slot.label}}</Button>
                {{/each}}
              </div>
            </div>

            {{#if @error}}
              <p class='sd-error' role='alert'>{{@error}}</p>
            {{/if}}
          </div>
          <div class='sd-actions'>
            <Button
              @kind='secondary'
              @disabled={{@isRunning}}
              {{on 'click' @onCancel}}
            >Cancel</Button>
            {{#if @error}}
              <Button
                @kind='secondary'
                class='sd-override'
                @disabled={{@isRunning}}
                {{on 'click' this.confirmOverride}}
              >Book anyway (override)</Button>
            {{/if}}
            <Button
              @kind='primary'
              @disabled={{not this.canConfirm}}
              @loading={{@isRunning}}
              {{on 'click' this.confirm}}
            >{{if @isRunning 'Scheduling…' 'Schedule'}}</Button>
          </div>
        </div>
      </:edit>
    </Popover>
    <style scoped>
      .schedule-dialog {
        display: flex;
        flex-direction: column;
        /* @size='auto' on the Popover carries NO width/height rules of its
           own (verified against the component's stylesheet) — so this box
           is the only size authority. A competing cap from a bigger preset
           (e.g. 'spacious') would fight this one and produce a nested
           double-scroll where neither the header nor the footer visibly
           pin to anything. */
        width: min(34rem, calc(100vw - 3rem));
        max-height: min(34rem, calc(100vh - 6rem));
        background: var(--card, var(--boxel-light));
        color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .sd-head {
        flex: none;
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        background: var(--card, var(--boxel-light));
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .sd-close {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.875rem;
        height: 1.875rem;
        border-radius: 50%;
        border: 1px solid var(--border, var(--boxel-200));
        background: var(--card, var(--boxel-light));
        color: var(--muted-foreground, var(--boxel-450));
        font-size: 0.75rem;
        line-height: 1;
        cursor: pointer;
        transition:
          border-color 0.15s ease-out,
          color 0.15s ease-out;
      }
      .sd-close:hover {
        border-color: var(--accent-c, var(--primary, var(--boxel-highlight)));
        color: var(--accent-c, var(--primary, var(--boxel-highlight)));
      }
      .sd-close:focus-visible {
        outline: 2px solid
          var(--accent-c, var(--primary, var(--boxel-highlight)));
        outline-offset: 2px;
      }
      .sd-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
      }
      .sd-title {
        margin: 0;
        font-size: var(--boxel-font-size-lg);
        font-weight: 700;
      }
      .sd-sub {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground, var(--boxel-450));
      }
      .sd-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .sd-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .sd-date {
        max-width: 14rem;
      }
      .sd-toggle-row,
      .sd-slot-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-4xs);
      }
      .sd-toggle-btn,
      .sd-slot-btn {
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: 1.75rem;
        --boxel-button-min-width: 0;
        font-size: var(--boxel-font-size-xs);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm);
        background: var(--card, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
      }
      .sd-toggle-btn[aria-pressed='true'],
      .sd-slot-btn[aria-pressed='true'] {
        background: var(--primary, var(--boxel-dark));
        color: var(--primary-foreground, var(--boxel-light));
        border-color: var(--primary, var(--boxel-dark));
      }
      .sd-slot-btn.busy {
        text-decoration: line-through;
        color: var(--muted-foreground, var(--boxel-450));
        background: var(--muted, var(--boxel-100));
      }
      .sd-error {
        margin: 0;
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-sm);
        font-size: var(--boxel-font-size-sm);
        background: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 12%,
          transparent
        );
        color: var(--destructive, var(--boxel-danger));
      }
      .sd-actions {
        flex: none;
        position: sticky;
        bottom: 0;
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        background: var(--card, var(--boxel-light));
        border-top: 1px solid var(--border, var(--boxel-200));
      }
    </style>
  </template>
}
