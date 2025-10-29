// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  Component,
  realmURL,
  linksTo,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import DatetimeField from 'https://cardstack.com/base/datetime';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { Button } from '@cardstack/boxel-ui/components'; // ² UI components
import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { htmlSafe } from '@ember/template';
import { eq, lt, gt, subtract } from '@cardstack/boxel-ui/helpers';
import { cached } from '@glimmer/tracking';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common';
import type Owner from '@ember/owner';

// Simple date formatting helper for calendar
function formatCalendarDate(
  date: Date | string | number | null | undefined,
  format?: string,
): string {
  if (!date) return '';

  let parsedDate: Date;

  if (typeof date === 'string') {
    parsedDate = new Date(date);
  } else if (typeof date === 'number') {
    parsedDate = new Date(date);
  } else if (date instanceof Date) {
    parsedDate = date;
  } else {
    return '';
  }

  if (isNaN(parsedDate.getTime())) {
    return '';
  }

  // Simple format options
  switch (format) {
    case 'short':
      return parsedDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    case 'long':
      return parsedDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    case 'time':
      return parsedDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    case '24h':
      return parsedDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    case 'month':
      return parsedDate.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });
    case 'day':
      return parsedDate.toLocaleDateString('en-US', { weekday: 'short' });
    default:
      return parsedDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
  }
}

// ³ Calendar Event card definition
export class CalendarEvent extends CardDef {
  static displayName = 'Calendar Event';
  static icon = CalendarIcon;

  @field title = contains(StringField); // ⁴ Event details
  @field description = contains(TextAreaField);
  @field startTime = contains(DatetimeField);
  @field endTime = contains(DatetimeField);
  @field location = contains(StringField);
  @field isAllDay = contains(StringField); // "true" or "false"
  @field eventType = contains(StringField); // meeting, appointment, reminder, etc.
  @field eventColor = contains(StringField); // hex color
  @field calendar = linksTo(() => CalendarCard); // ²² Link to parent calendar

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='calendar-event'>
        <div class='event-time'>
          {{#if @model.isAllDay}}
            All Day
          {{else}}
            {{formatCalendarDate @model.startTime 'time'}}
            {{#if @model.endTime}}
              -
              {{formatCalendarDate @model.endTime 'time'}}
            {{/if}}
          {{/if}}
        </div>
        <div class='event-title'>{{if
            @model.title
            @model.title
            'Untitled Event'
          }}</div>
        {{#if @model.location}}
          <div class='event-location'>📍 {{@model.location}}</div>
        {{/if}}
      </div>

      <style scoped>
        .calendar-event {
          padding: 0.5rem;
          border-radius: 4px;
          border-left: 3px solid var(--event-color, #3b82f6);
          background: rgba(59, 130, 246, 0.1);
        }

        .event-time {
          font-size: 0.75rem;
          color: #6b7280;
          margin-bottom: 0.25rem;
        }

        .event-title {
          font-size: 0.875rem;
          font-weight: 500;
          color: #1f2937;
          margin-bottom: 0.25rem;
        }

        .event-location {
          font-size: 0.75rem;
          color: #6b7280;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='event-badge'>
            <div class='event-time'>{{if
                @model.isAllDay
                'All Day'
                (formatCalendarDate @model.startTime 'time')
              }}</div>
            <div class='event-title'>{{if
                @model.title
                @model.title
                'Event'
              }}</div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='event-strip'>
            <span class='time'>{{if
                @model.isAllDay
                'All Day'
                (formatCalendarDate @model.startTime 'time')
              }}</span>
            <span class='title'>{{if
                @model.title
                @model.title
                'Untitled Event'
              }}</span>
            {{#if @model.location}}<span class='location'>📍
                {{@model.location}}</span>{{/if}}
          </div>
        </div>

        <div class='tile-format'>
          <div class='event-tile'>
            <div class='tile-header'>
              <span class='event-type'>{{if
                  @model.eventType
                  @model.eventType
                  'Event'
                }}</span>
              <span class='event-time'>{{if
                  @model.isAllDay
                  'All Day'
                  (formatCalendarDate @model.startTime 'time')
                }}</span>
            </div>
            <div class='tile-title'>{{if
                @model.title
                @model.title
                'Untitled Event'
              }}</div>
            {{#if @model.location}}<div class='tile-location'>📍
                {{@model.location}}</div>{{/if}}
            {{#if @model.description}}<div
                class='tile-desc'
              >{{@model.description}}</div>{{/if}}
          </div>
        </div>

        <div class='card-format'>
          <div class='event-card'>
            <div class='card-header'>
              <div class='event-time'>{{if
                  @model.isAllDay
                  'All Day'
                  (formatCalendarDate @model.startTime 'time')
                }}</div>
              <div class='event-type'>{{if
                  @model.eventType
                  @model.eventType
                  'Event'
                }}</div>
            </div>
            <div class='card-title'>{{if
                @model.title
                @model.title
                'Untitled Event'
              }}</div>
            {{#if @model.location}}<div class='card-location'>📍
                {{@model.location}}</div>{{/if}}
            {{#if @model.description}}<div
                class='card-description'
              >{{@model.description}}</div>{{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family: 'Inter', sans-serif;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }

        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
          }
        }

        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
          }
        }

        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        /* Badge Format */
        .event-badge {
          display: flex;
          flex-direction: column;
          justify-content: center;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, #10b981, #059669);
          color: white;
          border-radius: 6px;
          padding: 0.5rem;
          text-align: center;
        }

        .event-badge .event-time {
          font-size: 0.625rem;
          opacity: 0.9;
          margin-bottom: 0.25rem;
        }

        .event-badge .event-title {
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1;
        }

        /* Strip Format */
        .event-strip {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-left: 3px solid #10b981;
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
        }

        .event-strip .time {
          font-size: 0.6875rem;
          color: #6b7280;
          font-weight: 500;
        }

        .event-strip .title {
          font-size: 0.8125rem;
          font-weight: 600;
          color: #1f2937;
          flex: 1;
        }

        .event-strip .location {
          font-size: 0.6875rem;
          color: #6b7280;
        }

        /* Tile Format */
        .event-tile {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-left: 4px solid #10b981;
          border-radius: 8px;
          padding: 1rem;
        }

        .tile-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .event-type {
          font-size: 0.6875rem;
          color: #10b981;
          font-weight: 500;
          text-transform: uppercase;
        }

        .tile-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 0.5rem;
        }

        .tile-location,
        .tile-desc {
          font-size: 0.75rem;
          color: #6b7280;
          margin-bottom: 0.25rem;
        }

        .tile-desc {
          line-height: 1.3;
          -webkit-line-clamp: 2;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* Card Format */
        .event-card {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-left: 4px solid #10b981;
          border-radius: 8px;
          padding: 1.25rem;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .card-title {
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 0.75rem;
        }

        .card-location,
        .card-description {
          font-size: 0.8125rem;
          color: #6b7280;
          margin-bottom: 0.5rem;
        }

        .card-description {
          line-height: 1.4;
        }
      </style>
    </template>
  };
}

class CalendarIsolated extends Component<typeof CalendarCard> {
  // ¹¹ Isolated format with event management
  @tracked currentDate = new Date();
  @tracked viewMode = 'month';
  @tracked showEventForm = false;
  @tracked editingEvent: any = null;
  @tracked showMoreEventsFor: any = null;
  @tracked hoveredDate: Date | null = null;
  @tracked newEventTitle = '';
  @tracked newEventDescription = '';
  @tracked newEventStartTime = '';
  @tracked newEventEndTime = '';
  @tracked newEventLocation = '';
  @tracked newEventIsAllDay = false;
  @tracked newEventType = 'meeting';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    // ¹² Initialize from model data
    if (this.args.model?.month && this.args.model?.year) {
      this.currentDate = new Date(
        this.args.model.year,
        this.args.model.month - 1,
        1,
      );
    }
    if (this.args.model?.viewMode) {
      this.viewMode = this.args.model.viewMode;
    }
  }

  get currentMonth() {
    return this.currentDate.getMonth();
  }

  get currentYear() {
    return this.currentDate.getFullYear();
  }

  get monthName() {
    return this.currentDate.toLocaleDateString('en-US', { month: 'long' });
  }

  // ²⁴ Use getCards to query events for this calendar
  eventsResult = this.args.context?.getCards(
    this,
    () => this.args.model?.eventsQuery,
    () => this.args.model?.realmHrefs,
    { isLive: true },
  );

  // ²⁵ Dynamic event checking using queried events - cached to prevent infinite renders
  @cached
  get eventsOnDate() {
    const events = (this.eventsResult?.instances as CalendarEvent[]) || [];
    const eventMap = new Map();

    events.forEach((event) => {
      if (event?.startTime) {
        const eventDate = new Date(event.startTime);
        const dateKey = `${eventDate.getFullYear()}-${
          eventDate.getMonth() + 1
        }-${eventDate.getDate()}`;
        if (!eventMap.has(dateKey)) {
          eventMap.set(dateKey, []);
        }
        eventMap.get(dateKey).push(event);
      }
    });

    return eventMap;
  }

  // Helper method for template - returns cached array for specific date
  getEventsForDate = (date: Date) => {
    const dateKey = `${date.getFullYear()}-${
      date.getMonth() + 1
    }-${date.getDate()}`;

    return this.eventsOnDate.get(dateKey) || [];
  };

  // ¹⁵ Get events for the currently selected day in day view
  get todaysEvents() {
    return this.getEventsForDate(this.currentDate);
  }

  // ¹⁶ Get events for current week (for week view) - improved with proper week calculation
  get weekEvents() {
    const weekStart = new Date(this.currentDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const events = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      const dayEvents = this.getEventsForDate(date);

      // Add day reference to each event for positioning
      dayEvents.forEach((event: any) => {
        event._weekDay = i;
        event._date = new Date(date);
      });

      events.push(...dayEvents);
    }

    return events.sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
      return timeA - timeB;
    });
  }

  // ³⁶ Get current week days for week view
  get currentWeekDays() {
    const weekStart = new Date(this.currentDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);

      days.push({
        date: new Date(date),
        day: date.getDate(),
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        isToday: this.isSameDay(date, new Date()),
        events: this.getEventsForDate(date),
      });
    }

    return days;
  }

  // ³⁷ Generate time slots for week view (24-hour format)
  get timeSlots() {
    const slots = [];
    for (let hour = 0; hour < 24; hour++) {
      const time = new Date();
      time.setHours(hour, 0, 0, 0);

      slots.push({
        hour,
        timeLabel: time.toLocaleTimeString('en-US', {
          hour: 'numeric',
          hour12: false,
        }),
        displayLabel: time.toLocaleTimeString('en-US', {
          hour: 'numeric',
          hour12: true,
        }),
      });
    }
    return slots;
  }

  // ³⁸ Get events for a specific hour across all days
  getEventsForHour(hour: number) {
    return this.weekEvents.filter((event) => {
      if (!event.startTime) return false;
      const eventTime = new Date(event.startTime);
      return eventTime.getHours() === hour;
    });
  }

  // Helper to check if event starts at specific hour
  eventStartsAtHour(event: any, hour: number): boolean {
    if (!event?.startTime) return false;
    const eventTime = new Date(event.startTime);
    return eventTime.getHours() === hour;
  }

  get realmURL(): URL {
    return this.args.model[realmURL]!;
  }

  @cached
  get calendarDays() {
    // ⁷ Calendar day calculation with cached events
    const year = this.currentYear;
    const month = this.currentMonth;
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const days = [];
    const currentDate = new Date(startDate);

    for (let i = 0; i < 42; i++) {
      const dayEvents = this.getEventsForDate(currentDate);
      days.push({
        date: new Date(currentDate),
        day: currentDate.getDate(),
        isCurrentMonth: currentDate.getMonth() === month,
        isToday: this.isSameDay(currentDate, new Date()),

        hasEvents: dayEvents.length > 0,
        events: dayEvents as CalendarEvent[], // Include events array for each day
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return days;
  }

  isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  hasEventsOnDate(date: Date): boolean {
    // ⁸ Dynamic event detection using real events
    return this.getEventsForDate(date).length > 0;
  }

  @action
  previousMonth() {
    this.currentDate = new Date(this.currentYear, this.currentMonth - 1, 1);
    this.updateModelState(); // ¹ʰ Persist state changes
  }

  @action
  nextMonth() {
    this.currentDate = new Date(this.currentYear, this.currentMonth + 1, 1);
    this.updateModelState(); // ¹ʰ Persist state changes
  }

  @action
  previousWeek() {
    // Move to previous week
    const prevWeek = new Date(this.currentDate);
    prevWeek.setDate(prevWeek.getDate() - 7);
    this.currentDate = prevWeek;
    this.updateModelState();
  }

  @action
  nextWeek() {
    // Move to next week
    const nextWeek = new Date(this.currentDate);
    nextWeek.setDate(nextWeek.getDate() + 7);
    this.currentDate = nextWeek;
    this.updateModelState();
  }

  // ³⁹ Week date range display
  get weekDateRange() {
    const weekStart = new Date(this.currentDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const startMonth = weekStart.toLocaleDateString('en-US', {
      month: 'short',
    });
    const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });
    const year = weekStart.getFullYear();

    if (startMonth === endMonth) {
      return `${startMonth} ${weekStart.getDate()}-${weekEnd.getDate()}, ${year}`;
    } else {
      return `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${year}`;
    }
  }

  @action
  selectDate(day: any) {
    // Just show day view when clicking a date
    this.viewMode = 'day';
    // Set the current date to the clicked day for day view
    this.currentDate = new Date(
      day.date.getFullYear(),
      day.date.getMonth(),
      day.date.getDate(),
    );
    this.updateModelState();
  }

  @action
  previousDay() {
    const prevDay = new Date(this.currentDate);
    prevDay.setDate(prevDay.getDate() - 1);
    this.currentDate = prevDay;
    this.updateModelState();
  }

  @action
  nextDay() {
    const nextDay = new Date(this.currentDate);
    nextDay.setDate(nextDay.getDate() + 1);
    this.currentDate = nextDay;
    this.updateModelState();
  }

  @action
  setViewMode(mode: string) {
    this.viewMode = mode;
    this.updateModelState(); // ¹⁷ Persist state changes
  }

  private _addEvent = restartableTask(async () => {
    const calendarEventSource = {
      module: new URL(import.meta.url).href,
      name: 'CalendarEvent',
    };

    // Use the current date being viewed, not today's date
    const eventDate = new Date(this.currentDate);
    eventDate.setHours(9, 0, 0, 0); // Default to 9 AM
    const endDate = new Date(eventDate);
    endDate.setHours(10, 0, 0, 0); // Default to 10 AM (1 hour duration)

    const doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          title: 'New Event',
          startTime: eventDate.toISOString(),
          endTime: endDate.toISOString(),
          eventType: 'meeting',
          isAllDay: 'false',
        },
        relationships: {
          calendar: {
            links: {
              self: this.args.model.id ?? null,
            },
          },
        },
        meta: {
          adoptsFrom: calendarEventSource,
        },
      },
    };

    try {
      await this.args.createCard?.(
        calendarEventSource,
        new URL(calendarEventSource.module),
        {
          realmURL: this.realmURL,
          doc,
        },
      );
    } catch (error) {
      console.error('CalendarCard: Error creating event', error);
    }
  });

  addEvent = () => {
    this._addEvent.perform();
  };

  @action
  editEvent(event: any) {
    // Open event card for editing
    if (event && this.args.viewCard) {
      this.args.viewCard(event, 'edit');
    }
  }

  @action
  showMoreEvents(day: any) {
    this.showMoreEventsFor = day;
  }

  @action
  closeMoreEvents() {
    this.showMoreEventsFor = null;
  }

  @action
  onDateHover(day: any) {
    this.hoveredDate = day.date;
  }

  @action
  onDateLeave() {
    this.hoveredDate = null;
  }

  @action
  handleEventClick(event: any, clickEvent: Event) {
    if (clickEvent) {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
      clickEvent.stopImmediatePropagation();
    }
    this.editEvent(event);
  }

  @action
  handleMoreEventsClick(day: any, clickEvent: Event) {
    if (clickEvent) {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
      clickEvent.stopImmediatePropagation();
    }
    this.showMoreEvents(day);
  }

  resetEventForm() {
    this.newEventTitle = '';
    this.newEventDescription = '';
    this.newEventStartTime = '';
    this.newEventEndTime = '';
    this.newEventLocation = '';
    this.newEventIsAllDay = false;
    this.newEventType = 'meeting';
  }

  getEventTypeColor(type: string): string {
    const colors = {
      meeting: '#3b82f6',
      appointment: '#10b981',
      reminder: '#f59e0b',
      task: '#8b5cf6',
      personal: '#ef4444',
      work: '#06b6d4',
    };
    return colors[type as keyof typeof colors] || '#3b82f6';
  }

  // ¹⁸ Update model with current state
  updateModelState() {
    if (this.args.model) {
      try {
        this.args.model.month = this.currentDate.getMonth() + 1;
        this.args.model.year = this.currentDate.getFullYear();
        this.args.model.viewMode = this.viewMode;
      } catch (e) {
        console.error('CalendarCard: Error updating model state', e);
      }
    }
  }

  <template>
    <div class='calendar-isolated'>
      <header class='calendar-header'>
        <div class='calendar-title-container'>
          <h1 class='calendar-title'>
            <svg
              class='title-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
              <line x1='16' y1='2' x2='16' y2='6' />
              <line x1='8' y1='2' x2='8' y2='6' />
              <line x1='3' y1='10' x2='21' y2='10' />
            </svg>
            {{if @model.calendarName @model.calendarName 'Calendar'}}
          </h1>

          <div class='header-actions'>
            <Button class='add-event-btn' {{on 'click' this.addEvent}}>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <line x1='12' y1='5' x2='12' y2='19'></line>
                <line x1='5' y1='12' x2='19' y2='12'></line>
              </svg>
              Add Event
            </Button>
          </div>
        </div>

        <div class='calendar-controls'>
          <div class='nav-controls'>
            <Button class='nav-button' {{on 'click' this.previousMonth}}>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <polyline points='15,18 9,12 15,6' />
              </svg>
            </Button>
            <h2 class='month-year'>{{this.monthName}}
              {{this.currentYear}}</h2>
            <Button class='nav-button' {{on 'click' this.nextMonth}}>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <polyline points='9,18 15,12 9,6' />
              </svg>
            </Button>
          </div>

          <div class='view-selector' data-active={{this.viewMode}}>
            <div class='view-selector-background'></div>
            <Button
              class='view-button {{if (eq this.viewMode "month") "active" ""}}'
              {{on 'click' (fn this.setViewMode 'month')}}
            >
              Month
            </Button>
            <Button
              class='view-button {{if (eq this.viewMode "week") "active" ""}}'
              {{on 'click' (fn this.setViewMode 'week')}}
            >
              Week
            </Button>
            <Button
              class='view-button {{if (eq this.viewMode "day") "active" ""}}'
              {{on 'click' (fn this.setViewMode 'day')}}
            >
              Day
            </Button>
          </div>
        </div>
      </header>

      <main class='calendar-content'>
        {{#if (eq this.viewMode 'month')}}
          <div class='calendar-grid'>
            <div class='weekdays'>
              <div class='weekday'>Sun</div>
              <div class='weekday'>Mon</div>
              <div class='weekday'>Tue</div>
              <div class='weekday'>Wed</div>
              <div class='weekday'>Thu</div>
              <div class='weekday'>Fri</div>
              <div class='weekday'>Sat</div>
            </div>

            <div class='days-grid'>
              {{#each this.calendarDays as |day|}}
                <div
                  class='calendar-day
                    {{if day.isCurrentMonth "current-month" "other-month"}}
                    {{if day.isToday "today" ""}}
                    {{if day.hasEvents "has-events" ""}}'
                  role='button'
                  tabindex='0'
                  {{on 'click' (fn this.selectDate day)}}
                  {{on 'mouseenter' (fn this.onDateHover day)}}
                  {{on 'mouseleave' this.onDateLeave}}
                >
                  <span class='day-number'>{{day.day}}</span>
                  {{#if day.hasEvents}}
                    <div class='event-list'>
                      {{#each day.events as |event index|}}
                        {{#if (lt index 2)}}
                          {{! template-lint-disable no-invalid-interactive}}
                          <div
                            class='event-mini'
                            style={{htmlSafe
                              (concat
                                'background-color: '
                                (if
                                  event.eventColor
                                  event.eventColor
                                  'var(--primary, #1a73e8)'
                                )
                              )
                            }}
                            title={{event.title}}
                            {{on 'click' (fn this.handleEventClick event)}}
                          >
                            <span class='event-text'>
                              {{#if event.isAllDay}}
                                {{event.title}}
                              {{else}}
                                <span class='event-time'>{{formatCalendarDate
                                    event.startTime
                                    'time'
                                  }}</span>
                                <span class='event-title'>{{event.title}}</span>
                              {{/if}}
                            </span>
                          </div>
                        {{/if}}
                      {{/each}}
                      {{#if (gt day.events.length 2)}}
                        {{! template-lint-disable no-invalid-interactive}}
                        <div
                          class='event-more'
                          {{on 'click' (fn this.handleMoreEventsClick day)}}
                        >
                          +{{subtract day.events.length 2}}
                          more
                        </div>
                      {{/if}}
                    </div>
                  {{/if}}
                </div>
              {{/each}}
            </div>
          </div>
        {{/if}}

        {{#if (eq this.viewMode 'week')}}
          <div class='week-view'>
            <div class='week-header'>
              <div class='week-nav'>
                <Button class='week-nav-btn' {{on 'click' this.previousWeek}}>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='15,18 9,12 15,6' />
                  </svg>
                </Button>
                <h3 class='week-title'>{{this.weekDateRange}}</h3>
                <Button class='week-nav-btn' {{on 'click' this.nextWeek}}>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='9,18 15,12 9,6' />
                  </svg>
                </Button>
              </div>
            </div>

            <div class='week-days-header'>
              <div class='time-column-header'>Time</div>
              {{#each this.currentWeekDays as |day|}}
                <div class='day-column-header {{if day.isToday "today" ""}}'>
                  <div class='day-name'>{{day.dayName}}</div>
                  <div
                    class='day-number {{if day.isToday "today-date" ""}}'
                  >{{day.day}}</div>
                  <div class='day-event-count'>{{day.events.length}}
                    {{if (eq day.events.length 1) 'event' 'events'}}</div>
                </div>
              {{/each}}
            </div>

            <div class='week-time-grid'>
              {{#each this.timeSlots as |slot|}}
                <div class='time-row'>
                  <div class='time-label'>
                    <span class='hour-label'>{{slot.displayLabel}}</span>
                  </div>

                  {{#each this.currentWeekDays as |day dayIndex|}}
                    <div
                      class='day-hour-cell'
                      data-hour={{slot.hour}}
                      data-day={{dayIndex}}
                    >
                      {{#each day.events as |event|}}
                        {{#if (this.eventStartsAtHour event slot.hour)}}
                          <div
                            class='week-event-block'
                            style={{htmlSafe
                              (concat
                                'background-color: '
                                (if event.eventColor event.eventColor '#3b82f6')
                                '; border-left: 3px solid '
                                (if event.eventColor event.eventColor '#2563eb')
                              )
                            }}
                            role='button'
                            {{on 'click' (fn this.editEvent event)}}
                          >
                            <div class='event-time'>
                              {{formatCalendarDate event.startTime 'time'}}
                              {{#if event.endTime}}
                                -
                                {{formatCalendarDate event.endTime 'time'}}
                              {{/if}}
                            </div>
                            <div class='event-title'>{{if
                                event.title
                                event.title
                                'Untitled Event'
                              }}</div>
                            {{#if event.location}}
                              <div class='event-location'>📍
                                {{event.location}}</div>
                            {{/if}}
                          </div>
                        {{/if}}
                      {{/each}}
                    </div>
                  {{/each}}
                </div>
              {{/each}}
            </div>
          </div>
        {{/if}}

        {{#if (eq this.viewMode 'day')}}
          <div class='day-view'>
            <div class='day-header'>
              <div class='day-nav'>
                <Button class='day-nav-btn' {{on 'click' this.previousDay}}>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='15,18 9,12 15,6' />
                  </svg>
                </Button>
                <div class='day-title-section'>
                  <h3>{{formatCalendarDate this.currentDate 'long'}}</h3>
                  <div class='day-stats'>
                    {{this.todaysEvents.length}}
                    {{if (eq this.todaysEvents.length 1) 'event' 'events'}}
                    scheduled
                  </div>
                </div>
                <Button class='day-nav-btn' {{on 'click' this.nextDay}}>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='9,18 15,12 9,6' />
                  </svg>
                </Button>
              </div>
              <Button class='add-day-event-btn' {{on 'click' this.addEvent}}>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <line x1='12' y1='5' x2='12' y2='19'></line>
                  <line x1='5' y1='12' x2='19' y2='12'></line>
                </svg>
                Add Event
              </Button>
            </div>

            <div class='day-schedule'>
              <div class='day-time-grid'>
                {{#each this.timeSlots as |slot|}}
                  <div class='day-time-row'>
                    <div class='day-time-label'>
                      <span class='hour-label'>{{slot.displayLabel}}</span>
                    </div>

                    <div class='day-hour-cell' data-hour={{slot.hour}}>
                      {{#each this.todaysEvents as |event|}}
                        {{#if (this.eventStartsAtHour event slot.hour)}}
                          <div
                            class='day-event-block'
                            style={{htmlSafe
                              (concat
                                'background-color: '
                                (if
                                  event.eventColor
                                  event.eventColor
                                  'rgba(59, 130, 246, 0.1)'
                                )
                                '; border-left: 3px solid '
                                (if event.eventColor event.eventColor '#3b82f6')
                              )
                            }}
                            role='button'
                            {{on 'click' (fn this.editEvent event)}}
                          >
                            <div class='event-time'>
                              {{formatCalendarDate event.startTime 'time'}}
                              {{#if event.endTime}}
                                -
                                {{formatCalendarDate event.endTime 'time'}}
                              {{/if}}
                            </div>
                            <div class='event-title'>{{if
                                event.title
                                event.title
                                'Untitled Event'
                              }}</div>
                            {{#if event.location}}
                              <div class='event-location'>📍
                                {{event.location}}</div>
                            {{/if}}
                            {{#if event.description}}
                              <div
                                class='event-description'
                              >{{event.description}}</div>
                            {{/if}}
                          </div>
                        {{/if}}
                      {{/each}}
                    </div>
                  </div>
                {{/each}}
              </div>

              {{#if (eq this.todaysEvents.length 0)}}
                <div class='empty-day-overlay'>
                  <div class='empty-icon'>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <rect
                        x='3'
                        y='4'
                        width='18'
                        height='18'
                        rx='2'
                        ry='2'
                      ></rect>
                      <line x1='16' y1='2' x2='16' y2='6'></line>
                      <line x1='8' y1='2' x2='8' y2='6'></line>
                      <line x1='3' y1='10' x2='21' y2='10'></line>
                    </svg>
                  </div>
                  <h4>No events scheduled</h4>
                  <p>This day is free! Click "Add Event" to schedule something.</p>
                  <Button class='add-event-button' {{on 'click' this.addEvent}}>
                    <svg
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <line x1='12' y1='5' x2='12' y2='19'></line>
                      <line x1='5' y1='12' x2='19' y2='12'></line>
                    </svg>
                    Add Your First Event
                  </Button>
                </div>
              {{/if}}
            </div>
          </div>
        {{/if}}
      </main>

      {{#if this.showMoreEventsFor}}
        <div class='more-events-modal'>
          <div
            class='modal-backdrop'
            role='button'
            {{on 'click' this.closeMoreEvents}}
          ></div>
          <div class='modal-content'>
            <div class='modal-header'>
              <h3>{{formatCalendarDate this.showMoreEventsFor.date 'long'}}</h3>
              <button class='close-button' {{on 'click' this.closeMoreEvents}}>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <line x1='18' y1='6' x2='6' y2='18'></line>
                  <line x1='6' y1='6' x2='18' y2='18'></line>
                </svg>
              </button>
            </div>
            <div class='modal-events'>
              {{#each this.showMoreEventsFor.events as |event|}}
                <div
                  class='modal-event'
                  role='button'
                  {{on 'click' (fn this.editEvent event)}}
                >
                  <div class='modal-event-header'>
                    <div class='modal-event-time'>
                      {{#if event.isAllDay}}
                        All Day
                      {{else}}
                        {{formatCalendarDate event.startTime 'time'}}
                        {{#if event.endTime}}
                          -
                          {{formatCalendarDate event.endTime 'time'}}
                        {{/if}}
                      {{/if}}
                    </div>
                    {{#if event.eventType}}
                      <div class='modal-event-type'>{{event.eventType}}</div>
                    {{/if}}
                  </div>

                  <div class='modal-event-title'>{{if
                      event.title
                      event.title
                      'Untitled Event'
                    }}</div>

                  <div class='modal-event-details'>
                    {{#if event.location}}
                      <div class='modal-event-location'>
                        <span class='location-icon' aria-hidden='true'>📍</span>
                        {{event.location}}
                      </div>
                    {{/if}}

                    {{#if event.description}}
                      <div
                        class='modal-event-description'
                      >{{event.description}}</div>
                    {{/if}}
                  </div>
                </div>
              {{/each}}
            </div>
          </div>
        </div>
      {{/if}}

    </div>

    <style scoped>
      /* ¹⁹ Framework-integrated calendar styling */
      .calendar-isolated {
        font-family: var(
          --font-sans,
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif
        );
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--background, #f8fafc);
        color: var(--foreground, #1f2937);
        overflow: hidden;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .add-event-btn {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border: none;
        border-radius: 6px;
        font-size: 0.8125rem;
        font-weight: 500;
        font-family: var(--font-sans, inherit);
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
      }

      .add-event-btn:hover {
        background: var(--primary, #2563eb);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md, 0 4px 6px rgba(0, 0, 0, 0.15));
      }

      .add-event-btn svg {
        width: 0.875rem;
        height: 0.875rem;
      }

      .calendar-header {
        background: linear-gradient(
          135deg,
          var(--card, #ffffff) 0%,
          var(--muted, #f9fafb) 100%
        );
        color: var(--card-foreground, #1f2937);
        border-bottom: 1px solid var(--border, #e5e7eb);
        padding: 1rem 1.5rem;
        flex-shrink: 0;
        backdrop-filter: blur(10px);
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05));
      }

      .calendar-title-container {
        display: flex;
        justify-content: space-between;
      }

      .calendar-title {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 1.25rem;
        font-weight: 600;
        font-family: var(--font-sans, inherit);
        color: var(--card-foreground, #1f2937);
        margin: 0 0 1rem 0;
        letter-spacing: var(--tracking-normal, -0.025em);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      }

      .title-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary, #3b82f6);
        filter: drop-shadow(0 2px 4px rgba(59, 130, 246, 0.2));
      }

      @keyframes subtle-pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.05);
        }
      }

      .calendar-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .nav-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .nav-button {
        width: 2rem;
        height: 2rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #d1d5db);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        color: var(--muted-foreground, #6b7280);
        box-shadow: var(--shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.05));
      }

      .nav-button:hover {
        background: var(--primary, #3b82f6);
        border-color: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        transform: translateY(-1px);
        box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.1));
      }

      .nav-button svg {
        width: 1rem;
        height: 1rem;
      }

      .month-year {
        font-size: 1rem;
        font-weight: 500;
        font-family: var(--font-sans, inherit);
        color: var(--foreground, #1f2937);
        margin: 0;
        min-width: 10rem;
        text-align: center;
        letter-spacing: var(--tracking-normal, 0em);
      }

      .view-selector {
        position: relative;
        display: flex;
        background: var(--muted, #f8f9fa);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 8px;
        padding: 0.125rem;
        gap: 0.0625rem;
        overflow: hidden;
      }

      .view-selector-background {
        position: absolute;
        top: 0.125rem;
        left: 0.125rem;
        bottom: 0.125rem;
        width: calc(33.333% - 0.0625rem);
        background: var(--card, #ffffff);
        border-radius: 6px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 1;
      }

      .view-selector[data-active='week'] .view-selector-background {
        transform: translateX(calc(100% + 0.0625rem));
      }

      .view-selector[data-active='day'] .view-selector-background {
        transform: translateX(calc(200% + 0.125rem));
      }

      .view-button {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.375rem 0.75rem;
        background: none;
        border: none;
        font-size: 0.8125rem;
        font-weight: 500;
        font-family: var(--font-sans, inherit);
        color: var(--muted-foreground, #6b7280);
        cursor: pointer;
        border-radius: 6px;
        transition: color 0.15s ease;
        flex: 1;
        white-space: nowrap;
        min-height: 2rem;
      }

      .view-button:hover:not(.active) {
        color: var(--foreground, #374151);
      }

      .view-button.active {
        color: var(--foreground, #1f2937);
        font-weight: 600;
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        .view-selector-background {
          transition: none;
        }
        .view-button {
          transition: none;
        }
      }

      .calendar-content {
        flex: 1;
        overflow-y: auto;
        padding: 1rem;
      }

      .calendar-grid {
        background: var(--card, #ffffff);
        border-radius: calc(var(--radius, 12px) + 4px);
        border: 1px solid var(--border, #e5e7eb);
        overflow: hidden;
        box-shadow:
          var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.1)),
          0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        backdrop-filter: blur(10px);
        position: relative;
      }

      .calendar-grid::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(59, 130, 246, 0.2),
          transparent
        );
      }

      .weekdays {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        background: linear-gradient(
          135deg,
          var(--muted, #f9fafb) 0%,
          var(--card, #ffffff) 100%
        );
        border-bottom: 1px solid var(--border, #e5e7eb);
        position: relative;
      }

      .weekdays::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent,
          var(--border, #e5e7eb),
          transparent
        );
      }

      .weekday {
        padding: calc(var(--spacing, 0.25rem) * 5);
        text-align: center;
        font-size: 0.875rem;
        font-weight: 600;
        font-family: var(--font-sans, inherit);
        color: var(--muted-foreground, #6b7280);
        letter-spacing: var(--tracking-normal, 0.025em);
        text-transform: uppercase;
        position: relative;
      }

      .weekday::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 20px;
        height: 2px;
        background: var(--primary, #3b82f6);
        border-radius: 1px;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .weekday:hover::after {
        opacity: 0.3;
      }

      .days-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 1px;
        background: var(--border, #e5e7eb);
      }

      .calendar-day {
        position: relative;
        aspect-ratio: 1.2;
        background: var(--card, #ffffff);
        color: var(--card-foreground, #1f2937);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding: 0.5rem 0.375rem;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid var(--border, #dadce0);
        margin: 0;
        overflow: hidden;
      }

      .calendar-day:hover:not(.today) {
        background: var(--accent, #f8f9fa);
        border-color: var(--border, #dadce0);
      }

      .calendar-day:hover:not(.today) .day-number {
        background: var(--accent, #e8f0fe);
        color: var(--primary, #1967d2);
        font-weight: 500;
      }

      .calendar-day.other-month {
        color: var(--muted-foreground, #9aa0a6);
        background: var(--muted, #fafafa);
      }

      .calendar-day.other-month .day-number {
        color: var(--muted-foreground, #9aa0a6);
      }

      .calendar-day.today {
        background: var(--muted, #f1f5f9);
        color: var(--muted-foreground, #475569);
        border: 2px solid var(--accent, #3b82f6);
        box-shadow: var(--shadow-sm, 0 2px 4px rgba(59, 130, 246, 0.1));
      }

      .calendar-day.today .day-number {
        background: var(--primary, #1967d2);
        color: var(--primary-foreground, #ffffff);
        font-weight: 500;
      }

      .event-list {
        width: 100%;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        overflow: hidden;
        padding: 0;
        margin: 0;
      }

      .event-mini {
        flex-shrink: 0;
        background: rgba(59, 130, 246, 0.08);
        color: var(--foreground, #374151);
        border: 1px solid rgba(59, 130, 246, 0.15);
        border-left: 2px solid rgba(59, 130, 246, 0.6);
        border-radius: calc(var(--radius, 3px));
        font-size: 0.5rem;
        font-family: var(--font-sans, inherit);
        line-height: 1.2;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
        padding: 0.125rem 0.25rem;
        margin-bottom: 0.125rem;
      }

      .event-mini:hover {
        background: rgba(59, 130, 246, 0.15);
        border-left-color: rgba(59, 130, 246, 0.8);
        border-color: rgba(59, 130, 246, 0.25);
        transform: translateX(1px);
        box-shadow: 0 2px 4px rgba(59, 130, 246, 0.1);
        color: var(--foreground, #1f2937);
      }

      .event-text {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .event-time {
        font-weight: 600;
        margin-right: 0.25rem;
        color: rgba(59, 130, 246, 0.8);
        font-size: 0.5625rem;
      }

      .event-title {
        font-weight: 500;
        color: var(--foreground, #4b5563);
        font-size: 0.5625rem;
      }

      .event-more {
        background: var(--muted, #f3f4f6);
        color: var(--muted-foreground, #6b7280);
        text-align: center;
        border-radius: calc(var(--radius, 4px));
        font-weight: 500;
        font-size: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid var(--border, #e5e7eb);
      }

      .event-more:hover {
        background: var(--accent, #3b82f6);
        color: var(--accent-foreground, #ffffff);
        transform: translateY(-1px);
        box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.1));
      }

      .calendar-day.other-month .event-dot {
        opacity: 0.3;
      }

      .calendar-day.today .event-dot {
        border-color: rgba(255, 255, 255, 0.9);
      }

      .day-number {
        font-size: 0.75rem;
        font-weight: 400;
        color: var(--foreground, #3c4043);
        width: 1rem;
        height: 1rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s ease;
        margin-bottom: 2px;
      }

      .calendar-day:hover .day-number {
        color: var(--primary, #1967d2);
        font-weight: 500;
      }

      .calendar-day.today .day-number {
        background: var(--primary, #1967d2);
        color: var(--primary-foreground, #ffffff);
        font-weight: 500;
      }

      .week-view {
        background: var(--card, #ffffff);
        border-radius: 12px;
        border: 1px solid var(--border, #e5e7eb);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      /* Week Navigation Header */
      .week-header {
        background: linear-gradient(
          135deg,
          var(--muted, #f8fafc),
          var(--card, #ffffff)
        );
        border-bottom: 1px solid var(--border, #e5e7eb);
        padding: 1rem 1.5rem;
        flex-shrink: 0;
      }

      .week-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        max-width: 400px;
        margin: 0 auto;
      }

      .week-nav-btn {
        width: 2rem;
        height: 2rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #d1d5db);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        color: var(--muted-foreground, #6b7280);
      }

      .week-nav-btn:hover {
        background: var(--primary, #3b82f6);
        border-color: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        transform: translateY(-1px);
      }

      .week-nav-btn svg {
        width: 1rem;
        height: 1rem;
      }

      .week-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        margin: 0;
        text-align: center;
        flex: 1;
      }

      /* Days Header */
      .week-days-header {
        display: grid;
        grid-template-columns: 80px repeat(7, 1fr);
        background: var(--muted, #f9fafb);
        border-bottom: 2px solid var(--border, #e5e7eb);
        position: sticky;
        top: 0;
        z-index: 10;
      }

      .time-column-header {
        padding: 1rem 0.75rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground, #6b7280);
        text-align: center;
        border-right: 1px solid var(--border, #e5e7eb);
        background: var(--muted, #f9fafb);
      }

      .day-column-header {
        text-align: center;
        padding: 1rem 0.5rem;
        border-right: 1px solid var(--border, #e5e7eb);
        transition: background 0.2s ease;
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }

      .day-column-header:last-child {
        border-right: none;
      }

      .day-column-header.today {
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.1),
          rgba(59, 130, 246, 0.05)
        );
        border-bottom: 3px solid var(--primary, #3b82f6);
      }

      .day-name {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        margin-bottom: 0.25rem;
        font-weight: 500;
        width: 1rem;
        height: 1rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        text-transform: uppercase;
        letter-spacing: 0.025em;
        margin-bottom: 2px;
      }

      .day-number.today-date {
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
      }

      .day-event-count {
        font-size: 0.625rem;
        color: var(--muted-foreground, #9ca3af);
        font-weight: 500;
      }

      /* Time Grid */
      .week-time-grid {
        flex: 1;
        overflow-y: auto;
        background: var(--background, #fafafa);
      }

      .time-row {
        display: grid;
        grid-template-columns: 80px repeat(7, 1fr);
        min-height: 3rem;
        border-bottom: 1px solid var(--border, #f1f3f4);
      }

      .time-row:hover {
        background: var(--muted, #f8f9fa);
      }

      .time-label {
        padding: 0.75rem;
        border-right: 1px solid var(--border, #e5e7eb);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        background: var(--card, #ffffff);
        position: sticky;
        left: 0;
        z-index: 5;
      }

      .hour-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        font-weight: 500;
        font-family: var(--font-mono, monospace);
      }

      .day-hour-cell {
        border-right: 1px solid var(--border, #f1f3f4);
        position: relative;
        padding: 0.25rem;
        background: var(--card, #ffffff);
        transition: background 0.15s ease;
        overflow: hidden;
        min-height: 3rem;
      }

      .day-hour-cell:last-child {
        border-right: none;
      }

      .day-hour-cell:hover {
        background: var(--accent, #f0f9ff);
      }

      /* Week Event Blocks */
      .week-event-block {
        background: rgba(59, 130, 246, 0.1);
        border-radius: 4px;
        padding: 0.25rem 0.375rem;
        margin-bottom: 0.125rem;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 0.6875rem;
        position: relative;
        overflow: hidden;
        width: 100%;
        box-sizing: border-box;
        max-width: 100%;
      }

      .week-event-block:hover {
        background: rgba(59, 130, 246, 0.2);
        transform: translateY(-1px);
        box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.1));
      }

      .week-event-block .event-time {
        font-size: 0.5625rem;
        font-weight: 600;
        color: var(--primary, #1e40af);
        margin-bottom: 0.125rem;
        font-family: var(--font-mono, monospace);
        line-height: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .week-event-block .event-title {
        font-weight: 600;
        color: var(--foreground, #1f2937);
        margin-bottom: 0.125rem;
        line-height: 1.1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.625rem;
      }

      .week-event-block .event-location {
        font-size: 0.5625rem;
        color: var(--muted-foreground, #6b7280);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1;
      }

      /* Responsive adjustments */
      @media (max-width: 1024px) {
        .week-days-header {
          grid-template-columns: 60px repeat(7, 1fr);
        }

        .week-time-grid .time-row {
          grid-template-columns: 60px repeat(7, 1fr);
        }

        .time-label {
          padding: 0.5rem 0.25rem;
        }

        .hour-label {
          font-size: 0.625rem;
        }
      }

      @media (max-width: 768px) {
        .week-view {
          border-radius: 8px;
        }

        .week-header {
          padding: 0.75rem 1rem;
        }

        .week-title {
          font-size: 0.875rem;
        }

        .day-column-header {
          padding: 0.75rem 0.25rem;
        }

        .day-name {
          font-size: 0.625rem;
        }

        .day-number {
          font-size: 1rem;
        }
      }

      .delete-event-btn {
        margin-top: 0.5rem;
        padding: 0.25rem 0.5rem;
        background: #ef4444;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 0.75rem;
        cursor: pointer;
      }

      .delete-event-btn:hover {
        background: #dc2626;
      }

      .day-view {
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: calc(var(--radius, 12px));
        overflow: hidden;
        box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.1));
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .day-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        background: linear-gradient(
          135deg,
          var(--muted, #f8fafc),
          var(--card, #ffffff)
        );
        border-bottom: 1px solid var(--border, #e5e7eb);
        flex-shrink: 0;
      }

      .day-nav {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .day-nav-btn {
        width: 2rem;
        height: 2rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #d1d5db);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        color: var(--muted-foreground, #6b7280);
      }

      .day-nav-btn:hover {
        background: var(--primary, #3b82f6);
        border-color: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        transform: translateY(-1px);
      }

      .day-nav-btn svg {
        width: 1rem;
        height: 1rem;
      }

      .day-title-section h3 {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--foreground, #1f2937);
        margin: 0 0 0.25rem 0;
        font-family: var(--font-sans, inherit);
      }

      .day-stats {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
        font-weight: 500;
      }

      .add-day-event-btn {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        padding: calc(var(--spacing, 0.25rem) * 3)
          calc(var(--spacing, 0.25rem) * 4);
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border: none;
        border-radius: var(--radius, 8px);
        font-size: 0.875rem;
        font-weight: 500;
        font-family: var(--font-sans, inherit);
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
      }

      .add-day-event-btn:hover {
        background: var(--primary, #2563eb);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md, 0 4px 6px rgba(0, 0, 0, 0.1));
      }

      .add-day-event-btn svg {
        width: 1rem;
        height: 1rem;
      }

      .day-schedule {
        flex: 1;
        overflow-y: auto;
        background: var(--background, #fafafa);
        position: relative;
      }

      /* Day Time Grid - Similar to week view but single column */
      .day-time-grid {
        display: flex;
        flex-direction: column;
      }

      .day-time-row {
        display: grid;
        grid-template-columns: 80px 1fr;
        min-height: 4rem;
        border-bottom: 1px solid var(--border, #f1f3f4);
      }

      .day-time-row:hover {
        background: var(--muted, #f8f9fa);
      }

      .day-time-label {
        padding: 0.75rem;
        border-right: 1px solid var(--border, #e5e7eb);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        background: var(--card, #ffffff);
        position: sticky;
        left: 0;
        z-index: 5;
      }

      .day-hour-cell {
        padding: 0.5rem;
        background: var(--card, #ffffff);
        position: relative;
        min-height: 4rem;
      }

      .day-hour-cell:hover {
        background: var(--accent, #f0f9ff);
      }

      /* Day Event Blocks */
      .day-event-block {
        background: rgba(59, 130, 246, 0.1);
        border-radius: 6px;
        padding: 0.75rem;
        margin-bottom: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
      }

      .day-event-block:hover {
        background: rgba(59, 130, 246, 0.2);
        transform: translateY(-2px);
        box-shadow: var(--shadow-md, 0 4px 8px rgba(0, 0, 0, 0.15));
      }

      .day-event-block .event-time {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--primary, #1e40af);
        margin-bottom: 0.25rem;
        font-family: var(--font-mono, monospace);
      }

      .day-event-block .event-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        margin-bottom: 0.25rem;
        line-height: 1.2;
      }

      .day-event-block .event-location {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        margin-bottom: 0.25rem;
      }

      .day-event-block .event-description {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        line-height: 1.3;
        max-height: 2.6rem;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      /* Empty day overlay for time grid */
      .empty-day-overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        color: #6b7280;
        z-index: 10;
        background: var(--card, #ffffff);
        padding: 2rem;
        border-radius: 12px;
        border: 1px solid var(--border, #e5e7eb);
        box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.1));
      }

      .empty-day-overlay .empty-icon {
        width: 4rem;
        height: 4rem;
        margin: 0 auto 1.5rem;
        color: #d1d5db;
      }

      .empty-day-overlay .empty-icon svg {
        width: 100%;
        height: 100%;
      }

      .empty-day-overlay h4 {
        font-size: 1.25rem;
        font-weight: 600;
        color: #374151;
        margin: 0 0 0.5rem 0;
      }

      .empty-day-overlay p {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0 0 2rem 0;
      }

      .schedule-timeline {
        position: relative;
        max-width: 800px;
        margin: 0 auto;
      }

      .timeline-item {
        display: grid;
        grid-template-columns: 120px 24px 1fr;
        gap: calc(var(--spacing, 0.25rem) * 6);
        margin-bottom: calc(var(--spacing, 0.25rem) * 8);
        position: relative;
        align-items: start;
      }

      .timeline-time {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        padding-top: calc(var(--spacing, 0.25rem) * 2);
      }

      .event-time {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        font-family: var(--font-mono, monospace);
        margin-bottom: 0.125rem;
      }

      .end-time {
        font-size: 0.75rem;
        font-weight: 400;
        color: var(--muted-foreground, #6b7280);
        font-family: var(--font-mono, monospace);
      }

      .all-day-badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        background: var(--secondary, #10b981);
        color: var(--secondary-foreground, #ffffff);
        border-radius: calc(var(--radius, 4px));
        font-size: 0.75rem;
        font-weight: 500;
        font-family: var(--font-sans, inherit);
      }

      .timeline-connector {
        width: 16px;
        height: 16px;
        background: var(--primary, #3b82f6);
        border: 3px solid var(--card, #ffffff);
        border-radius: 50%;
        margin-top: calc(var(--spacing, 0.25rem) * 2);
        position: relative;
        flex-shrink: 0;
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
      }

      .timeline-connector::after {
        content: '';
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        width: 2px;
        height: calc(100% + 2rem);
        background: linear-gradient(
          to bottom,
          var(--border, #e5e7eb),
          transparent
        );
      }

      .timeline-item:last-child .timeline-connector::after {
        display: none;
      }

      .timeline-event {
        background: var(--card, #ffffff);
        color: var(--card-foreground, #1f2937);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 8px);
        padding: calc(var(--spacing, 0.25rem) * 6);
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
        position: relative;
        overflow: hidden;
      }

      .timeline-event::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.05),
          rgba(59, 130, 246, 0.02)
        );
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
      }

      .timeline-event:hover {
        background: var(--muted, #f8fafc);
        transform: translateY(-2px) translateX(4px);
        box-shadow: var(--shadow-lg, 0 8px 16px rgba(0, 0, 0, 0.15));
        border-color: var(--primary, #3b82f6);
      }

      .timeline-event:hover::before {
        opacity: 1;
      }

      .event-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: calc(var(--spacing, 0.25rem) * 4);
        position: relative;
        z-index: 1;
      }

      .event-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        margin: 0;
        line-height: 1.3;
        font-family: var(--font-sans, inherit);
      }

      .event-type-badge {
        background: var(--accent, #dbeafe);
        color: var(--primary, #1e40af);
        padding: 0.25rem 0.5rem;
        border-radius: calc(var(--radius, 4px));
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: capitalize;
        font-family: var(--font-sans, inherit);
        border: 1px solid var(--border, #bfdbfe);
      }

      .event-detail {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        margin-bottom: calc(var(--spacing, 0.25rem) * 3);
        font-size: 0.875rem;
        color: var(--muted-foreground, #4b5563);
        position: relative;
        z-index: 1;
      }

      .detail-icon {
        width: 1rem;
        height: 1rem;
        color: var(--muted-foreground, #6b7280);
        flex-shrink: 0;
      }

      .event-actions {
        display: flex;
        gap: calc(var(--spacing, 0.25rem) * 3);
        margin-top: calc(var(--spacing, 0.25rem) * 4);
        position: relative;
        z-index: 1;
      }

      .edit-event-btn,
      .delete-event-btn {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 1.5);
        padding: calc(var(--spacing, 0.25rem) * 2)
          calc(var(--spacing, 0.25rem) * 3);
        border: none;
        border-radius: calc(var(--radius, 6px));
        font-size: 0.8125rem;
        font-weight: 500;
        font-family: var(--font-sans, inherit);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .edit-event-btn {
        background: var(--muted, #f3f4f6);
        color: var(--muted-foreground, #374151);
        border: 1px solid var(--border, #d1d5db);
      }

      .edit-event-btn:hover {
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-color: var(--primary, #3b82f6);
        transform: translateY(-1px);
        box-shadow: var(--shadow-sm, 0 2px 4px rgba(59, 130, 246, 0.2));
      }

      .delete-event-btn {
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        border: 1px solid var(--destructive, #dc2626);
      }

      .delete-event-btn:hover {
        background: var(--destructive, #dc2626);
        transform: translateY(-1px);
        box-shadow: var(--shadow-sm, 0 2px 4px rgba(239, 68, 68, 0.2));
      }

      .edit-event-btn svg,
      .delete-event-btn svg {
        width: 0.875rem;
        height: 0.875rem;
      }

      .event-title {
        font-weight: 500;
        margin-bottom: 0.25rem;
      }

      .event-location {
        font-size: 0.75rem;
        color: #6b7280;
        margin-bottom: 0.125rem;
      }

      .event-description {
        font-size: 0.75rem;
        color: #6b7280;
        line-height: 1.3;
      }

      .empty-day {
        text-align: center;
        padding: 4rem 2rem;
        color: #6b7280;
      }

      .empty-icon {
        width: 4rem;
        height: 4rem;
        margin: 0 auto 1.5rem;
        color: #d1d5db;
      }

      .empty-icon svg {
        width: 100%;
        height: 100%;
      }

      .empty-day h4 {
        font-size: 1.25rem;
        font-weight: 600;
        color: #374151;
        margin: 0 0 0.5rem 0;
      }

      .empty-day p {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0 0 2rem 0;
      }

      .add-event-button {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        background: #3b82f6;
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .add-event-button:hover {
        background: #2563eb;
        transform: translateY(-1px);
      }

      .add-event-button svg {
        width: 1rem;
        height: 1rem;
      }

      .empty-state {
        color: #6b7280;
        font-style: italic;
        padding: 1rem;
        text-align: center;
      }

      .no-events {
        text-align: center;
        padding: 1rem;
      }

      .no-events-text {
        color: #6b7280;
        font-size: 0.75rem;
        font-style: italic;
      }

      /* Event Form Overlay */
      .event-form-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .event-form {
        background: white;
        border-radius: 12px;
        padding: 2rem;
        width: 90%;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
      }

      .event-form h3 {
        margin: 0 0 1.5rem 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #1f2937;
      }

      .form-field {
        margin-bottom: 1rem;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }

      .form-field label {
        display: block;
        margin-bottom: 0.5rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
      }

      .form-field input,
      .form-field textarea,
      .form-field select {
        width: 100%;
        padding: 0.5rem 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.875rem;
        color: #1f2937;
        background: white;
      }

      .form-field input:focus,
      .form-field textarea:focus,
      .form-field select:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .form-field textarea {
        min-height: 80px;
        resize: vertical;
      }

      .form-field input[type='checkbox'] {
        width: auto;
        margin-right: 0.5rem;
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        margin-top: 1.5rem;
      }

      .cancel-btn,
      .save-btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        font-size: 0.875rem;
        cursor: pointer;
        transition: background 0.2s;
      }

      .cancel-btn {
        background: #f3f4f6;
        color: #374151;
      }

      .cancel-btn:hover {
        background: #e5e7eb;
      }

      .save-btn {
        background: #3b82f6;
        color: white;
      }

      .save-btn:hover {
        background: #2563eb;
      }

      /* More Events Modal */
      .more-events-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .modal-backdrop {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        cursor: pointer;
      }

      .modal-content {
        position: relative;
        background: var(--popover, #ffffff);
        color: var(--popover-foreground, #1f2937);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 8px);
        box-shadow: var(--shadow-xl, 0 20px 25px rgba(0, 0, 0, 0.25));
        min-width: 320px;
        max-width: 480px;
        max-height: 80vh;
        overflow: hidden;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: calc(var(--spacing, 0.25rem) * 4)
          calc(var(--spacing, 0.25rem) * 6);
        border-bottom: 1px solid var(--border, #e8eaed);
        background: var(--muted, #f8f9fa);
      }

      .modal-header h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 500;
        font-family: var(--font-sans, inherit);
        color: var(--foreground, #202124);
        letter-spacing: var(--tracking-normal, 0em);
      }

      .close-button {
        background: none;
        border: none;
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--muted-foreground, #5f6368);
        transition: all 0.15s ease;
      }

      .close-button:hover {
        background: var(--muted, #f1f3f4);
        color: var(--foreground, #202124);
      }

      .close-button svg {
        width: 1rem;
        height: 1rem;
      }

      .modal-events {
        padding: 1rem 0;
        max-height: 60vh;
        overflow-y: auto;
      }

      .modal-event {
        padding: 1rem 1.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        border-left: 4px solid transparent;
        border-bottom: 1px solid var(--border, #f1f3f4);
        position: relative;
      }

      .modal-event:last-child {
        border-bottom: none;
      }

      .modal-event:hover {
        background: var(--muted, #f8f9fa);
        border-left-color: var(--primary, #3b82f6);
        transform: translateX(4px);
        box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.05));
      }

      .modal-event-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 0.5rem;
      }

      .modal-event-time {
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.25rem 0.5rem;
        border-radius: calc(var(--radius, 4px));
        display: inline-block;
      }

      .modal-event-type {
        background: var(--muted, #f3f4f6);
        color: var(--muted-foreground, #6b7280);
        font-size: 0.6875rem;
        font-weight: 500;
        padding: 0.125rem 0.375rem;
        border-radius: calc(var(--radius, 4px));
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .modal-event-title {
        font-size: 0.9375rem;
        color: var(--foreground, #1f2937);
        font-weight: 600;
        margin-bottom: 0.5rem;
        line-height: 1.3;
      }

      .modal-event-details {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .modal-event-location {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--muted-foreground, #6b7280);
      }

      .modal-event-location svg {
        width: 0.875rem;
        height: 0.875rem;
        color: var(--muted-foreground, #9ca3af);
      }

      .modal-event-description {
        font-size: 0.8125rem;
        color: var(--muted-foreground, #6b7280);
        line-height: 1.4;
        margin-top: 0.25rem;
      }
    </style>
  </template>
}

export class CalendarCard extends CardDef {
  // ⁵ Generic Calendar card definition
  static displayName = 'Calendar';
  static icon = CalendarIcon;

  @field month = contains(NumberField); // ⁶ Calendar state fields
  @field year = contains(NumberField);
  @field selectedDate = contains(DateField);
  @field viewMode = contains(StringField); // month, week, day
  @field calendarName = contains(StringField); // ⁷ Calendar identification

  // ⁹ Computed title
  @field title = contains(StringField, {
    computeVia: function (this: CalendarCard) {
      try {
        const name = this.calendarName || 'Calendar';
        const currentDate = new Date();
        const month = this.month || currentDate.getMonth() + 1;
        const year = this.year || currentDate.getFullYear();
        return `${name} - ${month}/${year}`;
      } catch (e) {
        console.error('CalendarCard: Error computing title', e);
        return 'Calendar';
      }
    },
  });

  // ²³ Query for events that belong to this calendar
  get eventsQuery(): Query {
    return {
      filter: {
        every: [
          {
            type: {
              module: new URL(import.meta.url).href,
              name: 'CalendarEvent',
            },
          },
          {
            on: {
              module: new URL(import.meta.url).href,
              name: 'CalendarEvent',
            },
            eq: { 'calendar.id': this.id },
          },
        ],
      },
      sort: [
        {
          by: 'startTime',
          on: {
            module: new URL(import.meta.url).href,
            name: 'CalendarEvent',
          },
          direction: 'asc',
        },
      ],
    };
  }

  get realmURL(): URL {
    return this[realmURL]!;
  }

  get realmHrefs() {
    return [this.realmURL.href];
  }

  static isolated = CalendarIsolated;
  get today() {
    return new Date();
  }

  static embedded = class Embedded extends Component<typeof CalendarCard> {
    // ²⁰ Embedded format with event querying ²⁶
    get currentDate() {
      return new Date();
    }

    // ²⁷ Query events for this calendar in embedded format
    eventsResult = this.args.context?.getCards(
      this,
      () => this.args.model?.eventsQuery,
      () => this.args.model?.realmHrefs,
      { isLive: true },
    );

    // ²⁸ Get today's events for embedded display
    get todaysEvents() {
      const today = new Date();
      const events = (this.eventsResult?.instances as CalendarEvent[]) || [];
      return events
        .filter((event) => {
          if (!event?.startTime) return false;
          const eventDate = new Date(event.startTime);
          return (
            eventDate.getFullYear() === today.getFullYear() &&
            eventDate.getMonth() === today.getMonth() &&
            eventDate.getDate() === today.getDate()
          );
        })
        .slice(0, 3); // Show max 3 events in embedded view
    }

    <template>
      <div class='calendar-embedded'>
        <div class='calendar-preview'>
          <h4 class='calendar-title'>{{if
              @model.calendarName
              @model.calendarName
              'Calendar'
            }}</h4>
          <div class='mini-calendar'>
            <div class='mini-header'>
              <span class='current-month'>{{formatCalendarDate
                  this.currentDate
                  'month'
                }}</span>
            </div>
            <div class='mini-grid'>
              <div class='mini-day'>S</div>
              <div class='mini-day'>M</div>
              <div class='mini-day'>T</div>
              <div class='mini-day'>W</div>
              <div class='mini-day'>T</div>
              <div class='mini-day'>F</div>
              <div class='mini-day'>S</div>
              <div class='mini-date'>28</div>
              <div class='mini-date'>29</div>
              <div class='mini-date'>30</div>
              <div class='mini-date current'>1</div>
              <div class='mini-date'>2</div>
              <div class='mini-date event'>3</div>
              <div class='mini-date'>4</div>
            </div>
          </div>
          <div class='upcoming-events'>
            {{#each this.todaysEvents as |event|}}
              <div class='event-item'>
                <span class='event-time'>{{#if event.isAllDay}}All Day{{else}}{{formatCalendarDate
                      event.startTime
                      'time'
                    }}{{/if}}</span>
                <span class='event-title'>{{if
                    event.title
                    event.title
                    'Untitled Event'
                  }}</span>
              </div>
            {{else}}
              <div class='no-events'>
                <span class='no-events-text'>No events today</span>
              </div>
            {{/each}}
          </div>
        </div>
      </div>

      <style scoped>
        /* ¹¹ Embedded styling */
        .calendar-embedded {
          font-family: 'Inter', sans-serif;
          padding: 1rem;
          background: white;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
          font-size: 0.8125rem;
        }

        .calendar-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 1rem 0;
        }

        .mini-calendar {
          margin-bottom: 1rem;
        }

        .mini-header {
          text-align: center;
          margin-bottom: 0.5rem;
        }

        .current-month {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6b7280;
        }

        .mini-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 1px;
          text-align: center;
        }

        .mini-day {
          font-size: 0.625rem;
          font-weight: 500;
          color: #9ca3af;
          padding: 0.25rem;
        }

        .mini-date {
          font-size: 0.6875rem;
          padding: 0.25rem;
          cursor: pointer;
          border-radius: 2px;
        }

        .mini-date.current {
          background: #3b82f6;
          color: white;
        }

        .mini-date.event {
          background: #f59e0b;
          color: white;
        }

        .upcoming-events {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .event-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.375rem 0.5rem;
          background: #f9fafb;
          border-radius: 4px;
        }

        .event-time {
          font-size: 0.6875rem;
          color: #6b7280;
          font-weight: 500;
        }

        .event-title {
          font-size: 0.6875rem;
          color: #374151;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof CalendarCard> {
    // ²¹ Fitted format with dynamic data and event querying ²⁹
    get currentDate() {
      // Use model date if available, otherwise current date
      if (this.args.model?.year && this.args.model?.month) {
        return new Date(this.args.model.year, this.args.model.month - 1, 1);
      }
      return new Date();
    }

    get currentDayNumber() {
      return this.currentDate.getDate();
    }

    // ³⁰ Query events for this calendar in fitted format
    eventsResult = this.args.context?.getCards(
      this,
      () => this.args.model?.eventsQuery,
      () => this.args.model?.realmHrefs,
      { isLive: true },
    );

    // ³¹ Get today's events for fitted display
    get todaysEvents() {
      const today = new Date();
      const events = (this.eventsResult?.instances as CalendarEvent[]) || [];
      return events
        .filter((event) => {
          if (!event?.startTime) return false;
          const eventDate = new Date(event.startTime);
          return (
            eventDate.getFullYear() === today.getFullYear() &&
            eventDate.getMonth() === today.getMonth() &&
            eventDate.getDate() === today.getDate()
          );
        })
        .slice(0, 3); // Show max 3 events
    }

    // ³² Get total event count for displays
    get totalEventCount() {
      return this.eventsResult?.instances?.length || 0;
    }

    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='calendar-badge'>
            <svg
              class='cal-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
              <line x1='16' y1='2' x2='16' y2='6' />
              <line x1='8' y1='2' x2='8' y2='6' />
              <line x1='3' y1='10' x2='21' y2='10' />
            </svg>
            <div class='badge-text'>
              <div class='badge-title'>{{if
                  @model.calendarName
                  @model.calendarName
                  'Calendar'
                }}</div>
              <div class='badge-date'>{{formatCalendarDate
                  this.currentDate
                  'short'
                }}</div>
            </div>
          </div>
        </div>

        <div class='strip-format'>
          <div class='calendar-strip'>
            <svg
              class='strip-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
              <line x1='16' y1='2' x2='16' y2='6' />
              <line x1='8' y1='2' x2='8' y2='6' />
              <line x1='3' y1='10' x2='21' y2='10' />
            </svg>
            <span class='strip-title'>{{if
                @model.calendarName
                @model.calendarName
                'Calendar'
              }}</span>
            <span class='strip-events'>{{this.totalEventCount}}
              {{if (eq this.totalEventCount 1) 'event' 'events'}}</span>
          </div>
        </div>

        <div class='tile-format'>
          <div class='calendar-tile'>
            <div class='tile-header'>
              <h3 class='tile-title'>{{if
                  @model.calendarName
                  @model.calendarName
                  'Calendar'
                }}</h3>
              <span class='current-month'>{{formatCalendarDate
                  this.currentDate
                  'month'
                }}</span>
            </div>
            <div class='today-events'>
              {{#each this.todaysEvents as |event|}}
                <div class='event-item'>
                  <span class='event-time'>{{if
                      event.isAllDay
                      'All Day'
                      (formatCalendarDate event.startTime 'time')
                    }}</span>
                  <span class='event-title'>{{if
                      event.title
                      event.title
                      'Untitled Event'
                    }}</span>
                </div>
              {{else}}
                <div class='no-events'>No events today</div>
              {{/each}}
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='calendar-card'>
            <div class='card-header'>
              <h3 class='card-title'>{{if
                  @model.calendarName
                  @model.calendarName
                  'Calendar'
                }}</h3>
              <span class='event-count'>{{this.totalEventCount}}
                {{if (eq this.totalEventCount 1) 'event' 'events'}}</span>
            </div>
            <div class='calendar-preview'>
              <div class='month-display'>
                <div class='month-name'>{{formatCalendarDate
                    this.currentDate
                    'month'
                  }}</div>
                <div class='today-date'>{{formatCalendarDate
                    this.currentDate
                    'day'
                  }}
                  {{this.currentDayNumber}}</div>
              </div>
              <div class='event-summary'>
                <div class='summary-header'>Upcoming Events</div>
                {{#each this.todaysEvents as |event index|}}
                  {{#if (lt index 2)}}
                    <div class='summary-item'>
                      <span class='time'>{{if
                          event.isAllDay
                          'All Day'
                          (formatCalendarDate event.startTime 'time')
                        }}</span>
                      <span class='title'>{{if
                          event.title
                          event.title
                          'Untitled Event'
                        }}</span>
                    </div>
                  {{/if}}
                {{else}}
                  <div class='summary-item'>
                    <span class='time'>—</span>
                    <span class='title'>No events scheduled</span>
                  </div>
                {{/each}}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        /* ¹³ Fitted styling */
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family: 'Inter', sans-serif;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }

        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
          }
        }

        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
          }
        }

        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        /* Badge Format */
        .calendar-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
          color: white;
          border-radius: 6px;
          padding: 0.5rem;
          box-sizing: border-box;
        }

        .cal-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 600;
          line-height: 1;
        }

        .badge-date {
          font-size: 0.625rem;
          opacity: 0.9;
          line-height: 1;
        }

        /* Strip Format */
        .calendar-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          box-sizing: border-box;
        }

        .strip-icon {
          width: 1rem;
          height: 1rem;
          color: #3b82f6;
        }

        .strip-title {
          font-size: 0.8125rem;
          font-weight: 600;
          color: #1f2937;
        }

        .strip-events {
          font-size: 0.6875rem;
          color: #6b7280;
        }

        /* Tile Format */
        .calendar-tile {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1rem;
          box-sizing: border-box;
        }

        .tile-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .tile-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
        }

        .tile-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #3b82f6;
        }

        .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 1px;
          text-align: center;
          margin-bottom: 0.75rem;
        }

        .cal-day {
          font-size: 0.625rem;
          color: #9ca3af;
          padding: 0.125rem;
        }

        .cal-date {
          font-size: 0.6875rem;
          padding: 0.125rem;
          border-radius: 2px;
        }

        .cal-date.today {
          background: #3b82f6;
          color: white;
        }

        .cal-date.event {
          background: #f59e0b;
          color: white;
        }

        .today-events {
          margin-top: auto;
        }

        .today-events .event {
          font-size: 0.6875rem;
          color: #374151;
          margin-bottom: 0.25rem;
        }

        /* Card Format */
        .calendar-card {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1.25rem;
          box-sizing: border-box;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .card-title {
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0;
        }

        .card-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: #3b82f6;
        }

        .month-header {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6b7280;
          text-align: center;
          margin-bottom: 0.5rem;
        }

        .week-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 1px;
          text-align: center;
          margin-bottom: 1rem;
        }

        .week-day {
          font-size: 0.625rem;
          color: #9ca3af;
          padding: 0.25rem;
        }

        .date-cell {
          font-size: 0.6875rem;
          padding: 0.25rem;
          border-radius: 2px;
        }

        .date-cell.today {
          background: #3b82f6;
          color: white;
        }

        .date-cell.event {
          background: #f59e0b;
          color: white;
        }

        .list-header {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6b7280;
          margin-bottom: 0.5rem;
        }

        .schedule-item {
          display: flex;
          justify-content: space-between;
          padding: 0.25rem 0;
          font-size: 0.6875rem;
        }

        .schedule-item .time {
          color: #6b7280;
        }

        .schedule-item .title {
          color: #374151;
        }
      </style>
    </template>
  };
}
