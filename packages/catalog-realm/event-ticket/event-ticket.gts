import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import MusicIcon from '@cardstack/boxel-icons/music';
import {
  formatDateTime,
  formatCurrency,
  gt,
  eq,
} from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';
import { QRField } from '../fields/qr-code';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

class EventTicketEmbedded extends Component<typeof EventTicketCard> {
  @tracked showQRModal = false;
  @tracked isPurchasing = false;

  get timeUntilEvent() {
    if (!this.args.model?.eventDate) return null;

    const eventDate = new Date(this.args.model.eventDate);
    const now = new Date();
    const diff = eventDate.getTime() - now.getTime();

    if (diff <= 0) return 'Event has started';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days} days, ${hours} hours`;
    return `${hours} hours`;
  }

  get availabilityPercentage() {
    const max = this.args.model?.maxCapacity ?? 100;
    const sold = this.args.model?.soldTickets ?? 0;
    return Math.round(((max - sold) / max) * 100);
  }

  @action
  async handleBuyTicket() {
    this.isPurchasing = true;

    // Simulate purchase processing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Generate QR code if it doesn't exist
    if (!this.args.model?.ticketQRCode?.data) {
      const ticketId = `TICKET-${this.args.model?.eventName
        ?.toUpperCase()
        .replace(/\s+/g, '-')}-${new Date().getFullYear()}-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;
      // In a real app, this would be saved to the server
      console.log('Generated ticket ID:', ticketId);
    }

    this.isPurchasing = false;
    this.showQRModal = true;
  }

  @action
  toggleQRCode() {
    this.showQRModal = !this.showQRModal;
  }

  @action
  shareEvent() {
    if (navigator.share) {
      navigator.share({
        title: this.args.model?.eventName || 'Music Event',
        text: `Check out this event: ${this.args.model?.eventName} featuring ${this.args.model?.artist}`,
        url: window.location.href,
      });
    }
  }

  @action
  stopPropagation(event: Event) {
    event.stopPropagation();
    event.preventDefault();
  }

  <template>
    <div class='ticket-card {{unless @model.isAvailable "sold-out"}}'>
      <div class='ticket-main'>
        <div class='ticket-header'>
          <div class='event-info'>
            <h3 class='event-name'>{{if
                @model.eventName
                @model.eventName
                'Unknown Event'
              }}</h3>
            {{#if @model.artist}}
              <p class='artist-name'>{{@model.artist}}</p>
            {{/if}}
            {{#if this.timeUntilEvent}}
              <p class='countdown'>{{this.timeUntilEvent}} to go</p>
            {{/if}}
          </div>

          <div class='ticket-price'>
            {{#if @model.ticketPrice}}
              <span class='price'>{{formatCurrency
                  @model.ticketPrice
                  currency='USD'
                  size='medium'
                }}</span>
            {{else}}
              <span class='price'>TBA</span>
            {{/if}}
          </div>
        </div>

        <div class='event-details'>
          <div class='detail-item'>
            <svg
              class='detail-icon'
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
            <span class='detail-text'>
              {{#if @model.eventDate}}
                {{formatDateTime @model.eventDate size='medium'}}
              {{else}}
                Date TBA
              {{/if}}
              {{#if @model.eventTime}}
                at
                {{@model.eventTime}}
              {{/if}}
            </span>
          </div>

          <div class='detail-item'>
            <svg
              class='detail-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' />
              <circle cx='12' cy='10' r='3' />
            </svg>
            <span class='detail-text'>{{if
                @model.venue
                @model.venue
                'Venue TBA'
              }}</span>
          </div>

          {{#if @model.seatSection}}
            <div class='detail-item'>
              <svg
                class='detail-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M5 12s2.545-5 7-5c4.454 0 7 5 7 5s-2.546 5-7 5c-4.455 0-7-5-7-5z'
                />
                <path d='M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' />
                <path d='M21 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2' />
                <path d='M21 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2' />
              </svg>
              <span class='detail-text'>Section {{@model.seatSection}}</span>
            </div>
          {{/if}}
        </div>
      </div>

      <div class='ticket-actions'>
        {{#if @model.isAvailable}}
          <div class='action-buttons'>
            <Button
              class='buy-button {{if this.isPurchasing "purchasing"}}'
              @variant='primary'
              {{on 'click' this.handleBuyTicket}}
              {{on 'click' this.stopPropagation}}
              disabled={{this.isPurchasing}}
            >
              {{#if this.isPurchasing}}
                <div class='loading-spinner'></div>
                Processing...
              {{else if @model.ticketType}}
                Buy
                {{@model.ticketType}}
              {{else}}
                Buy Ticket
              {{/if}}
            </Button>

            <Button
              class='share-button'
              @variant='secondary'
              {{on 'click' this.shareEvent}}
              {{on 'click' this.stopPropagation}}
            >
              <svg
                class='share-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='18' cy='5' r='3' />
                <circle cx='6' cy='12' r='3' />
                <circle cx='18' cy='19' r='3' />
                <line x1='8.59' y1='13.51' x2='15.42' y2='17.49' />
                <line x1='15.41' y1='6.51' x2='8.59' y2='10.49' />
              </svg>
            </Button>
          </div>
        {{else}}
          <Button class='sold-out-button' disabled>
            Sold Out
          </Button>
        {{/if}}
      </div>
    </div>

    {{#if this.showQRModal}}
      <div class='qr-section'>
        <div class='qr-section-header'>
          <h3>🎫 Your Digital Ticket</h3>
          <button
            class='close-qr-button'
            {{on 'click' this.toggleQRCode}}
            {{on 'click' this.stopPropagation}}
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='m18 15-6-6-6 6' />
            </svg>
          </button>
        </div>

        <div class='qr-content'>
          <div class='ticket-summary'>
            <div class='summary-item'>
              <strong>{{@model.eventName}}</strong>
            </div>
            <div class='summary-item'>
              {{@model.artist}}
              •
              {{@model.venue}}
            </div>
            <div class='summary-item'>
              {{formatDateTime @model.eventDate size='medium'}}
              {{#if @model.eventTime}}at {{@model.eventTime}}{{/if}}
            </div>
            {{#if @model.seatSection}}
              <div class='summary-item'>
                Section:
                {{@model.seatSection}}
              </div>
            {{/if}}
          </div>

          {{#if @model.ticketQRCode.data}}
            <div class='qr-code-display'>
              <div class='qr-code-wrapper'>
                <@fields.ticketQRCode @format='embedded' />
              </div>
            </div>
          {{else}}
            <div class='qr-pending'>
              <svg
                class='qr-pending-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                <rect x='7' y='7' width='3' height='3' />
                <rect x='14' y='7' width='3' height='3' />
                <rect x='7' y='14' width='3' height='3' />
                <rect x='14' y='14' width='3' height='3' />
              </svg>
              <p>QR Code will be activated after payment confirmation</p>
            </div>
          {{/if}}

        </div>
      </div>
    {{/if}}

    <style scoped>
      .ticket-card {
        background: white;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        position: relative;
        transition: all 0.3s ease;
        border: 2px solid #f3f4f6;
      }

      .ticket-card:hover:not(.sold-out) {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        border-color: #3b82f6;
      }

      .ticket-card.sold-out {
        opacity: 0.6;
        filter: grayscale(50%);
      }

      .availability-indicator {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        animation: pulse 2s infinite;
        flex-shrink: 0;
      }

      .availability-indicator.high {
        background: #10b981;
      }

      .availability-indicator.medium {
        background: #f59e0b;
      }

      .availability-indicator.low {
        background: #ef4444;
      }

      .availability-text {
        font-size: 0.6875rem;
        font-weight: 600;
        color: #374151;
        min-width: fit-content;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      .ticket-main {
        padding: 1.5rem;
        border-bottom: 2px dashed #e5e7eb;
        min-height: 0;
      }

      .ticket-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1rem;
        gap: 0.75rem;
        min-width: 0;
      }

      .event-info {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .event-name {
        font-size: 1.125rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0 0 0.25rem 0;
        line-height: 1.3;
        word-wrap: break-word;
        overflow-wrap: break-word;
        hyphens: auto;
      }

      .artist-name {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0;
        line-height: 1.4;
        word-wrap: break-word;
        overflow-wrap: break-word;
      }

      .countdown {
        font-size: 0.75rem;
        color: #8b5cf6;
        margin: 0.25rem 0 0 0;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .countdown::before {
        content: '⏰';
        font-size: 0.875rem;
      }

      .ticket-price {
        flex-shrink: 0;
        min-width: fit-content;
        display: flex;
        align-items: center;
      }

      .price {
        font-size: 1rem;
        font-weight: 700;
        color: #059669;
        background: #d1fae5;
        padding: 0.375rem 0.75rem;
        border-radius: 6px;
        white-space: nowrap;
        display: inline-block;
        line-height: 1.2;
        min-width: fit-content;
      }

      .event-details {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .detail-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .detail-icon {
        width: 16px;
        height: 16px;
        color: #9ca3af;
        flex-shrink: 0;
      }

      .detail-text {
        font-size: 0.875rem;
        color: #6b7280;
      }

      .ticket-actions {
        padding: 1rem 1.5rem;
        background: #f9fafb;
      }

      .action-buttons {
        display: flex;
        gap: 0.75rem;
      }

      .buy-button {
        flex: 1;
        background: #3b82f6;
        color: white;
        border: none;
        padding: 0.75rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        position: relative;
      }

      .buy-button:hover:not(:disabled) {
        background: #2563eb;
        transform: translateY(-1px);
      }

      .buy-button:disabled {
        opacity: 0.8;
        cursor: not-allowed;
      }

      .buy-button.purchasing {
        background: #6366f1;
      }

      .loading-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .share-button {
        width: auto;
        background: #6b7280;
        color: white;
        border: none;
        padding: 0.75rem;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .share-button:hover {
        background: #4b5563;
        transform: translateY(-1px);
      }

      .share-icon {
        width: 16px;
        height: 16px;
      }

      .sold-out-button {
        width: 100%;
        background: #9ca3af;
        color: white;
        border: none;
        padding: 0.75rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 700;
        cursor: not-allowed;
      }

      /* QR Section Styles (Replaces Modal) */
      .qr-section {
        background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
        border-top: 2px solid #0ea5e9;
        animation: slideDown 0.3s ease-out;
        overflow: hidden;
        position: relative;
        z-index: 1;
      }

      @keyframes slideDown {
        from {
          opacity: 0;
          max-height: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          max-height: 500px;
          transform: translateY(0);
        }
      }

      .qr-section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        background: rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid rgba(14, 165, 233, 0.2);
      }

      .qr-section-header h3 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 700;
        color: #0f172a;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .close-qr-button {
        background: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(14, 165, 233, 0.3);
        cursor: pointer;
        padding: 0.5rem;
        border-radius: 8px;
        color: #0ea5e9;
        transition: all 0.2s ease;
      }

      .close-qr-button:hover {
        background: white;
        border-color: #0ea5e9;
        transform: translateY(-1px);
      }

      .close-qr-button svg {
        width: 16px;
        height: 16px;
      }

      .qr-content {
        padding: 1.5rem;
      }

      .ticket-summary {
        background: white;
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        border: 1px solid rgba(14, 165, 233, 0.1);
      }

      .summary-item {
        font-size: 0.875rem;
        color: #475569;
        margin-bottom: 0.5rem;
        line-height: 1.4;
      }

      .summary-item:last-child {
        margin-bottom: 0;
      }

      .summary-item strong {
        color: #0f172a;
        font-weight: 700;
      }

      .qr-code-display {
        text-align: center;
        margin-bottom: 1.5rem;
      }

      .qr-code-wrapper {
        background: white;
        border-radius: 16px;
        padding: 2rem;
        display: inline-block;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(14, 165, 233, 0.2);
        margin-bottom: 1rem;
      }

      .qr-pending {
        text-align: center;
        padding: 2rem;
        color: #94a3b8;
      }

      .qr-pending-icon {
        width: 48px;
        height: 48px;
        margin: 0 auto 1rem;
        opacity: 0.6;
      }

      .qr-pending p {
        font-size: 0.875rem;
        margin: 0;
      }
    </style>
  </template>
}

class EventTicketIsolated extends Component<typeof EventTicketCard> {
  @tracked showQRModal = false;
  @tracked isPurchasing = false;
  @tracked showFullDescription = false;

  get timeUntilEvent() {
    if (!this.args.model?.eventDate) return null;

    const eventDate = new Date(this.args.model.eventDate);
    const now = new Date();
    const diff = eventDate.getTime() - now.getTime();

    if (diff <= 0) return 'Event has started';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days} days, ${hours} hours`;
    if (hours > 0) return `${hours} hours, ${minutes} minutes`;
    return `${minutes} minutes`;
  }

  get availabilityPercentage() {
    const max = this.args.model?.maxCapacity ?? 100;
    const sold = this.args.model?.soldTickets ?? 0;
    return Math.round(((max - sold) / max) * 100);
  }

  get isEventSoon() {
    if (!this.args.model?.eventDate) return false;
    const eventDate = new Date(this.args.model.eventDate);
    const now = new Date();
    const hoursUntil = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntil <= 24 && hoursUntil > 0;
  }

  get eventStatus() {
    if (!this.args.model?.eventDate) return 'upcoming';
    const eventDate = new Date(this.args.model.eventDate);
    const now = new Date();
    const diff = eventDate.getTime() - now.getTime();

    if (diff <= 0) return 'started';
    if (diff <= 24 * 60 * 60 * 1000) return 'today';
    if (diff <= 7 * 24 * 60 * 60 * 1000) return 'this-week';
    return 'upcoming';
  }

  @action
  async handleBuyTicket() {
    this.isPurchasing = true;

    // Simulate purchase processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (!this.args.model?.ticketQRCode?.data) {
      const ticketId = `TICKET-${this.args.model?.eventName
        ?.toUpperCase()
        .replace(/\s+/g, '-')}-${new Date().getFullYear()}-${Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase()}`;
      console.log('Generated ticket ID:', ticketId);
    }

    this.isPurchasing = false;
    this.showQRModal = true;

    // Scroll to bottom to show QR section
    setTimeout(() => {
      const matElement = document.querySelector('.isolated-mat');
      if (matElement) {
        matElement.scrollTo({
          top: matElement.scrollHeight,
          behavior: 'smooth',
        });
      }
    }, 100);
  }

  @action
  toggleQRCode() {
    this.showQRModal = !this.showQRModal;
  }

  @action
  shareEvent() {
    if (navigator.share) {
      navigator.share({
        title: this.args.model?.eventName || 'Music Event',
        text: `Check out this event: ${this.args.model?.eventName} featuring ${this.args.model?.artist}`,
        url: window.location.href,
      });
    }
  }

  @action
  addToCalendar() {
    if (!this.args.model?.eventDate) return;

    const eventDate = new Date(this.args.model.eventDate);
    const title = `${this.args.model.eventName} - ${this.args.model.artist}`;
    const details = `Event: ${this.args.model.eventName}\nArtist: ${
      this.args.model.artist
    }\nVenue: ${this.args.model.venue}\nSection: ${
      this.args.model.seatSection || 'General Admission'
    }`;

    // Create Google Calendar URL
    const startTime =
      eventDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endTime =
      new Date(eventDate.getTime() + 3 * 60 * 60 * 1000)
        .toISOString()
        .replace(/[-:]/g, '')
        .split('.')[0] + 'Z';

    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
      title,
    )}&dates=${startTime}/${endTime}&details=${encodeURIComponent(
      details,
    )}&location=${encodeURIComponent(this.args.model.venue || '')}`;

    window.open(calendarUrl, '_blank');
  }

  @action
  toggleDescription() {
    this.showFullDescription = !this.showFullDescription;
  }

  <template>
    <div class='isolated-stage'>
      <div class='isolated-mat'>
        <div class='ticket-hero'>
          <div class='hero-background'></div>
          <div class='hero-content'>
            <div class='event-badge {{this.eventStatus}}'>
              {{#if (eq this.eventStatus 'today')}}
                🔥 Today
              {{else if (eq this.eventStatus 'this-week')}}
                📅 This Week
              {{else}}
                🎫 Upcoming
              {{/if}}
            </div>

            <h1 class='hero-title'>{{if
                @model.eventName
                @model.eventName
                'Unknown Event'
              }}</h1>

            {{#if @model.artist}}
              <p class='hero-artist'>{{@model.artist}}</p>
            {{/if}}

            {{#if this.timeUntilEvent}}
              <div class='countdown-display {{if this.isEventSoon "urgent"}}'>
                <svg
                  class='countdown-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <polyline points='12,6 12,12 16,14' />
                </svg>
                <span class='countdown-text'>{{this.timeUntilEvent}}
                  {{if this.isEventSoon 'until showtime!' 'to go'}}</span>
              </div>
            {{/if}}

            <div class='hero-actions'>
              {{#if @model.isAvailable}}
                <button
                  class='primary-action-button
                    {{if this.isPurchasing "purchasing"}}'
                  {{on 'click' this.handleBuyTicket}}
                  disabled={{this.isPurchasing}}
                >
                  {{#if this.isPurchasing}}
                    <div class='action-spinner'></div>
                    Processing Purchase...
                  {{else}}
                    Buy
                    {{@model.ticketType}}
                    -
                    {{formatCurrency @model.ticketPrice currency='USD'}}
                  {{/if}}
                </button>
              {{else}}
                <button class='sold-out-action' disabled>
                  <svg
                    class='action-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <line x1='4.93' y1='4.93' x2='19.07' y2='19.07' />
                  </svg>
                  Sold Out
                </button>
              {{/if}}

              <div class='secondary-actions'>
                <button class='secondary-action' {{on 'click' this.shareEvent}}>
                  <svg
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <circle cx='18' cy='5' r='3' />
                    <circle cx='6' cy='12' r='3' />
                    <circle cx='18' cy='19' r='3' />
                    <line x1='8.59' y1='13.51' x2='15.42' y2='17.49' />
                    <line x1='15.41' y1='6.51' x2='8.59' y2='10.49' />
                  </svg>
                  Share
                </button>

                <button
                  class='secondary-action'
                  {{on 'click' this.addToCalendar}}
                >
                  <svg
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
                  Add to Calendar
                </button>
              </div>
            </div>
          </div>

          {{#if @model.isAvailable}}
            <div class='availability-display'>
              <div
                class='availability-ring
                  {{if
                    (gt this.availabilityPercentage 50)
                    "high"
                    (if (gt this.availabilityPercentage 20) "medium" "low")
                  }}'
              >
                <div
                  class='availability-percentage'
                >{{this.availabilityPercentage}}%</div>
                <div class='availability-label'>Available</div>
              </div>
            </div>
          {{/if}}
        </div>

        <div class='ticket-details-grid'>
          <div class='details-card'>
            <h3 class='card-title'>
              <svg
                class='card-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' />
                <circle cx='12' cy='10' r='3' />
              </svg>
              Event Details
            </h3>
            <div class='detail-grid'>
              <div class='detail-row'>
                <span class='detail-label'>Date & Time</span>
                <span class='detail-value'>
                  {{#if @model.eventDate}}
                    {{formatDateTime @model.eventDate size='long'}}
                    {{#if @model.eventTime}}
                      at
                      {{@model.eventTime}}
                    {{/if}}
                  {{else}}
                    Date & time TBA
                  {{/if}}
                </span>
              </div>
              <div class='detail-row'>
                <span class='detail-label'>Venue</span>
                <span class='detail-value'>{{if
                    @model.venue
                    @model.venue
                    'Venue TBA'
                  }}</span>
              </div>
              {{#if @model.seatSection}}
                <div class='detail-row'>
                  <span class='detail-label'>Section</span>
                  <span class='detail-value'>{{@model.seatSection}}</span>
                </div>
              {{/if}}
              {{#if @model.ticketType}}
                <div class='detail-row'>
                  <span class='detail-label'>Ticket Type</span>
                  <span class='detail-value'>{{@model.ticketType}}</span>
                </div>
              {{/if}}
            </div>
          </div>

          <div class='details-card'>
            <h3 class='card-title'>
              <svg
                class='card-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' />
                <path d='M12 17h.01' />
              </svg>
              Ticket Information
            </h3>
            <div class='detail-grid'>
              <div class='detail-row'>
                <span class='detail-label'>Price</span>
                <span class='detail-value pricing'>
                  {{#if @model.ticketPrice}}
                    {{formatCurrency
                      @model.ticketPrice
                      currency='USD'
                      size='medium'
                    }}
                  {{else}}
                    Price TBA
                  {{/if}}
                </span>
              </div>
              <div class='detail-row'>
                <span class='detail-label'>Status</span>
                <span
                  class='detail-value
                    {{if @model.isAvailable "available" "unavailable"}}'
                >
                  {{if @model.isAvailable 'Available' 'Sold Out'}}
                </span>
              </div>
              {{#if @model.maxCapacity}}
                <div class='detail-row'>
                  <span class='detail-label'>Capacity</span>
                  <span class='detail-value'>{{@model.maxCapacity}}
                    people</span>
                </div>
              {{/if}}
              {{#if @model.soldTickets}}
                <div class='detail-row'>
                  <span class='detail-label'>Sold</span>
                  <span class='detail-value'>{{@model.soldTickets}}
                    tickets</span>
                </div>
              {{/if}}
            </div>
          </div>
        </div>

        {{#if this.showQRModal}}
          <div class='qr-ticket-section'>
            <div class='qr-header'>
              <h3>
                <svg
                  class='qr-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                  <rect x='7' y='7' width='3' height='3' />
                  <rect x='14' y='7' width='3' height='3' />
                  <rect x='7' y='14' width='3' height='3' />
                </svg>
                Your Digital Ticket
              </h3>
              <button class='close-qr' {{on 'click' this.toggleQRCode}}>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <line x1='18' y1='6' x2='6' y2='18' />
                  <line x1='6' y1='6' x2='18' y2='18' />
                </svg>
              </button>
            </div>

            <div class='qr-body'>
              <div class='ticket-preview'>
                <div class='preview-header'>
                  <h4>{{@model.eventName}}</h4>
                  <p>{{@model.artist}} • {{@model.venue}}</p>
                  <p>{{formatDateTime @model.eventDate size='medium'}}
                    {{#if @model.eventTime}}at {{@model.eventTime}}{{/if}}</p>
                </div>

                {{#if @model.ticketQRCode.data}}
                  <div class='qr-display'>
                    <div class='qr-wrapper'>
                      <@fields.ticketQRCode @format='embedded' />
                    </div>
                    <p class='qr-instruction'>Present this QR code at the venue
                      entrance</p>
                  </div>
                {{else}}
                  <div class='qr-placeholder'>
                    <svg
                      class='placeholder-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                      <rect x='7' y='7' width='3' height='3' />
                      <rect x='14' y='7' width='3' height='3' />
                      <rect x='7' y='14' width='3' height='3' />
                      <rect x='14' y='14' width='3' height='3' />
                    </svg>
                    <p>QR code will be activated after payment confirmation</p>
                  </div>
                {{/if}}
              </div>
            </div>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .isolated-stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 1rem;
      }

      .isolated-mat {
        max-width: 800px;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: white;
        border-radius: 16px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
      }

      .ticket-hero {
        position: relative;
        padding: 3rem 2rem 2rem;
        background: linear-gradient(
          135deg,
          #1e3a8a 0%,
          #3730a3 50%,
          #581c87 100%
        );
        color: white;
        overflow: hidden;
      }

      .hero-background {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background:
          radial-gradient(
            circle at 30% 70%,
            rgba(255, 255, 255, 0.1) 0%,
            transparent 50%
          ),
          radial-gradient(
            circle at 80% 20%,
            rgba(255, 255, 255, 0.05) 0%,
            transparent 30%
          );
      }

      .hero-content {
        position: relative;
        z-index: 1;
      }

      .event-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        padding: 0.5rem 1rem;
        border-radius: 50px;
        font-size: 0.875rem;
        font-weight: 600;
        margin-bottom: 1.5rem;
        border: 1px solid rgba(255, 255, 255, 0.3);
      }

      .event-badge.today {
        background: linear-gradient(135deg, #f59e0b, #d97706);
        animation: pulse 2s infinite;
      }

      .event-badge.started {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        animation: pulse 2s infinite;
      }

      .hero-title {
        font-size: clamp(1.75rem, 4vw, 2.5rem);
        font-weight: 700;
        margin: 0 0 0.5rem 0;
        line-height: 1.2;
        color: #ffffff;
      }

      .hero-artist {
        font-size: 1.25rem;
        font-weight: 400;
        margin: 0 0 1.5rem 0;
        opacity: 0.9;
        color: #e5e7eb;
      }

      .countdown-display {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(10px);
        padding: 1rem 1.5rem;
        border-radius: 12px;
        margin-bottom: 2rem;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .countdown-display.urgent {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.3);
        animation: urgentPulse 2s infinite;
      }

      @keyframes urgentPulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
        }
        50% {
          box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
        }
      }

      .countdown-icon {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
      }

      .countdown-text {
        font-size: 1.125rem;
        font-weight: 600;
      }

      .hero-actions {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .primary-action-button {
        background: linear-gradient(135deg, #10b981, #059669);
        color: white;
        border: none;
        padding: 1rem 2rem;
        border-radius: 12px;
        font-size: 1.125rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
      }

      .primary-action-button:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px rgba(16, 185, 129, 0.4);
      }

      .primary-action-button:disabled {
        opacity: 0.8;
        cursor: not-allowed;
      }

      .primary-action-button.purchasing {
        background: linear-gradient(135deg, #6366f1, #4f46e5);
      }

      .sold-out-action {
        background: rgba(107, 114, 128, 0.8);
        color: white;
        border: none;
        padding: 1rem 2rem;
        border-radius: 12px;
        font-size: 1.125rem;
        font-weight: 700;
        cursor: not-allowed;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
      }

      .action-icon {
        width: 20px;
        height: 20px;
      }

      .action-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .secondary-actions {
        display: flex;
        gap: 0.75rem;
      }

      .secondary-action {
        flex: 1;
        background: rgba(255, 255, 255, 0.2);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.3);
        padding: 0.75rem 1rem;
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        backdrop-filter: blur(10px);
      }

      .secondary-action:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: translateY(-1px);
      }

      .secondary-action svg {
        width: 16px;
        height: 16px;
      }

      .availability-display {
        position: absolute;
        top: 2rem;
        right: 2rem;
        text-align: center;
        z-index: 2;
      }

      .availability-ring {
        width: 90px;
        height: 90px;
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(10px);
        border: 4px solid rgba(16, 185, 129, 0.8);
        margin-bottom: 0.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .availability-ring.medium {
        border-color: rgba(245, 158, 11, 0.8);
      }

      .availability-ring.low {
        border-color: rgba(239, 68, 68, 0.8);
        animation: lowAvailabilityPulse 3s infinite;
      }

      @keyframes lowAvailabilityPulse {
        0%,
        100% {
          border-color: rgba(239, 68, 68, 0.6);
        }
        50% {
          border-color: rgba(239, 68, 68, 0.9);
        }
      }

      .availability-percentage {
        font-size: 1.375rem;
        font-weight: 800;
        line-height: 1;
        color: #1f2937;
      }

      .availability-label {
        font-size: 0.6875rem;
        font-weight: 600;
        color: #374151;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 2px;
      }

      .capacity-info {
        font-size: 0.75rem;
        color: #1f2937;
        font-weight: 500;
      }

      .ticket-details-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
        padding: 2rem;
      }

      @media (max-width: 640px) {
        .ticket-details-grid {
          grid-template-columns: 1fr;
        }

        .availability-display {
          position: static;
          margin-top: 2rem;
        }

        .hero-actions {
          margin-top: 1rem;
        }
      }

      .details-card {
        background: #f8fafc;
        border-radius: 12px;
        padding: 1.5rem;
        border: 1px solid #e2e8f0;
      }

      .card-title {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 1.125rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0 0 1.5rem 0;
      }

      .card-icon {
        width: 20px;
        height: 20px;
        color: #6366f1;
      }

      .detail-grid {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid #e5e7eb;
      }

      .detail-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }

      .detail-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: #6b7280;
        flex-shrink: 0;
      }

      .detail-value {
        font-size: 0.875rem;
        font-weight: 500;
        color: #1f2937;
        text-align: right;
        margin-left: 1rem;
      }

      .detail-value.pricing {
        font-size: 1rem;
        font-weight: 700;
        color: #059669;
      }

      .detail-value.available {
        color: #059669;
        font-weight: 600;
      }

      .detail-value.unavailable {
        color: #dc2626;
        font-weight: 600;
      }

      .qr-ticket-section {
        margin: 0 2rem 2rem;
        background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
        border-radius: 12px;
        border: 2px solid #0ea5e9;
        overflow: hidden;
        animation: slideDown 0.3s ease-out;
      }

      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .qr-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem;
        background: rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(14, 165, 233, 0.2);
      }

      .qr-header h3 {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 1.25rem;
        font-weight: 700;
        color: #0f172a;
        margin: 0;
      }

      .qr-icon {
        width: 24px;
        height: 24px;
        color: #0ea5e9;
      }

      .close-qr {
        background: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(14, 165, 233, 0.3);
        cursor: pointer;
        padding: 0.5rem;
        border-radius: 8px;
        color: #0ea5e9;
        transition: all 0.2s ease;
      }

      .close-qr:hover {
        background: white;
        border-color: #0ea5e9;
      }

      .close-qr svg {
        width: 20px;
        height: 20px;
      }

      .qr-body {
        padding: 1.5rem;
      }

      .ticket-preview {
        background: white;
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
      }

      .preview-header h4 {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0 0 0.5rem 0;
      }

      .preview-header p {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0.25rem 0;
      }

      .qr-display {
        margin: 2rem 0;
      }

      .qr-wrapper {
        display: inline-block;
        background: white;
        padding: 1.5rem;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        border: 1px solid #e5e7eb;
      }

      .qr-instruction {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 1rem 0 0 0;
        font-style: italic;
      }

      .qr-placeholder {
        padding: 3rem 2rem;
        color: #9ca3af;
      }

      .placeholder-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem;
        opacity: 0.5;
      }

      .qr-placeholder p {
        font-size: 0.875rem;
        margin: 0;
      }
    </style>
  </template>
}

export class EventTicketCard extends CardDef {
  static displayName = 'Event Ticket';
  static icon = MusicIcon;

  @field eventName = contains(StringField);
  @field artist = contains(StringField);
  @field venue = contains(StringField);
  @field eventDate = contains(DateField);
  @field eventTime = contains(StringField);
  @field ticketPrice = contains(NumberField);
  @field seatSection = contains(StringField);
  @field ticketType = contains(StringField);
  @field isAvailable = contains(BooleanField);
  @field ticketQRCode = contains(QRField);
  @field maxCapacity = contains(NumberField);
  @field soldTickets = contains(NumberField);

  @field title = contains(StringField, {
    computeVia: function (this: EventTicketCard) {
      try {
        const event = this.eventName ?? 'Unknown Event';
        const artist = this.artist ? ` - ${this.artist}` : '';
        return `${event}${artist}`;
      } catch (e) {
        console.error('EventTicketCard: Error computing title', e);
        return 'Event Ticket';
      }
    },
  });

  static embedded = EventTicketEmbedded;

  static isolated = EventTicketIsolated;
}
