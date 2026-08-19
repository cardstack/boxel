import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import CircleX from '@cardstack/boxel-icons/circle-x';
import CircleAlert from '@cardstack/boxel-icons/circle-alert';

interface Signature {
  Args: {
    // 'error' → red CircleX; anything else → amber CircleAlert.
    tone: string;
    // Optional source location, rendered as "line:column" when line is set.
    line?: number;
    column?: number;
    message?: string;
    // Optional trailing badge text, rendered as "[trailing]" (e.g. a lint rule).
    trailing?: string;
  };
  Element: HTMLElement;
}

// A single error/violation row: severity icon, optional location, message, and
// an optional trailing badge. Shared by the lint and parse row templates.
export class ResultDetailRow extends GlimmerComponent<Signature> {
  <template>
    <div class='detail-row' ...attributes>
      {{#if (eq @tone 'error')}}
        <CircleX
          class='row-icon row-error'
          width='14'
          height='14'
          aria-label='error'
        />
      {{else}}
        <CircleAlert
          class='row-icon row-warning'
          width='14'
          height='14'
          aria-label='warning'
        />
      {{/if}}
      {{#if @line}}
        <span class='row-location'>{{@line}}:{{@column}}</span>
      {{/if}}
      <span class='row-message'>{{@message}}</span>
      {{#if @trailing}}
        <span class='row-trailing'>[{{@trailing}}]</span>
      {{/if}}
    </div>
    <style scoped>
      .detail-row {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
      }
      .row-icon {
        flex-shrink: 0;
        align-self: center;
      }
      .row-error {
        color: oklch(55% 0.22 25);
      }
      .row-warning {
        color: oklch(68% 0.17 55);
      }
      .row-location {
        flex-shrink: 0;
        color: var(--muted-foreground, var(--boxel-500));
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-xs);
      }
      .row-message {
        flex: 1;
      }
      .row-trailing {
        flex-shrink: 0;
        color: var(--muted-foreground, var(--boxel-500));
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
}
