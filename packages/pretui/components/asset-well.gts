// Pretui — AssetWell: a single-asset slot that is empty, uploading, filled or in error.
//
//   AssetWell  the one-asset slot: an invitation, a drop, an upload, a
//              preview, a failure — and a real file input behind all of it.
//   Gallery    explicit thumb-navigation over a known set: a hero stage
//              driven by an active index, and a rail of thumbnails that
//              selects, ranges and opens.
//
// Both live in the `media` territory and both are COLLECTION-or-SLOT layers
// over machinery that already exists in this kit. Neither ships a drop
// engine, a file input, a media adapter or a zoom viewer, because
// `controls-files.gts`, `media-viewer.gts` and `media-lightbox.gts` already
// own those. Appendix M.6's adapter contract is the reason a gallery of
// mixed kinds works here at all: the hero renders `<MediaViewer>` and never
// asks what it is looking at.
//
// ── What is NOT here, and where it already lives ────────────────────────
//
// A wrapping, virtualizable, multi-select thumbnail GRID is `AssetGrid`
// (media-assets.gts). It measures its real column count with a
// ResizeObserver, reserves every tile's aspect ratio, and inherits its whole
// load/empty/error/selection state machine from `DataComponent<T>`. Gallery
// is deliberately the OTHER shape — one stage, one rail — because that is
// what the sourcing analysis found missing (boxel-catalog §11) and because a
// second grid would be a second answer to a solved question. The two compose:
// `AssetGrid` for the shelf, `Gallery` for the item.
//
// Nothing here virtualizes. A rail is a known, bounded set — that is its
// definition. A corpus large enough to need windowing wants `AssetGrid` plus
// TanStack Virtual's core (Appendix M.1), not a rail.
//
// ── Better than the inspiration ─────────────────────────────────────────
//
// AssetWell, against `fields/image-source/components/image-source-editor.gts`:
//   • The source has TWO states (empty, filled). This has five — empty,
//     drag-over, in-flight, filled, failed — because an upload that can fail
//     and a slot that cannot say so is the defect, not the design.
//   • `id='is-url-input'` was a STATIC DOM id, so two wells on one card
//     produced duplicate ids and `<label for>` bound to the wrong input.
//     Nothing here owns a DOM id at all: the file input is reached through a
//     captured element reference inside `FileTrigger`.
//   • The source locally redefined the GLOBAL `--boxel-highlight` on its own
//     root to re-point a focus ring, leaking into every descendant. Every
//     knob here is `--pretui-well-*`.
//   • Its `adoptPickedFile` was a rendering modifier that wrote to the model,
//     so opening the editor dirtied the record with no user action. Nothing
//     here writes on render; every callback is reached from an event.
//   • `alt=''` was hardcoded on every image with no alt field anywhere on the
//     model, making those images permanently undescribable. `MediaAssetSpec`
//     carries `alt`, and `@altLabel` puts a real editor in front of it.
//   • `.remove-btn:focus`, not `:focus-visible`; danger state colour-only;
//     one `rgba(0,0,0,.15)` shadow outside the token system; no
//     `prefers-reduced-motion`. All four fixed.
//
// Gallery, against `multi-image-source-editor.gts` + `image-carousel.gts`:
//   • The source's dots were `<div role='button'>` with a click handler, no
//     `tabindex` and no keydown — unreachable by keyboard — and
//     `role='presentation'` on the containers stripped the strip from the
//     a11y tree. Here the rail is a real listbox with one tab stop, arrows,
//     Home/End, Space, Enter, Shift-range and Ctrl/Cmd+A.
//   • `aria-label='Show this image'` was identical on every thumb. Here each
//     option's name is computed — name, kind, position — so "3 of 8" is
//     audible.
//   • Its arrows lacked `type='button'` and submitted any enclosing form;
//     `all: unset` wiped the focus ring. Buttons here are `<Button>`.
//   • A 1s opacity transition with no reduced-motion guard, and an active dot
//     distinguished by two near-identical greys. Selection here carries a
//     check glyph, a ring and `aria-selected`; motion is behind the switch.
//   • No autoplay and no timers — which `image-carousel.gts` also got right,
//     and which is kept deliberately rather than by accident.
//   • The one genuinely new idea: an INTRINSIC rail. A mixed set letterboxed
//     into one cell ratio is the usual answer and it is wrong — it throws
//     away the shape of the picture, which is most of what a thumbnail is
//     for. Cells here keep their own aspect ratio at a shared height, so a
//     panorama reads as a panorama. `@cellFit` opts back into a locked ratio
//     when uniformity matters more.
//
// Realm laws observed: no timers, no `Date.now`, no `Math.random`, no
// side-effect CSS imports, unnamed container queries only, no `.dark`, every
// colour a token with a light fallback. The one lifecycle resource — an
// object URL for the uncontrolled local preview — is revoked when it is
// replaced and again in `willDestroy`.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { Button } from './button';
import { IconButton } from './icon-button';
import { Dropzone } from './dropzone';
import type { FileRejection } from '../internal/file-intake';
import { ProgressBar } from './progress-bar';
import { Spinner } from './spinner';
import { iconFor } from '../icon-registry';
import { Token } from './token';
import { MediaViewer } from './media-viewer';
import { formatBytes, resolveAsset } from '../internal/media-viewer';
import type { MediaAssetSpec, ResolvedMediaAsset } from '../internal/media-viewer';
import { formatClock } from '../internal/reading-format';
import { cssStyle } from '../pretui-css';
import { FALLBACK_RATIO, KIND_WORD } from '../internal/media-library';

// ═══════════════════════════════════════════════════════════════════════
// AssetWell
// ═══════════════════════════════════════════════════════════════════════

/** The five states, in precedence order. `over` is deliberately NOT one of
 * them — a drag can happen over a filled well as easily as an empty one, so
 * it is an orthogonal `data-over` flag rather than a sixth state. */
export type AssetWellState = 'empty' | 'uploading' | 'filled' | 'error';

export interface AssetWellSignature {
  Args: {
    /** Controlled asset. `null` means "deliberately empty"; omit the arg
     * entirely for the uncontrolled case, where the well holds its own. */
    asset?: MediaAssetSpec | null;
    /** Initial asset for the uncontrolled case. */
    defaultAsset?: MediaAssetSpec | null;
    /** Fires whenever the well's own asset changes — on adopt in the
     * uncontrolled case, and on remove in both. A controlled well never
     * invents an asset, so this stays quiet until you clear it. */
    onAssetChange?: (asset: MediaAssetSpec | null) => void;
    /** THE event. Fires with the accepted file from a drop or a pick, before
     * any preview exists. Upload from here. */
    onSelect?: (file: File) => void;
    /** Fires with everything that failed screening, one reason each. */
    onReject?: (rejections: FileRejection[]) => void;
    /** Fires when the reader clears the slot. */
    onRemove?: () => void;
    /** Fires from the failure state's retry button. Omit it and no retry
     * button is offered — an affordance that does nothing is worse than
     * none. */
    onRetry?: () => void;
    /** Fires from the in-flight state's cancel button, on the same terms. */
    onCancel?: () => void;

    /** Put the well in its in-flight state. */
    uploading?: boolean;
    /** Completed fraction, 0–1. Omit while `@uploading` for an indeterminate
     * spinner — a fake percentage is a lie with a progress bar around it. */
    uploadFraction?: number;
    /** Non-empty puts the well in its failure state, and this is the text
     * the reader is shown. */
    errorMessage?: string;

    /** An `<input accept>` list — `'image/*, .pdf'`. Enforced on BOTH the
     * picker and the drop. */
    accept?: string;
    /** Largest acceptable file, in bytes. */
    maxSize?: number;
    /** Headline for the empty invitation. */
    label?: string;
    /** Second line of the invitation. Say what is allowed, in words. */
    hint?: string;
    /** Aspect ratio reserved for the preview — `'16 / 9'`, `'1 / 1'`.
     * Defaults to the asset's own, then to 4 / 3. Reserving it before the
     * bytes arrive is why the card never reflows (Appendix M.8). */
    ratio?: string;
    /** icon-registry name for the empty state's glyph. @default 'ImagePlaceholder' */
    icon?: string;
    /** Dimmed and inert. Drops are ignored. */
    disabled?: boolean;
    /** Show the preview and nothing that mutates — no replace, no remove. */
    viewOnly?: boolean;
    /** Offer an alt-text line under the preview. The catalog source made
     * every image permanently undescribable by hardcoding `alt=''`; this is
     * the fix, and it is opt-in only because some slots really are
     * decorative. */
    altLabel?: string;
  };
  Blocks: {
    /** Replaces the preview entirely. Receives the resolved asset. */
    preview: [ResolvedMediaAsset];
    /** Replaces the empty invitation's copy. The browse button is NOT part
     * of this block — it is the keyboard path and cannot be designed away. */
    empty: [];
    /** Extra controls beside Remove in the filled state. */
    actions: [ResolvedMediaAsset];
  };
  Element: HTMLDivElement;
}

/**
 * One asset, one slot.
 *
 * The composition is the design: `Dropzone` is the root, always, in every
 * state. That single decision buys three things the catalog source paid for
 * by hand and still got wrong.
 *
 * 1. **The keyboard path can never go missing.** `Dropzone` renders a
 *    `FileTrigger`, which encapsulates a real `<input type='file'>`, and it
 *    renders it OUTSIDE the replaceable block on purpose. A drop zone that
 *    is only a drop zone is unreachable by keyboard and unusable on touch;
 *    here the button is structural.
 * 2. **Drop-to-replace works.** Because the zone is the root rather than the
 *    empty state, dragging a new file onto a FILLED well replaces it. The
 *    source could only drop into an empty slot.
 * 3. **Screening happens once, in one place.** Accept lists and size limits
 *    are enforced identically on the drop path and the picker path, with the
 *    same wording in the same live region, because it is the same code.
 */
export class AssetWell extends Component<AssetWellSignature> {
  /** Uncontrolled asset. `undefined` means "the caller's `@defaultAsset`
   * still applies"; `null` is a real, chosen emptiness. */
  @tracked private ownAsset: MediaAssetSpec | null | undefined = undefined;

  /** Deliberately NOT tracked: written from an event handler and read only
   * when the next file arrives or the component dies. Reading it during
   * render would make revocation a render dependency. */
  private objectUrl: string | undefined;

  @tracked private announcement = '';

  // ── asset resolution ───────────────────────────────────────────────────

  get controlled(): boolean {
    return this.args.asset !== undefined;
  }

  get asset(): MediaAssetSpec | null {
    if (this.controlled) {
      return this.args.asset ?? null;
    }
    if (this.ownAsset !== undefined) {
      return this.ownAsset;
    }
    return this.args.defaultAsset ?? null;
  }

  get resolved(): ResolvedMediaAsset | undefined {
    const raw = this.asset;
    return raw ? resolveAsset(raw) : undefined;
  }

  // ── state machine ──────────────────────────────────────────────────────

  get errorText(): string {
    return (this.args.errorMessage ?? '').trim();
  }

  get state(): AssetWellState {
    if (this.errorText) {
      return 'error';
    }
    if (this.args.uploading) {
      return 'uploading';
    }
    return this.asset ? 'filled' : 'empty';
  }

  get isFilled(): boolean {
    return this.state === 'filled';
  }
  get isEmpty(): boolean {
    return this.state === 'empty';
  }
  get isUploading(): boolean {
    return this.state === 'uploading';
  }
  get isError(): boolean {
    return this.state === 'error';
  }

  /** The zone is inert while a file is in flight as well as when disabled:
   * a second drop mid-upload is a race the caller never asked for. */
  get inert(): boolean {
    return (this.args.disabled ?? false) || this.isUploading;
  }

  get mutable(): boolean {
    return !(this.args.viewOnly ?? false);
  }

  // ── copy ───────────────────────────────────────────────────────────────

  get label(): string {
    return this.args.label ?? 'Drop a file here';
  }
  get hint(): string | undefined {
    return this.args.hint;
  }
  get iconName(): string {
    return this.args.icon ?? 'ImagePlaceholder';
  }

  /** The browse button's wording follows the state, because "Browse files"
   * beside a filled preview reads as "add another" and this slot holds one. */
  get browseLabel(): string {
    if (!this.mutable) {
      return '';
    }
    if (this.isError) {
      return 'Choose another file';
    }
    return this.isFilled ? 'Replace file' : 'Choose a file';
  }

  get percent(): number {
    const raw = this.args.uploadFraction;
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(raw * 100)));
  }
  get determinate(): boolean {
    return typeof this.args.uploadFraction === 'number';
  }
  get percentText(): string {
    return this.percent + '%';
  }

  get uploadingName(): string {
    return this.resolved?.label ?? 'file';
  }

  get metaLine(): string {
    const asset = this.resolved;
    if (!asset) {
      return '';
    }
    const bits: string[] = [KIND_WORD[asset.kind]];
    const size = formatBytes(asset.bytes);
    if (size) {
      bits.push(size);
    }
    if (asset.width && asset.height) {
      bits.push(asset.width + ' × ' + asset.height);
    }
    if (asset.duration) {
      bits.push(formatClock(asset.duration));
    }
    return bits.join(' · ');
  }

  get removeLabel(): string {
    return 'Remove ' + (this.resolved?.label ?? 'file');
  }

  get altText(): string {
    return this.resolved?.alt ?? '';
  }

  /** Validate-or-drop through the shared guard. A caller string is never
   * interpolated into a style attribute — `@ratio` of
   * `red; background: url(…)` would otherwise inject declarations. */
  get frameStyle() {
    return cssStyle(
      '--pretui-well-aspect',
      this.args.ratio ?? this.resolved?.aspectRatio ?? FALLBACK_RATIO,
    );
  }

  // ── behaviour ──────────────────────────────────────────────────────────

  private releaseUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = undefined;
    }
  }

  /** The one place a resource is freed. `willDestroy` alone is not enough —
   * a well that adopts six files in a row would strand five blobs for the
   * life of the page — so every adopt and every remove frees the previous
   * one first. */
  willDestroy(): void {
    super.willDestroy();
    this.releaseUrl();
  }

  private publish(next: MediaAssetSpec | null): void {
    if (!this.controlled) {
      this.ownAsset = next;
    }
    this.args.onAssetChange?.(next);
  }

  takeFiles = (files: File[]): void => {
    const file = files[0];
    if (!file) {
      return;
    }
    this.releaseUrl();
    // A controlled well never invents an asset: the caller owns what is
    // shown, and inventing a blob URL it did not ask for would leak a
    // resource it cannot see. Uncontrolled, the local preview IS the value.
    if (!this.controlled) {
      const url = URL.createObjectURL(file);
      this.objectUrl = url;
      this.publish({
        src: url,
        name: file.name,
        mimeType: file.type || undefined,
        bytes: file.size,
      });
    }
    this.announcement = file.name + ' added.';
    this.args.onSelect?.(file);
  };

  removeAsset = (): void => {
    this.releaseUrl();
    this.announcement = 'File removed.';
    this.publish(null);
    this.args.onRemove?.();
  };

  retry = (): void => {
    this.args.onRetry?.();
  };

  cancel = (): void => {
    this.args.onCancel?.();
  };

  <template>
    <div
      class='pretui-well'
      data-state={{this.state}}
      data-disabled={{if @disabled 'true'}}
      data-view-only={{unless this.mutable 'true'}}
      style={{this.frameStyle}}
      data-test-pretui-asset-well
      ...attributes
    >
      <Dropzone
        @accept={{@accept}}
        @maxSize={{@maxSize}}
        @maxFiles={{1}}
        @multiple={{false}}
        @disabled={{this.inert}}
        @browseLabel={{this.browseLabel}}
        @onSelect={{this.takeFiles}}
        @onReject={{@onReject}}
      >
        {{#if this.isEmpty}}
          {{#if (has-block 'empty')}}
            {{yield to='empty'}}
          {{else}}
            {{#let (iconFor this.iconName) as |Glyph|}}
              {{#if Glyph}}
                <Glyph class='pretui-well-glyph' aria-hidden='true' />
              {{/if}}
            {{/let}}
            <p class='pretui-well-label'>{{this.label}}</p>
            {{#if this.hint}}
              <p class='pretui-well-hint'>{{this.hint}}</p>
            {{/if}}
          {{/if}}

        {{else if this.isUploading}}
          <div class='pretui-well-busy'>
            {{#if this.determinate}}
              <ProgressBar
                @value={{this.percent}}
                @label='Uploading'
                @count={{this.percentText}}
              />
            {{else}}
              <p class='pretui-well-spin'>
                <Spinner />
                <span>Uploading {{this.uploadingName}}…</span>
              </p>
            {{/if}}
            {{#if @onCancel}}
              <Button
                @tone='neutral'
                @appearance='plain'
                @size='s'
                {{on 'click' this.cancel}}
                data-test-pretui-well-cancel
              >Cancel upload</Button>
            {{/if}}
          </div>

        {{else if this.isError}}
          <div class='pretui-well-fail'>
            {{!-- The failure channel is a glyph AND a word AND a role,
                never a colour — Appendix L, and the one thing the source had
                no answer for at all. --}}
            <p class='pretui-well-failLine'>
              <span class='pretui-well-failMark' aria-hidden='true'>!</span>
              <span class='pretui-well-failText'>{{this.errorText}}</span>
            </p>
            {{#if @onRetry}}
              <Button
                @tone='danger'
                @appearance='outlined'
                @size='s'
                {{on 'click' this.retry}}
                data-test-pretui-well-retry
              >Try again</Button>
            {{/if}}
          </div>

        {{else if this.resolved}}
          <div class='pretui-well-shot'>
            <div class='pretui-well-frame'>
              {{#if (has-block 'preview')}}
                {{yield this.resolved to='preview'}}
              {{else}}
                <MediaViewer @asset={{this.resolved}} />
              {{/if}}
            </div>
            {{#if this.mutable}}
              <div class='pretui-well-tools'>
                {{yield this.resolved to='actions'}}
                <IconButton
                  @label={{this.removeLabel}}
                  @variant='ghost'
                    {{on 'click' this.removeAsset}}
                  data-test-pretui-well-remove
                >×</IconButton>
              </div>
            {{/if}}
          </div>
          <p class='pretui-well-meta'>
            <span class='pretui-well-name'>{{this.resolved.label}}</span>
            {{#if this.metaLine}}
              <Token @value={{this.metaLine}} />
            {{/if}}
          </p>
          {{#if @altLabel}}
            <p class='pretui-well-alt'>
              <span class='pretui-well-altKey'>{{@altLabel}}</span>
              <span class='pretui-well-altVal'>{{if
                  this.altText
                  this.altText
                  'Not described yet'
                }}</span>
            </p>
          {{/if}}
        {{/if}}
      </Dropzone>

      {{!-- One polite channel for the well's OWN transitions. Screening
          messages are announced by Dropzone's status region, so this says
          only what that one cannot: adopted, and removed. --}}
      <p
        class='pretui-well-live'
        role='status'
        aria-live='polite'
      >{{this.announcement}}</p>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-well {
          --pretui-well-aspect: 4 / 3;
          display: grid;
          gap: var(--space-2, 6px);
          min-width: 0;
        }
        .pretui-well[data-disabled='true'] {
          opacity: 0.55;
        }

        /* ── empty ── */
        .pretui-well-glyph {
          width: var(--pretui-well-glyph-size, 26px);
          height: var(--pretui-well-glyph-size, 26px);
          color: var(--muted-foreground);
        }
        .pretui-well-label {
          margin: 0;
          font-size: var(--text-ui-lg, 15px);
          font-weight: var(--weight-medium, 500);
          color: var(--foreground);
        }
        .pretui-well-hint {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }

        /* ── in flight ── */
        .pretui-well-busy {
          display: grid;
          gap: var(--space-2, 6px);
          justify-items: center;
          width: 100%;
          min-width: 0;
        }
        .pretui-well-spin {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }

        /* ── failed ── */
        .pretui-well-fail {
          display: grid;
          gap: var(--space-2, 6px);
          justify-items: center;
          min-width: 0;
        }
        .pretui-well-failLine {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          margin: 0;
          min-width: 0;
        }
        .pretui-well-failMark {
          display: grid;
          place-items: center;
          flex-shrink: 0;
          width: 17px;
          height: 17px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
          color: var(--destructive-foreground);
          background: var(--destructive);
        }
        .pretui-well-failText {
          font-size: var(--text-ui-sm, 11.5px);
          color: color-mix(
            in oklch,
            var(--destructive) 62%,
            var(--foreground)
          );
        }

        /* ── filled ── */
        .pretui-well-shot {
          position: relative;
          width: 100%;
          min-width: 0;
        }
        .pretui-well-frame {
          /* Reserved BEFORE the bytes arrive. The Law-8 corollary the catalog
             audit found rediscovered three times: a value that arrives late
             reserves its space. */
          aspect-ratio: var(--pretui-well-aspect);
          display: grid;
          place-items: center;
          overflow: hidden;
          border-radius: var(--radius);
          background: color-mix(
            in oklch,
            var(--foreground) 6%,
            var(--card)
          );
        }
        .pretui-well-frame > * {
          max-width: 100%;
          max-height: 100%;
          min-width: 0;
        }
        .pretui-well-tools {
          position: absolute;
          inset-block-start: var(--space-2, 6px);
          inset-inline-end: var(--space-2, 6px);
          display: flex;
          gap: var(--space-1, 4px);
          /* Never hover-only: the tools are always present, and they simply
             gain contrast when the well is engaged. A control that is
             focusable and invisible is worse than no control (Appendix M.8). */
          opacity: 0.72;
          transition: opacity var(--pretui-well-transition, 140ms) ease;
        }
        .pretui-well:hover .pretui-well-tools,
        .pretui-well:focus-within .pretui-well-tools {
          opacity: 1;
        }
        .pretui-well-meta {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: var(--space-2, 6px);
          margin: 0;
          min-width: 0;
        }
        .pretui-well-name {
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: var(--text-ui-md, 12.5px);
          font-weight: var(--weight-medium, 500);
          color: var(--foreground);
        }
        .pretui-well-alt {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: var(--space-2, 6px);
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
        }
        .pretui-well-altKey {
          color: var(--muted-foreground);
        }
        .pretui-well-altVal {
          color: var(--foreground);
        }

        /* The live region is text for assistive technology only. Not
           `display:none` — that removes it from the accessibility tree along
           with everything it was going to say. */
        .pretui-well-live {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }

        @media (prefers-reduced-motion: reduce) {
          .pretui-well-tools {
            transition: none;
          }
        }
        /* No hover on a coarse pointer, so the tools stop pretending. */
        @media (any-pointer: coarse) {
          .pretui-well-tools {
            opacity: 1;
          }
        }
      }
    </style>
  </template>
}
