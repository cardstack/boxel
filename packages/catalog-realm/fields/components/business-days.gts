import GlimmerComponent from '@glimmer/component';
import { gt } from '@cardstack/boxel-ui/helpers';

export interface BusinessDaysSignature {
  Args: {
    model?: {
      start?: Date | string;
      end?: Date | string;
    };
    config?: any;
  };
}

export class BusinessDays extends GlimmerComponent<BusinessDaysSignature> {
  get calendarDays() {
    const start = this.args.model?.start;
    const end = this.args.model?.end;

    if (!start || !end) return 0;

    try {
      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      return Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  }

  get businessDays() {
    const start = this.args.model?.start;
    const end = this.args.model?.end;

    if (!start || !end) return 0;

    try {
      const startDate = new Date(start);
      const endDate = new Date(end);
      let count = 0;
      const current = new Date(startDate);

      while (current <= endDate) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          count++;
        }
        current.setDate(current.getDate() + 1);
      }

      return count;
    } catch {
      return 0;
    }
  }

  get startDisplay() {
    const start = this.args.model?.start;
    if (!start) return 'Not set';

    try {
      return new Date(start).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return String(start);
    }
  }

  get endDisplay() {
    const end = this.args.model?.end;
    if (!end) return 'Not set';

    try {
      return new Date(end).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return String(end);
    }
  }

  <template>
    <div class='business-days-calc' data-test-business-days>
      <div class='date-range-display'>
        <div class='date-item'>
          <div class='date-label'>Start Date</div>
          <div class='date-value'>{{this.startDisplay}}</div>
        </div>
        <div class='date-arrow'>→</div>
        <div class='date-item'>
          <div class='date-label'>End Date</div>
          <div class='date-value'>{{this.endDisplay}}</div>
        </div>
      </div>

      {{#if (gt this.calendarDays 0)}}
        <div class='days-summary'>
          <div class='days-row'>
            <span class='days-label'>Calendar Days:</span>
            <span class='days-value'>{{this.calendarDays}} days</span>
          </div>
          <div class='days-row business'>
            <span class='days-label'>Business Days:</span>
            <span class='days-value business-value'>
              {{this.businessDays}}
              days
            </span>
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .business-days-calc {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--muted, #f5f5f5);
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
      }

      .date-range-display {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .date-item {
        flex: 1;
      }

      .date-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #9ca3af);
        margin-bottom: 0.25rem;
      }

      .date-value {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
      }

      .date-arrow {
        color: var(--muted-foreground, #9ca3af);
        font-size: 1.25rem;
      }

      .days-summary {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border, #e0e0e0);
      }

      .days-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.875rem;
      }

      .days-label {
        color: var(--muted-foreground, #9ca3af);
      }

      .days-value {
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .business-value {
        color: var(--chart2, #10b981);
      }
    </style>
  </template>
}
