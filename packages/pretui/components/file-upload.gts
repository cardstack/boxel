// Pretui — FileUpload: the list of files being uploaded — progress, failure, retry and remove — under a drop target.
import Component from '@glimmer/component';
import { fn, hash } from '@ember/helper';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as toaster.gts / focus.gts)
import { modifier } from 'ember-modifier';
import { on } from '@ember/modifier';
import { Dropzone } from './dropzone';
import { ProgressBar } from './progress-bar';
import { FormatBytes } from './format-bytes';
import type { FileRejection } from '../internal/file-intake';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

export interface UploadFile {
  id: string;
  name: string;
  /** Bytes. */
  size?: number;
  status: UploadStatus;
  /** 0–100, while uploading. */
  progress?: number;
  /** What went wrong, when status is 'error'. */
  error?: string;
}

export interface FileUploadSignature {
  Args: {
    /** The list, owned by the caller: the component never uploads anything itself. */
    files: UploadFile[];
    /** Called with the files dropped or browsed for; add them to `@files` and start the upload. */
    onAdd?: (files: File[]) => void;
    /** Called with the files the drop target refused (type, size, count). */
    onReject?: (rejections: FileRejection[]) => void;
    onRemove?: (file: UploadFile) => void;
    /** Shows Retry on a failed row. */
    onRetry?: (file: UploadFile) => void;
    accept?: string;
    /** Allow several files at once (default true). */
    multiple?: boolean;
    /** At most this many files in the list; the drop target hides at the limit. */
    max?: number;
    /** Per-file size limit in bytes, enforced by the drop target. */
    maxSize?: number;
    /** The drop target's label and the list's accessible name. */
    label?: string;
    hint?: string;
    disabled?: boolean;
  };
  Blocks: {
    /** Replaces the default Dropzone — a FileTrigger button, say. Yielded
     * `add` (which cuts to the room left under @max) and `remaining`. */
    trigger: [{ add: (files: File[]) => void; remaining: number | undefined }];
  };
  Element: HTMLDivElement;
}

const STATUS_TEXT: Record<UploadStatus, string> = {
  queued: 'Waiting',
  uploading: 'Uploading',
  done: 'Uploaded',
  error: 'Failed',
};

/**
 * The list half of Ant Upload and Chakra FileUpload. Dropzone and FileTrigger pick files; this shows what happened to
 * them. It holds no bytes and runs no request — the caller owns `@files`,
 * uploads each one, and updates its status and progress. Files belong in a
 * FileDef link, never in card JSON.
 *
 * Each row names the file, its size, a progress bar while uploading, and a
 * status that is text, not only colour. A failed row says why and offers
 * Retry. Remove and Retry are named for their file ("Remove lot-7.pdf"). One
 * polite line sums the list up ("2 of 3 uploaded, 1 failed") so a screen
 * reader hears progress without every bar announcing itself.
 */
export class FileUpload extends Component<FileUploadSignature> {
  get files(): UploadFile[] {
    return this.args.files ?? [];
  }
  get multiple(): boolean {
    return this.args.multiple ?? true;
  }
  get full(): boolean {
    return this.args.max !== undefined && this.files.length >= this.args.max;
  }
  get remaining(): number | undefined {
    return this.args.max === undefined ? undefined : Math.max(0, this.args.max - this.files.length);
  }
  get rows() {
    return this.files.map((file) => ({
      file,
      statusText: STATUS_TEXT[file.status] ?? file.status,
      progress: Math.max(0, Math.min(100, file.progress ?? 0)),
      uploading: file.status === 'uploading',
      failed: file.status === 'error',
      removeLabel: `Remove ${file.name}`,
      retryLabel: `Retry ${file.name}`,
      progressLabel: `${file.name} upload progress`,
    }));
  }
  get summary(): string {
    let files = this.files;
    if (!files.length) {
      return '';
    }
    let done = files.filter((f) => f.status === 'done').length;
    let failed = files.filter((f) => f.status === 'error').length;
    let parts = [`${done} of ${files.length} uploaded`];
    if (failed) {
      parts.push(`${failed} failed`);
    }
    if (this.full) {
      parts.push('limit reached');
    }
    return parts.join(', ');
  }
  add = (files: File[]) => {
    let room = this.remaining;
    this.pending = { kind: 'added' };
    this.args.onAdd?.(room === undefined ? files : files.slice(0, room));
  };
  retry = (file: UploadFile) => {
    this.pending = { kind: 'row', id: file.id };
    this.args.onRetry?.(file);
  };
  remove = (file: UploadFile) => {
    this.pending = { kind: 'removed', index: this.files.findIndex((f) => f.id === file.id) };
    this.args.onRemove?.(file);
  };

  /**
   * Where focus goes when the control that had it goes away: the caller
   * re-renders the list after Retry, Remove or an add that fills it, and the
   * pressed button unmounts. Runs on every list change, and acts only when
   * focus has fallen out of the component.
   */
  private pending: { kind: 'row'; id: string } | { kind: 'removed'; index: number } | { kind: 'added' } | undefined;
  keepFocus = modifier((root: HTMLElement, [files]: [UploadFile[]]) => {
    let pending = this.pending;
    if (!pending) {
      return;
    }
    let active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) {
      return;
    }
    this.pending = undefined;
    let target: HTMLElement | null = null;
    if (pending.kind === 'row') {
      target = root.querySelector(`[data-file-id="${CSS.escape(pending.id)}"]`);
    } else if (pending.kind === 'removed') {
      let next = files[pending.index] ?? files[pending.index - 1];
      target = next
        ? root.querySelector(`[data-remove-for="${CSS.escape(next.id)}"]`) ??
          root.querySelector(`[data-file-id="${CSS.escape(next.id)}"]`)
        : root.querySelector('button');
    } else if (this.full) {
      target = root.querySelector('.pretui-upload-list');
    }
    target?.focus();
  });

  <template>
    <div class='pretui-upload' data-test-pretui-file-upload {{this.keepFocus this.files}} ...attributes>
      {{#unless this.full}}
        {{#if (has-block 'trigger')}}
          {{yield (hash add=this.add remaining=this.remaining) to='trigger'}}
        {{else}}
          <Dropzone
            @accept={{@accept}}
            @multiple={{this.multiple}}
            @maxSize={{@maxSize}}
            @maxFiles={{this.remaining}}
            @label={{if @label @label 'Drop files to upload'}}
            @hint={{@hint}}
            @disabled={{@disabled}}
            @onSelect={{this.add}}
            @onReject={{@onReject}}
          />
        {{/if}}
      {{/unless}}
      {{#if this.rows.length}}
        <ul class='pretui-upload-list' aria-label={{if @label @label 'Files'}} tabindex='-1' data-test-pretui-file-upload-list>
          {{#each this.rows key='file.id' as |row|}}
            <li class='pretui-upload-row' tabindex='-1' data-status={{row.file.status}} data-file-id={{row.file.id}} data-test-pretui-upload-row={{row.file.id}}>
              <div class='pretui-upload-head'>
                <span class='pretui-upload-name' title={{row.file.name}}>{{row.file.name}}</span>
                {{#if row.file.size}}
                  <span class='pretui-upload-size'><FormatBytes @value={{row.file.size}} /></span>
                {{/if}}
                <span class='pretui-upload-status' data-test-pretui-upload-status>{{row.statusText}}</span>
                {{#if row.failed}}
                  {{#if @onRetry}}
                    <button
                      type='button'
                      class='pretui-upload-btn'
                      aria-label={{row.retryLabel}}
                      data-test-pretui-upload-retry={{row.file.id}}
                      {{on 'click' (fn this.retry row.file)}}
                    >Retry</button>
                  {{/if}}
                {{/if}}
                {{#if @onRemove}}
                  <button
                    type='button'
                    class='pretui-upload-btn pretui-upload-remove'
                    aria-label={{row.removeLabel}}
                    data-remove-for={{row.file.id}}
                    data-test-pretui-upload-remove={{row.file.id}}
                    {{on 'click' (fn this.remove row.file)}}
                  >
                    <svg width='10' height='10' viewBox='0 0 12 12' aria-hidden='true'><path
                        d='M2 2l8 8M10 2l-8 8'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='1.6'
                        stroke-linecap='round'
                      /></svg>
                  </button>
                {{/if}}
              </div>
              {{#if row.uploading}}
                <ProgressBar @value={{row.progress}} @max={{100}} @label={{row.progressLabel}} />
              {{/if}}
              {{#if row.failed}}
                {{#if row.file.error}}
                  <p class='pretui-upload-error' data-test-pretui-upload-error>{{row.file.error}}</p>
                {{/if}}
              {{/if}}
            </li>
          {{/each}}
        </ul>
      {{/if}}
      <p class='pretui-upload-summary' role='status' data-test-pretui-file-upload-summary>{{this.summary}}</p>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-upload {
          display: grid;
          gap: var(--space-3, 0.5rem);
          min-inline-size: 0;
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 0.78rem);
        }
        .pretui-upload-list {
          display: grid;
          gap: var(--space-2, 0.375rem);
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .pretui-upload-row:focus-visible,
        .pretui-upload-list:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-upload-row {
          position: relative;
          display: grid;
          gap: var(--space-2, 0.375rem);
          padding: var(--space-3, 0.5rem);
          padding-inline-start: calc(var(--space-3, 0.5rem) + 3px);
          overflow: hidden;
          border-radius: var(--radius-control, 6px);
          background: var(--card);
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-upload-row::before {
          content: '';
          position: absolute;
          inset-block: 0;
          inset-inline-start: 0;
          inline-size: 3px;
          background: var(--pretui-upload-tone, var(--border));
        }
        .pretui-upload-row[data-status='uploading'] {
          --pretui-upload-tone: var(--pretui-info, var(--primary));
        }
        .pretui-upload-row[data-status='done'] {
          --pretui-upload-tone: var(--success);
        }
        .pretui-upload-row[data-status='error'] {
          --pretui-upload-tone: var(--destructive);
        }
        .pretui-upload-head {
          display: flex;
          align-items: center;
          gap: var(--space-2, 0.375rem);
          min-inline-size: 0;
        }
        .pretui-upload-name {
          flex: 1;
          min-inline-size: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        }
        .pretui-upload-size,
        .pretui-upload-status {
          flex: none;
          color: var(--muted-foreground);
          font-size: var(--text-ui-sm, 0.72rem);
          font-variant-numeric: tabular-nums;
        }
        .pretui-upload-row[data-status='error'] .pretui-upload-status {
          color: color-mix(in oklch, var(--foreground) 25%, var(--destructive));
          font-weight: 600;
        }
        .pretui-upload-btn {
          flex: none;
          display: inline-grid;
          place-items: center;
          min-block-size: 1.5rem;
          min-inline-size: 1.5rem;
          padding-inline: 0.375rem;
          border: 0;
          border-radius: var(--radius-control, 6px);
          background: transparent;
          color: var(--primary);
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .pretui-upload-remove {
          padding-inline: 0;
          color: var(--muted-foreground);
        }
        .pretui-upload-btn:hover {
          background: var(--hover, color-mix(in oklch, currentColor 10%, transparent));
        }
        .pretui-upload-btn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-upload-error {
          margin: 0;
          font-size: var(--text-ui-sm, 0.72rem);
          color: color-mix(in oklch, var(--foreground) 25%, var(--destructive));
        }
        .pretui-upload-summary {
          position: absolute;
          inline-size: 1px;
          block-size: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
      }
    </style>
  </template>
}
