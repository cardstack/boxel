import GlimmerComponent from '@glimmer/component';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

interface TimelineConfiguration {
  timelineOptions?: {
    eventName?: string;
    status?: 'complete' | 'active' | 'pending';
  };
}

interface TimelineSignature {
  Args: {
    model?: any;
    config?: TimelineConfiguration;
  };
}

// ³ Timeline Component
export class Timeline extends GlimmerComponent<TimelineSignature> {
  get config(): TimelineConfiguration | undefined {
    return this.args.config as TimelineConfiguration | undefined;
  }

  get eventName() {
    return this.config?.timelineOptions?.eventName || 'Event';
  }

  get eventTime() {
    return this.args.model?.value ?? this.args.model;
  }

  get status() {
    return this.config?.timelineOptions?.status || 'pending';
  }

  get statusColor() {
    switch (this.status) {
      case 'complete':
        return 'var(--chart2, #10b981)';
      case 'active':
        return 'var(--primary, #3b82f6)';
      default:
        return 'var(--muted-foreground, #9ca3af)';
    }
  }

  get timeDisplay() {
    if (!this.eventTime) return 'Pending';

    try {
      return new Date(this.eventTime).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return 'Pending';
    }
  }

  <template>
    <div class='timeline-event' data-test-timeline-event>
      <div
        class='timeline-marker'
        style={{htmlSafe (concat 'background-color: ' this.statusColor)}}
      ></div>
      <div class='timeline-content'>
        <div class='timeline-name'>{{this.eventName}}</div>
        <div class='timeline-time'>{{this.timeDisplay}}</div>
      </div>
    </div>

    <style scoped>
      .timeline-event {
        position: relative;
        padding-left: 1.5rem;
        padding-bottom: 1rem;
      }

      .timeline-marker {
        position: absolute;
        left: 0;
        top: 0.25rem;
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        border: 2px solid var(--background, #ffffff);
      }

      .timeline-content {
        padding-left: 0.5rem;
      }

      .timeline-name {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
        margin-bottom: 0.125rem;
      }

      .timeline-time {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
      }
    </style>
  </template>
}
