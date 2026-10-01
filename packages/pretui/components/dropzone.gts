// Pretui — Dropzone: a drop target for files, with the same screening as FileTrigger.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { iconFor } from '../icon-registry';
import { FileTrigger } from './file-trigger';
import { screenFiles, screeningMessage } from '../internal/file-intake';
import type { FileRejection, ScreenOptions } from '../internal/file-intake';

// ═══════════════════════════════════════════════════════════════════════
// Dropzone
// ═══════════════════════════════════════════════════════════════════════

/** True when a drag actually carries files, rather than text or a link
 * dragged out of another part of the page. Checking this is what stops a
 * dropzone lighting up for a dragged paragraph. */
function dragCarriesFiles(event: DragEvent): boolean {
  let types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).indexOf('Files') !== -1;
}

/**
 * Drag-and-drop plumbing for one element.
 *
 * All four listeners live here rather than in the template because the root
 * is a non-interactive `<div>` (realm lint's `no-invalid-interactive` rejects
 * `{{on}}` on one) and because a drag's teardown must share the element's
 * lifetime.
 *
 * `depth` is the fix for the trap every hand-written dropzone hits:
 * `dragleave` fires when the pointer crosses onto a CHILD element, so a naive
 * handler clears the hover state while the pointer is still well inside the
 * zone. Counting enters against leaves is exact, and — unlike the usual
 * `setTimeout` workaround — needs no timer, which the realm forbids anyway.
 */
const dropTarget = modifier(
  (
    el: HTMLElement,
    [onFiles, onOver, disabled]: [
      (files: File[]) => void,
      (over: boolean) => void,
      boolean | undefined,
    ],
  ) => {
    let depth = 0;

    let enter = (event: Event) => {
      let drag = event as DragEvent;
      if (disabled || !dragCarriesFiles(drag)) {
        return;
      }
      drag.preventDefault();
      depth = depth + 1;
      if (depth === 1) {
        onOver(true);
      }
    };
    let over = (event: Event) => {
      let drag = event as DragEvent;
      if (disabled || !dragCarriesFiles(drag)) {
        return;
      }
      // preventDefault on dragover is what makes the element a drop target
      // at all; without it the browser navigates to the dropped file.
      drag.preventDefault();
      if (drag.dataTransfer) {
        drag.dataTransfer.dropEffect = 'copy';
      }
    };
    let leave = (event: Event) => {
      let drag = event as DragEvent;
      if (disabled || !dragCarriesFiles(drag)) {
        return;
      }
      depth = depth > 0 ? depth - 1 : 0;
      if (depth === 0) {
        onOver(false);
      }
    };
    let drop = (event: Event) => {
      let drag = event as DragEvent;
      if (disabled) {
        return;
      }
      drag.preventDefault();
      depth = 0;
      onOver(false);
      onFiles(Array.from(drag.dataTransfer?.files ?? []));
    };

    el.addEventListener('dragenter', enter);
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);

    return () => {
      // No `onOver(false)` here: the destructor runs during teardown, and
      // writing tracked state into a component that is being destroyed is
      // how a render assertion happens. Removing the listeners is enough.
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragover', over);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  },
);

export interface DropzoneSignature {
  Args: {
    /** an `<input accept>` list, enforced on BOTH the picker and the drop */
    accept?: string;
    /** allow more than one file per batch */
    multiple?: boolean;
    /** largest single file, in bytes */
    maxSize?: number;
    /** how many files one batch may contribute */
    maxFiles?: number;
    /** dimmed and inert; drops are ignored */
    disabled?: boolean;
    /** the headline inside the zone */
    label?: string;
    /** the second line — say what is allowed, in words, here */
    hint?: string;
    /** the browse button's text */
    browseLabel?: string;
    /** icon-registry name for the zone's glyph (default 'File') */
    icon?: string;
    /** receives everything that passed screening. Never called empty. */
    onSelect?: (files: File[]) => void;
    /** receives everything that did not, with a reason each */
    onReject?: (rejections: FileRejection[]) => void;
  };
  Blocks: {
    /** replaces the zone's body copy. The browse button and the status
     * region are NOT part of this block — they are the accessibility floor
     * and cannot be designed away. */
    default: [];
  };
  Element: HTMLDivElement;
}

export class Dropzone extends Component<DropzoneSignature> {
  @tracked private over = false;
  @tracked private status = '';

  get label(): string {
    return this.args.label ?? 'Drop files here';
  }
  get overLabel(): string {
    return 'Release to add';
  }
  get browseLabel(): string {
    return this.args.browseLabel ?? 'Browse files';
  }
  get iconName(): string {
    return this.args.icon ?? 'File';
  }
  get isOver(): boolean {
    return this.over && !this.args.disabled;
  }
  get screenOptions(): ScreenOptions {
    return {
      accept: this.args.accept,
      maxSize: this.args.maxSize,
      maxFiles: this.args.maxFiles,
      multiple: this.args.multiple,
    };
  }

  setOver = (over: boolean) => {
    this.over = over;
  };

  take = (files: File[]) => {
    if (this.args.disabled) {
      return;
    }
    let result = screenFiles(files, this.screenOptions);
    this.status = screeningMessage(result);
    if (result.accepted.length > 0) {
      this.args.onSelect?.(result.accepted);
    }
    if (result.rejected.length > 0) {
      this.args.onReject?.(result.rejected);
    }
  };

  <template>
    <div
      class='pretui-dropzone'
      data-over={{if this.isOver 'true'}}
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-dropzone
      {{dropTarget this.take this.setOver @disabled}}
      ...attributes
    >
      <div class='pretui-dropzone-body'>
        {{#if (has-block)}}
          {{yield}}
        {{else}}
          {{#let (iconFor this.iconName) as |Glyph|}}
            {{#if Glyph}}
              <Glyph class='pretui-dropzone-glyph' aria-hidden='true' />
            {{/if}}
          {{/let}}
          <p class='pretui-dropzone-label'>
            {{if this.isOver this.overLabel this.label}}
          </p>
          {{#if @hint}}
            <p class='pretui-dropzone-hint'>{{@hint}}</p>
          {{/if}}
        {{/if}}
        <FileTrigger
          @accept={{@accept}}
          @multiple={{@multiple}}
          @label={{this.browseLabel}}
          @disabled={{@disabled}}
          @size='s'
          @onSelect={{this.take}}
        />
      </div>
      <p class='pretui-dropzone-status' role='status' aria-live='polite'>
        {{this.status}}
      </p>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-dropzone {
          display: grid;
          gap: var(--space-3, 8px);
          padding: var(--space-6, 20px);
          border-radius: var(--radius-surface, 12px);
          background: var(--card);
          /* Law 1: depth is one property. The dashed ring is drawn with an
             outline, so the hairline shadow is still free to say elevation. */
          outline: 2px dashed
            color-mix(in oklch, var(--border) 88%, transparent);
          outline-offset: -6px;
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          transition:
            outline-color var(--pretui-dropzone-transition, 140ms) ease,
            background-color var(--pretui-dropzone-transition, 140ms) ease;
        }
        /* Law 5: the drop target lighting up encodes a state transition the
           reader would otherwise have to infer — "this element will take what
           you are holding". Reduced motion lands on the END state (the lit
           ring), it simply arrives without the fade. */
        .pretui-dropzone[data-over='true'] {
          outline-color: var(--ring);
          outline-style: solid;
          background: color-mix(
            in oklch,
            var(--primary) 6%,
            var(--card)
          );
        }
        .pretui-dropzone[data-disabled='true'] {
          opacity: 0.55;
        }
        .pretui-dropzone-body {
          display: grid;
          justify-items: center;
          gap: var(--space-2, 6px);
          text-align: center;
        }
        .pretui-dropzone-glyph {
          width: var(--pretui-dropzone-glyph-size, 24px);
          height: var(--pretui-dropzone-glyph-size, 24px);
          color: var(--muted-foreground);
        }
        .pretui-dropzone-label {
          margin: 0;
          font-size: var(--text-ui-lg, 15px);
          font-weight: var(--weight-medium, 500);
          color: var(--foreground);
        }
        .pretui-dropzone-hint {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-dropzone-status {
          margin: 0;
          min-height: 1em;
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 1.5;
          text-align: center;
          color: var(--muted-foreground);
        }
        .pretui-dropzone-status:empty {
          min-height: 0;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-dropzone {
            transition: none;
          }
        }
        /* The zone's whole job is a drag gesture, which a coarse pointer
           cannot perform. On touch the ring stops promising something the
           device cannot do and the button carries the interaction. */
        @media (any-pointer: coarse) {
          .pretui-dropzone {
            outline-style: none;
          }
        }
      }
    </style>
  </template>
}
