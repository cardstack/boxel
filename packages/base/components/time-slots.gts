import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

interface TimeSlotsConfiguration {
  timeSlotsOptions?: {
    availableSlots?: string[];
  };
}

interface TimeSlotsSignature {
  Args: {
    model?: any;
    config?: TimeSlotsConfiguration;
  };
}

// ³ TimeSlots Component
export class TimeSlots extends GlimmerComponent<TimeSlotsSignature> {
  @tracked selectedSlot: string | null = null;

  get config(): TimeSlotsConfiguration | undefined {
    return this.args.config as TimeSlotsConfiguration | undefined;
  }

  get slots(): string[] {
    const configSlots = this.config?.timeSlotsOptions?.availableSlots;
    if (configSlots) return configSlots;

    return [
      '09:00 AM',
      '10:00 AM',
      '11:00 AM',
      '12:00 PM',
      '01:00 PM',
      '02:00 PM',
      '03:00 PM',
      '04:00 PM',
      '05:00 PM',
    ];
  }

  constructor(owner: any, args: any) {
    super(owner, args);
    this.selectedSlot = this.args.model?.value || null;
  }

  @action
  selectSlot(slot: string) {
    this.selectedSlot = slot;
    if (this.args.model) {
      // Convert 12-hour slot format to 24-hour for storage
      try {
        if (slot.includes('AM') || slot.includes('PM')) {
          const isPM = slot.includes('PM');
          const timeOnly = slot.replace(/\s*(AM|PM)/i, '').trim();
          const [h, m] = timeOnly.split(':').map(Number);

          if (!isNaN(h) && !isNaN(m)) {
            const hours24 = isPM ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
            this.args.model.value = `${hours24.toString().padStart(2, '0')}:${m
              .toString()
              .padStart(2, '0')}`;
            return;
          }
        }
      } catch (e) {
        console.warn('TimeSlots: Error converting time slot format', e);
      }

      // Fallback: store as-is
      this.args.model.value = slot;
    }
  }

  <template>
    <div class='time-slots' data-test-time-slots>
      <label class='slots-label'>Available Time Slots</label>
      <div class='slots-grid'>
        {{#each this.slots as |slot|}}
          <button
            type='button'
            {{on 'click' (fn this.selectSlot slot)}}
            class='slot-button {{if (eq this.selectedSlot slot) "selected" ""}}'
            data-test-slot={{slot}}
          >
            {{slot}}
          </button>
        {{/each}}
      </div>
      {{#if this.selectedSlot}}
        <div class='selected-indicator'>
          <svg
            class='check-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <polyline points='20 6 9 17 4 12'></polyline>
          </svg>
          Selected:
          {{this.selectedSlot}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .time-slots {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .slots-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }

      .slots-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
      }

      .slot-button {
        padding: 0.5rem 0.75rem;
        font-size: 0.8125rem;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.375rem);
        background: var(--background, #ffffff);
        color: var(--foreground, #1a1a1a);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .slot-button:hover {
        border-color: var(--primary, #3b82f6);
      }

      .slot-button.selected {
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-color: var(--primary, #3b82f6);
      }

      .selected-indicator {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        color: var(--chart2, #10b981);
      }

      .check-icon {
        width: 0.875rem;
        height: 0.875rem;
      }
    </style>
  </template>
}
