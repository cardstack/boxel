import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { and, not } from '@cardstack/boxel-ui/helpers';

interface CountdownConfiguration {
  countdownOptions?: {
    label?: string;
    showControls?: boolean;
  };
}

interface CountdownSignature {
  Args: {
    model?: any;
    config?: CountdownConfiguration;
  };
}

export class Countdown extends GlimmerComponent<CountdownSignature> {
  @tracked currentTime = Date.now();
  @tracked isRunning = true;
  private intervalId: number | null = null;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.startTimer();
  }

  willDestroy() {
    super.willDestroy();
    this.stopTimer();
  }

  startTimer() {
    if (this.intervalId) return;
    this.intervalId = window.setInterval(() => {
      if (this.isRunning) {
        this.currentTime = Date.now();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  @action
  toggleTimer() {
    this.isRunning = !this.isRunning;
  }

  @action
  resetTimer() {
    this.currentTime = Date.now();
    this.isRunning = true;
  }

  get config(): CountdownConfiguration | undefined {
    return this.args.config as CountdownConfiguration | undefined;
  }

  get targetDate() {
    return this.args.model?.value ?? this.args.model;
  }

  get label() {
    return this.config?.countdownOptions?.label || '';
  }

  get showControls() {
    return this.config?.countdownOptions?.showControls ?? true;
  }

  get timeRemaining() {
    const target = this.targetDate;
    if (!target)
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        expired: true,
      };

    const targetTime = new Date(target).getTime();
    const remaining = Math.max(0, targetTime - this.currentTime);

    if (remaining === 0) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        expired: true,
      };
    }

    return {
      days: Math.floor(remaining / (1000 * 60 * 60 * 24)),
      hours: Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((remaining % (1000 * 60)) / 1000),
      expired: false,
    };
  }

  get formattedTime() {
    const { days, hours, minutes, seconds, expired } = this.timeRemaining;
    if (expired) return 'Expired';

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    parts.push(`${String(hours).padStart(2, '0')}h`);
    parts.push(`${String(minutes).padStart(2, '0')}m`);
    parts.push(`${String(seconds).padStart(2, '0')}s`);

    return parts.join(' ');
  }

  <template>
    <div class='countdown-wrapper' data-test-countdown>
      {{#if this.label}}
        <div class='countdown-label'>{{this.label}}</div>
      {{/if}}
      <div
        class='countdown-display {{if this.timeRemaining.expired "expired" ""}}'
      >
        <div class='countdown-time'>{{this.formattedTime}}</div>
        {{#if (and (not this.timeRemaining.expired) this.showControls)}}
          <div class='countdown-controls'>
            <button
              type='button'
              {{on 'click' this.toggleTimer}}
              class='countdown-btn'
              data-test-countdown-toggle
            >
              {{#if this.isRunning}}
                Pause
              {{else}}
                Resume
              {{/if}}
            </button>
            <button
              type='button'
              {{on 'click' this.resetTimer}}
              class='countdown-btn'
              data-test-countdown-reset
            >
              Reset
            </button>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .countdown-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .countdown-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .countdown-display {
        background: linear-gradient(
          135deg,
          var(--primary, #3b82f6) 0%,
          var(--accent, #60a5fa) 100%
        );
        padding: 1.5rem;
        border-radius: var(--radius, 0.5rem);
        box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
      }

      .countdown-display.expired {
        background: linear-gradient(
          135deg,
          var(--muted, #6b7280) 0%,
          var(--muted-foreground, #9ca3af) 100%
        );
      }

      .countdown-time {
        font-size: 2rem;
        font-weight: 700;
        font-family: var(--font-mono, monospace);
        color: var(--primary-foreground, #ffffff);
        text-align: center;
        margin-bottom: 0.75rem;
      }

      .countdown-controls {
        display: flex;
        gap: 0.5rem;
        justify-content: center;
      }

      .countdown-btn {
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--primary, #3b82f6);
        background: var(--primary-foreground, #ffffff);
        border: none;
        border-radius: var(--radius, 0.375rem);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .countdown-btn:hover {
        background: var(--accent-foreground, #f0f9ff);
      }

      .countdown-btn:active {
        transform: scale(0.98);
      }
    </style>
  </template>
}
