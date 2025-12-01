import { eq } from '@cardstack/boxel-ui/helpers';
import GlimmerComponent from '@glimmer/component';

interface AudioTimeDisplaySignature {
  Element: HTMLSpanElement;
  Args: {
    currentTime: number; // Current time in seconds
    duration: number; // Total duration in seconds
    variant?: 'inline' | 'compact'; // Display style
  };
}

export class AudioTimeDisplay extends GlimmerComponent<AudioTimeDisplaySignature> {
  // ² Audio time display component
  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  <template>
    {{#if (eq @variant 'compact')}}
      <span class='time-display-compact'>
        {{this.formatTime @currentTime}}<span
          class='separator'
        >/</span>{{this.formatTime @duration}}
      </span>
    {{else}}
      <div class='time-display'>
        <span>{{this.formatTime @currentTime}}</span>
        <span>{{this.formatTime @duration}}</span>
      </div>
    {{/if}}

    <style scoped>
      /* ³ Time display styles */
      .time-display {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        font-variant-numeric: tabular-nums;
      }

      .time-display-compact {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .separator {
        margin: 0 0.25rem;
      }
    </style>
  </template>
}
