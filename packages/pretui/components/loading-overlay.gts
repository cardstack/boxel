// Pretui — LoadingOverlay: a scrim and spinner over a region whose content stays mounted.
import Component from '@glimmer/component';
import { Spinner } from './spinner';
import type { PretuiSizeArg } from '../pretui-primitives';

export interface LoadingOverlaySignature {
  Args: {
    /** Show the overlay. The content underneath renders either way. */
    open?: boolean;
    /** What is loading, announced and shown under the spinner (default 'Loading'). */
    label?: string;
    /** Paint the label under the spinner; it is announced either way. */
    showLabel?: boolean;
    /** Frost the content under the scrim instead of only tinting it. */
    blur?: boolean;
    /** Make the content inert while open, so a half-loaded form cannot be edited. */
    lock?: boolean;
    /** Spinner size on the kit scale, or pixels (default 'l'). */
    size?: number | PretuiSizeArg;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

/**
 * The region keeps its content: the overlay sits over it rather than
 * replacing it, so nothing reflows when loading starts or stops (Law 8).
 * Skeleton is for content that does not exist yet, Spinner is inline, and
 * LoadingState is a whole scene.
 *
 * `aria-busy` goes on the region, so assistive technology holds off reading
 * changes until it clears. The status is one live region that stays mounted,
 * so the announcement is not lost to a mount in the same frame. `@lock` adds
 * `inert` to the content, which removes it from the tab order and the
 * accessibility tree until loading ends.
 */
export class LoadingOverlay extends Component<LoadingOverlaySignature> {
  get open(): boolean {
    return this.args.open ?? false;
  }
  get label(): string {
    return this.args.label ?? 'Loading';
  }
  get locked(): boolean {
    return this.open && (this.args.lock ?? false);
  }

  <template>
    <div
      class='pretui-loading-overlay'
      aria-busy={{if this.open 'true' 'false'}}
      data-open={{if this.open 'true' 'false'}}
      data-test-pretui-loading-overlay
      ...attributes
    >
      <div class='pretui-lo-content' inert={{this.locked}} data-test-pretui-loading-overlay-content>
        {{yield}}
      </div>
      <div class='pretui-lo-status' role='status' data-test-pretui-loading-overlay-status>
        {{#if this.open}}<span class='pretui-lo-sr'>{{this.label}}</span>{{/if}}
      </div>
      {{#if this.open}}
        <div class='pretui-lo-scrim' data-blur={{if @blur 'true' 'false'}} aria-hidden='true' data-test-pretui-loading-overlay-scrim>
          <Spinner @size={{if @size @size 'l'}} aria-hidden='true' role='presentation' />
          {{#if @showLabel}}<span class='pretui-lo-label'>{{this.label}}</span>{{/if}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-loading-overlay {
          position: relative;
          isolation: isolate;
          min-inline-size: 0;
        }
        .pretui-lo-scrim {
          position: absolute;
          inset: 0;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-2, 0.5rem);
          border-radius: inherit;
          color: var(--foreground);
          background: color-mix(in oklch, var(--card) var(--pretui-loading-overlay-mix, 72%), transparent);
          animation: pretui-lo-in var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease-out) both;
        }
        .pretui-lo-scrim[data-blur='true'] {
          backdrop-filter: blur(var(--pretui-loading-overlay-blur, 3px));
        }
        .pretui-lo-label {
          font-size: var(--text-ui-sm, 0.8125rem);
          color: var(--muted-foreground);
        }
        .pretui-lo-sr {
          position: absolute;
          inline-size: 1px;
          block-size: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        @keyframes pretui-lo-in {
          from {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-lo-scrim {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
