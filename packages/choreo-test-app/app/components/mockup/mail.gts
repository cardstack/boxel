import { Choreo } from '@cardstack/choreo';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

/**
 * A fake iOS-ish Mail screen for the phone mockup demos. No images, no
 * network, nothing outside the framework — the only moving parts are the
 * ones the screen's own taps produce.
 *
 * Sized for exactly 390 x 844 CSS px (the mockup's screen box). The list is
 * the <Choreo> region: filtering All ⇄ Unread is one render pass in which
 * some rows leave and the survivors reflow, so it is scored as a changeset
 * (removed fade, inserted fade, moved on a spring) rather than left to a
 * pile of CSS transitions that cannot agree on ordering. Marking a row read
 * removes its unread dot from the DOM, which the same score fades out.
 */

interface Message {
  id: string;
  preview: string;
  sender: string;
  subject: string;
  time: string;
  unread: boolean;
}

interface Row {
  dotId: string;
  id: string;
  initials: string;
  preview: string;
  selected: boolean;
  sender: string;
  subject: string;
  time: string;
  unread: boolean;
}

const MESSAGES: Message[] = [
  {
    id: 'nadia',
    preview:
      'Moved the staging cut to 4pm so QA gets a full pass before the demo.',
    sender: 'Nadia Rahman',
    subject: "Re: Friday's launch checklist",
    time: '9:41 AM',
    unread: true,
  },
  {
    id: 'testflight',
    preview: 'Build 118 finished processing and is available to your testers.',
    sender: 'TestFlight',
    subject: 'Glimmer Motion 2.4 (118) is ready',
    time: '9:12 AM',
    unread: true,
  },
  {
    id: 'marcus',
    preview: 'That ramen place near the studio I keep failing to get us into.',
    sender: 'Marcus Webb',
    subject: 'Lunch Thursday?',
    time: '8:57 AM',
    unread: false,
  },
  {
    id: 'weekly',
    preview: 'Plus: a short argument against the hamburger menu, again.',
    sender: 'Design Weekly',
    subject: 'Twelve interfaces that respect your attention',
    time: 'Yesterday',
    unread: true,
  },
  {
    id: 'priya',
    preview: 'All done on my end — counter-signed and dated the 26th.',
    sender: 'Priya Anand',
    subject: 'Contract, signed copy attached',
    time: 'Yesterday',
    unread: false,
  },
  {
    id: 'building',
    preview: 'Please store drinking water in advance. Elevators unaffected.',
    sender: 'Building Management',
    subject: 'Water shutoff, Saturday 7–11am',
    time: 'Yesterday',
    unread: false,
  },
  {
    id: 'jonas',
    preview: 'Finally culled these down. The last four are the good ones.',
    sender: 'Jonas Lind',
    subject: 'Photos from the coast',
    time: 'Tuesday',
    unread: true,
  },
];

/** rows reflow on this when the filter changes — short, barely any bounce */
const QUICK = { damping: 26, stiffness: 320 };

function initialsFor(sender: string): string {
  return sender
    .split(' ')
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export class MailApp extends Component {
  @tracked filter: 'all' | 'unread' = 'all';
  @tracked readIds: string[] = [];
  @tracked selectedId: string | null = null;

  /**
   * Everything the template needs, resolved here rather than through helpers
   * in the template: the row is the Choreo participant, so its identity
   * (`id`) and its unread flag have to agree on one pass.
   */
  get rows(): Row[] {
    let read = this.readIds;
    let onlyUnread = this.filter === 'unread';
    let rows: Row[] = [];
    for (let message of MESSAGES) {
      let unread = message.unread && !read.includes(message.id);
      if (onlyUnread && !unread) {
        continue;
      }
      rows.push({
        dotId: `${message.id}-dot`,
        id: message.id,
        initials: initialsFor(message.sender),
        preview: message.preview,
        selected: this.selectedId === message.id,
        sender: message.sender,
        subject: message.subject,
        time: message.time,
        unread,
      });
    }
    return rows;
  }

  get unreadCount(): number {
    let read = this.readIds;
    return MESSAGES.filter((m) => m.unread && !read.includes(m.id)).length;
  }

  get allActive(): boolean {
    return this.filter === 'all';
  }

  setFilter = (filter: 'all' | 'unread') => {
    this.filter = filter;
  };

  openMessage = (id: string) => {
    this.selectedId = id;
    if (!this.readIds.includes(id)) {
      this.readIds = [...this.readIds, id];
    }
  };

  <template>
    <div class="mail-app">
      <div class="mail-statusbar">
        <span class="mail-clock">9:41</span>
        <span class="mail-status-icons">
          <span class="mail-signal">
            <span class="mail-bar mail-bar-1"></span>
            <span class="mail-bar mail-bar-2"></span>
            <span class="mail-bar mail-bar-3"></span>
            <span class="mail-bar mail-bar-4"></span>
          </span>
          <span class="mail-battery"><span
              class="mail-battery-fill"
            ></span></span>
        </span>
      </div>

      <div class="mail-header">
        <div class="mail-navrow">
          <span class="mail-back">‹ Mailboxes</span>
          <span class="mail-edit">Edit</span>
        </div>
        <h1 class="mail-title">Inbox</h1>
        <p class="mail-subtitle">{{this.unreadCount}} unread</p>

        <div class="mail-search">
          <span class="mail-search-glass"></span>
          <span class="mail-search-text">Search</span>
        </div>

        <div class="mail-segmented">
          <button
            type="button"
            class="mail-seg {{if this.allActive 'mail-seg-on'}}"
            {{on "click" (fn this.setFilter "all")}}
          >All</button>
          <button
            type="button"
            class="mail-seg {{unless this.allActive 'mail-seg-on'}}"
            {{on "click" (fn this.setFilter "unread")}}
          >Unread</button>
        </div>
      </div>

      {{! The region IS the list element, so the rows are its direct children
          and the list's own layout still owns them. }}
      <Choreo class="mail-list" as |c|>
        {{#each this.rows key="id" as |row|}}
          <button
            type="button"
            class="mail-row {{if row.selected 'mail-row-on'}}"
            {{motion id=row.id role="row"}}
            {{on "click" (fn this.openMessage row.id)}}
          >
            {{#if row.unread}}
              <span class="mail-dot" {{motion id=row.dotId role="dot"}}></span>
            {{else}}
              <span class="mail-dot-gap"></span>
            {{/if}}
            <span class="mail-avatar">{{row.initials}}</span>
            <span class="mail-body">
              <span class="mail-line">
                <span class="mail-sender">{{row.sender}}</span>
                <span class="mail-time">{{row.time}} ›</span>
              </span>
              <span class="mail-subject">{{row.subject}}</span>
              <span class="mail-preview">{{row.preview}}</span>
            </span>
          </button>
        {{else}}
          <div class="mail-empty">No Unread Mail</div>
        {{/each}}

        {{! One pass, three things happening at once: the rows the filter
            dropped fade where they stood (Choreo holds a leaver on screen for
            exactly as long as a step names it), the ones it brought back fade
            in, and every survivor springs to its new seat. The dot leaves on
            the same pass when a tap marks its row read. }}
        <c.Parallel>
          <c.Move @of={{c.moved "row"}} @spring={{QUICK}} />
          <c.Tween
            @of={{c.removed "row"}}
            @opacity={{array 1 0}}
            @duration={{0.18}}
          />
          <c.Tween
            @of={{c.inserted "row"}}
            @opacity={{array 0 1}}
            @duration={{0.28}}
          />
          <c.Tween
            @of={{c.removed "dot"}}
            @opacity={{array 1 0}}
            @scale={{array 1 0.2}}
            @duration={{0.24}}
          />
        </c.Parallel>
      </Choreo>

      <div class="mail-toolbar">
        <span class="mail-updated">Updated Just Now</span>
        <span class="mail-compose">✎</span>
      </div>

      <div class="mail-home-indicator"></div>
    </div>

    <style>
      .mail-app {
        position: absolute;
        inset: 0;
        overflow: hidden;
        width: 390px;
        height: 844px;
        background:
          radial-gradient(
            120% 60% at 50% 0%,
            hsl(8 45% 16%) 0%,
            hsl(8 30% 9%) 55%,
            hsl(8 26% 7%) 100%
          ),
          hsl(8 26% 7%);
        color: hsl(8 20% 96%);
        font-family:
          -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue",
          system-ui, sans-serif;
        user-select: none;
        -webkit-font-smoothing: antialiased;
        display: flex;
        flex-direction: column;
      }

      .mail-statusbar {
        flex: 0 0 auto;
        height: 54px;
        padding: 14px 30px 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .mail-clock {
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.2px;
      }

      .mail-status-icons {
        display: flex;
        align-items: center;
        gap: 7px;
      }

      .mail-signal {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 11px;
      }

      .mail-bar {
        width: 3px;
        border-radius: 1px;
        background: hsl(8 20% 96%);
      }

      .mail-bar-1 {
        height: 4px;
      }

      .mail-bar-2 {
        height: 6px;
      }

      .mail-bar-3 {
        height: 9px;
      }

      .mail-bar-4 {
        height: 11px;
        opacity: 0.4;
      }

      .mail-battery {
        width: 24px;
        height: 12px;
        border: 1.5px solid hsl(8 20% 96% / 0.6);
        border-radius: 3px;
        padding: 1.5px;
        display: block;
      }

      .mail-battery-fill {
        display: block;
        width: 70%;
        height: 100%;
        border-radius: 1px;
        background: hsl(8 20% 96%);
      }

      .mail-header {
        flex: 0 0 auto;
        padding: 0 18px 10px;
      }

      .mail-navrow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 15px;
        color: hsl(8 85% 66%);
        padding: 2px 2px 6px;
      }

      .mail-back {
        font-weight: 500;
      }

      .mail-edit {
        font-weight: 500;
      }

      .mail-title {
        margin: 0;
        padding: 0 2px;
        font-size: 30px;
        line-height: 34px;
        font-weight: 700;
        letter-spacing: -0.6px;
      }

      .mail-subtitle {
        margin: 2px 0 0;
        padding: 0 2px;
        font-size: 13px;
        color: hsl(8 14% 62%);
      }

      .mail-search {
        margin-top: 12px;
        height: 38px;
        border-radius: 11px;
        background: hsl(8 18% 15%);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
      }

      .mail-search-glass {
        width: 11px;
        height: 11px;
        border: 1.8px solid hsl(8 12% 58%);
        border-radius: 50%;
        position: relative;
        flex: 0 0 auto;
      }

      .mail-search-glass::after {
        content: "";
        position: absolute;
        right: -4px;
        bottom: -3px;
        width: 6px;
        height: 1.8px;
        border-radius: 1px;
        background: hsl(8 12% 58%);
        transform: rotate(45deg);
      }

      .mail-search-text {
        font-size: 15px;
        color: hsl(8 12% 58%);
      }

      .mail-segmented {
        margin-top: 12px;
        display: flex;
        gap: 3px;
        padding: 3px;
        border-radius: 10px;
        background: hsl(8 18% 14%);
      }

      .mail-seg {
        flex: 1 1 0;
        appearance: none;
        border: 0;
        margin: 0;
        padding: 7px 0;
        border-radius: 8px;
        background: transparent;
        color: hsl(8 12% 66%);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background-color 160ms ease,
          color 160ms ease;
      }

      .mail-seg-on {
        background: hsl(8 78% 52%);
        color: hsl(8 30% 98%);
      }

      .mail-list {
        position: relative;
        flex: 1 1 auto;
        overflow: hidden;
        padding: 4px 0 0;
        mask-image: linear-gradient(
          to bottom,
          #000 0,
          #000 calc(100% - 26px),
          transparent 100%
        );
      }

      .mail-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        appearance: none;
        border: 0;
        margin: 0;
        padding: 11px 16px 11px 8px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        border-bottom: 1px solid hsl(8 18% 18%);
        transition: background-color 200ms ease;
      }

      .mail-row-on {
        background: hsl(8 40% 20%);
      }

      .mail-dot,
      .mail-dot-gap {
        flex: 0 0 auto;
        width: 9px;
        height: 9px;
        margin-top: 15px;
        border-radius: 50%;
      }

      .mail-dot {
        background: hsl(8 85% 60%);
      }

      .mail-avatar {
        flex: 0 0 auto;
        width: 38px;
        height: 38px;
        margin-top: 2px;
        border-radius: 50%;
        background: linear-gradient(150deg, hsl(8 60% 42%), hsl(8 45% 27%));
        color: hsl(8 30% 96%);
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.3px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mail-body {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .mail-line {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .mail-sender {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: -0.2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .mail-time {
        flex: 0 0 auto;
        font-size: 13px;
        color: hsl(8 12% 58%);
      }

      .mail-subject {
        font-size: 14px;
        font-weight: 500;
        color: hsl(8 16% 88%);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .mail-preview {
        font-size: 14px;
        line-height: 18px;
        color: hsl(8 10% 60%);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .mail-empty {
        padding: 60px 0;
        text-align: center;
        font-size: 17px;
        font-weight: 600;
        color: hsl(8 10% 52%);
      }

      .mail-toolbar {
        flex: 0 0 auto;
        height: 48px;
        padding: 0 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid hsl(8 18% 16%);
        background: hsl(8 26% 8% / 0.9);
      }

      .mail-updated {
        font-size: 12px;
        color: hsl(8 10% 55%);
        margin: 0 auto;
      }

      .mail-compose {
        font-size: 20px;
        color: hsl(8 85% 66%);
      }

      .mail-home-indicator {
        flex: 0 0 auto;
        width: 134px;
        height: 5px;
        margin: 8px auto;
        border-radius: 3px;
        background: hsl(8 15% 80% / 0.75);
      }
    </style>
  </template>
}

export default MailApp;
