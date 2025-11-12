import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import ClockIcon from '@cardstack/boxel-icons/clock';

// Configuration interface
interface TimeAgoConfiguration {
  timeAgoOptions?: {
    eventLabel?: string;
    updateInterval?: number;
  };
}

interface TimeAgoSignature {
  Args: {
    model?: any;
    config?: TimeAgoConfiguration;
  };
}

export class TimeAgo extends GlimmerComponent<TimeAgoSignature> {
  @tracked currentTime = Date.now();
  private intervalId: number | null = null;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.intervalId = window.setInterval(() => {
      this.currentTime = Date.now();
    }, 60000);
  }

  willDestroy() {
    super.willDestroy();
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
    }
  }

  get config(): TimeAgoConfiguration | undefined {
    return this.args.config as TimeAgoConfiguration | undefined;
  }

  get timestamp() {
    return this.args.model?.value ?? this.args.model;
  }

  get eventLabel() {
    return this.config?.timeAgoOptions?.eventLabel || 'Activity';
  }

  get relativeTime() {
    if (!this.timestamp) return 'Unknown time';

    const past = new Date(this.timestamp).getTime();
    const diff = this.currentTime - past;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
    return `${years} year${years > 1 ? 's' : ''} ago`;
  }

  <template>
    <div class='relative-time-item' data-test-relative-time>
      <div class='relative-time-icon'>
        <ClockIcon class='icon' />
      </div>
      <div class='relative-time-content'>
        <div class='relative-time-label'>{{this.eventLabel}}</div>
        <div class='relative-time-ago'>{{this.relativeTime}}</div>
      </div>
    </div>

    <style scoped>
      .relative-time-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--muted, #f5f5f5);
        border-radius: var(--radius, 0.375rem);
      }

      .relative-time-icon {
        flex-shrink: 0;
        width: 2.5rem;
        height: 2.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--background, #ffffff);
        border-radius: var(--radius, 0.375rem);
        color: var(--muted-foreground, #9ca3af);
      }

      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .relative-time-content {
        flex: 1;
        min-width: 0;
      }

      .relative-time-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
        margin-bottom: 0.125rem;
      }

      .relative-time-ago {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
      }
    </style>
  </template>
}
