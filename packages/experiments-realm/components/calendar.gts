import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { eq, gt } from '@cardstack/boxel-ui/helpers';

import {
  monthGrid,
  monthTitle,
  sameDay,
  stateColorOf,
  type CalendarDay,
} from '../utils/index';
import { MEETING_TYPE_COLORS } from '../meeting';

export interface CalendarEvent {
  id?: string;
  title: string;
  date: Date;
  kind?: string;
}

interface CalendarSignature {
  Args: {
    events: CalendarEvent[];
    onSelectEvent?: (event: CalendarEvent) => void;
    onRescheduleEvent?: (event: CalendarEvent, newDate: Date) => void;
    onAddMeeting?: (date: Date) => void;
  };
  Element: HTMLElement;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

// Month-grid scheduling calendar. Hand-rolled because npm calendar libraries
// are not loadable from realm modules.
export class Calendar extends GlimmerComponent<CalendarSignature> {
  weekdays = WEEKDAYS;

  @tracked cursor = new Date();
  @tracked isTransitioning = false;
  @tracked draggingEvent: CalendarEvent | undefined;
  @tracked dragOverKey: string | undefined;

  get weeks(): CalendarDay[][] {
    return monthGrid(this.cursor);
  }

  get monthTitle(): string {
    return monthTitle(this.cursor);
  }

  // Chronological within the cell, so a day reads top-to-bottom as a schedule.
  // Events with no time of day fall back to the incoming order.
  eventsOn = (day: CalendarDay): CalendarEvent[] => {
    return (this.args.events ?? [])
      .filter((event) => event.date && sameDay(new Date(event.date), day.date))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  chipsFor = (day: CalendarDay): CalendarEvent[] => {
    return this.eventsOn(day).slice(0, MAX_CHIPS);
  };

  overflowCount = (day: CalendarDay): number => {
    return Math.max(0, this.eventsOn(day).length - MAX_CHIPS);
  };

  chipStyle = (event: CalendarEvent) => {
    let color = stateColorOf(MEETING_TYPE_COLORS, event.kind);
    return htmlSafe(`background: ${color.bg}; color: ${color.fg};`);
  };

  private animateTransition() {
    this.isTransitioning = true;
    setTimeout(() => {
      this.isTransitioning = false;
    }, 200);
  }

  shiftMonth = (delta: number) => {
    this.animateTransition();
    this.cursor = new Date(
      this.cursor.getFullYear(),
      this.cursor.getMonth() + delta,
      1,
    );
  };

  goToday = () => {
    this.animateTransition();
    this.cursor = new Date();
  };

  selectEvent = (event: CalendarEvent) => {
    this.args.onSelectEvent?.(event);
  };

  dayKey = (day: CalendarDay): string => day.date.toDateString();

  startDrag = (event: CalendarEvent, e: DragEvent) => {
    this.draggingEvent = event;
    e.dataTransfer?.setData('text/plain', event.id ?? '');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  endDrag = () => {
    this.draggingEvent = undefined;
    this.dragOverKey = undefined;
  };

  dragEnterDay = (day: CalendarDay, e: DragEvent) => {
    e.preventDefault();
    if (this.draggingEvent) {
      this.dragOverKey = this.dayKey(day);
    }
  };

  dragOverDay = (e: DragEvent) => {
    e.preventDefault();
  };

  dropOnDay = (day: CalendarDay, e: DragEvent) => {
    e.preventDefault();
    let event = this.draggingEvent;
    this.draggingEvent = undefined;
    this.dragOverKey = undefined;
    if (!event) {
      return;
    }
    this.args.onRescheduleEvent?.(event, day.date);
  };

  addMeetingOn = (day: CalendarDay) => {
    this.args.onAddMeeting?.(day.date);
  };

  <template>
    <div class='calendar' ...attributes>
      <header class='calendar-toolbar'>
        <h3 class='calendar-title'>{{this.monthTitle}}</h3>
        <div class='calendar-nav'>
          <button
            type='button'
            aria-label='Previous month'
            {{on 'click' (fn this.shiftMonth -1)}}
          >‹</button>
          <button type='button' {{on 'click' this.goToday}}>Today</button>
          <button
            type='button'
            aria-label='Next month'
            {{on 'click' (fn this.shiftMonth 1)}}
          >›</button>
        </div>
      </header>
      <table class='calendar-grid {{if this.isTransitioning "fading"}}'>
        <thead>
          <tr>
            {{#each this.weekdays as |day|}}
              <th scope='col'>{{day}}</th>
            {{/each}}
          </tr>
        </thead>
        <tbody>
          {{#each this.weeks as |week|}}
            <tr>
              {{#each week as |day|}}
                <td
                  class='day
                    {{unless day.inMonth "out-month"}}
                    {{if day.isToday "today"}}
                    {{if (eq (this.dayKey day) this.dragOverKey) "drag-over"}}'
                  {{on 'dragenter' (fn this.dragEnterDay day)}}
                  {{on 'dragover' this.dragOverDay}}
                  {{on 'drop' (fn this.dropOnDay day)}}
                >
                  <div class='day-head'>
                    <span class='day-number'>{{day.dayNumber}}</span>
                    <button
                      type='button'
                      class='add-meeting'
                      aria-label='Add meeting'
                      title='Add meeting'
                      {{on 'click' (fn this.addMeetingOn day)}}
                    >+</button>
                  </div>
                  <div class='day-events'>
                    {{#each (this.chipsFor day) as |event|}}
                      <button
                        type='button'
                        class='event-chip'
                        style={{this.chipStyle event}}
                        title={{event.title}}
                        draggable='true'
                        {{on 'click' (fn this.selectEvent event)}}
                        {{on 'dragstart' (fn this.startDrag event)}}
                        {{on 'dragend' this.endDrag}}
                      >{{event.title}}</button>
                    {{/each}}
                    {{#if (gt (this.overflowCount day) 0)}}
                      <span class='overflow'>+{{this.overflowCount day}}
                        more</span>
                    {{/if}}
                  </div>
                </td>
              {{/each}}
            </tr>
          {{/each}}
        </tbody>
      </table>
    </div>
    <style scoped>
      .calendar {
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--font-sans, var(--boxel-font-family));
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .calendar-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .calendar-title {
        margin: 0;
        font-size: var(--boxel-font-size);
      }
      .calendar-nav {
        display: flex;
        gap: var(--boxel-sp-4xs);
      }
      .calendar-nav button {
        border: 1px solid var(--border, var(--boxel-200));
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        border-radius: var(--boxel-border-radius-sm);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        cursor: pointer;
        font-size: var(--boxel-font-size-sm);
        transition: background-color 0.15s ease-out;
      }
      .calendar-nav button:hover {
        background: var(--muted, var(--boxel-100));
      }
      .calendar-grid {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        transition: opacity 0.2s ease-out;
      }
      .calendar-grid.fading {
        opacity: 0.3;
      }
      @media (prefers-reduced-motion: reduce) {
        .calendar-grid {
          transition: none;
        }
        .calendar-grid.fading {
          opacity: 1;
        }
      }
      th {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted-foreground, var(--boxel-450));
        padding: var(--boxel-sp-4xs);
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .day {
        vertical-align: top;
        height: 5.75rem;
        padding: var(--boxel-sp-5xs);
        border: 1px solid var(--border, var(--boxel-100));
        transition: background-color 0.15s ease-out;
      }
      .day:hover {
        background: var(--muted, var(--boxel-100));
      }
      .day:hover .add-meeting {
        opacity: 1;
      }
      .day.drag-over {
        background: color-mix(
          in srgb,
          var(--primary, var(--boxel-highlight)) 12%,
          var(--background, var(--boxel-light))
        );
        box-shadow: inset 0 0 0 0.09375rem
          var(--primary, var(--boxel-highlight));
      }
      .day-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-4xs);
      }
      .day-number {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .add-meeting {
        border: none;
        background: none;
        color: var(--muted-foreground, var(--boxel-450));
        font-size: var(--boxel-font-size-sm);
        line-height: 1;
        padding: 0 var(--boxel-sp-5xs);
        cursor: pointer;
        opacity: 0;
        transition:
          opacity 0.15s ease-out,
          color 0.15s ease-out;
      }
      .add-meeting:hover {
        color: var(--primary, var(--boxel-highlight));
      }
      @media (prefers-reduced-motion: reduce) {
        .add-meeting {
          transition: none;
        }
      }
      .out-month .day-number {
        color: var(--muted-foreground, var(--boxel-300));
        font-weight: 400;
      }
      .today {
        background: color-mix(
          in srgb,
          var(--primary, var(--boxel-highlight)) 8%,
          var(--background, var(--boxel-light))
        );
        box-shadow: inset 0 0 0 0.09375rem
          var(--primary, var(--boxel-highlight));
      }
      .today:hover {
        background: color-mix(
          in srgb,
          var(--primary, var(--boxel-highlight)) 14%,
          var(--background, var(--boxel-light))
        );
      }
      .today .day-number {
        color: var(--primary, var(--boxel-highlight));
      }
      .day-events {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        margin-top: 0.125rem;
      }
      .event-chip {
        display: block;
        width: 100%;
        border: none;
        text-align: left;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.3;
        padding: 1px var(--boxel-sp-5xs);
        border-radius: var(--boxel-border-radius-sm);
        cursor: grab;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: filter 0.15s ease-out;
      }
      .event-chip:hover {
        filter: brightness(0.95);
      }
      .event-chip:active {
        cursor: grabbing;
      }
      .overflow {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}
