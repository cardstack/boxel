// Pretui — ChangeReview: a turn's changes reviewed file by file, hunk by hunk.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { TurnChanges } from './turn-changes';
import type { ChangedFile } from './turn-changes';
import { ToolDiff } from './tool-row';
import { lineDiff } from './diff-block';
import type { DiffHunk, DiffHunkState, DiffLine } from './diff-block';

export interface ReviewFile {
  path: string;
  before?: string;
  after?: string;
  /** a diff already worked out, instead of before and after */
  lines?: DiffLine[];
  status?: ChangedFile['status'];
}

export interface ChangeReviewSignature {
  Args: {
    files: ReviewFile[];
    /** keep or revert one hunk of one file */
    onKeepHunk?: (path: string, hunk: DiffHunk) => unknown;
    onRevertHunk?: (path: string, hunk: DiffHunk) => unknown;
    /** keep or revert a whole file */
    onKeepFile?: (path: string) => unknown;
    onRevertFile?: (path: string) => unknown;
    /** the whole review */
    onKeepAll?: () => unknown;
    onRevertAll?: () => unknown;
    /** what was decided, by path, and by hunk index within a path */
    fileStates?: Record<string, 'kept' | 'reverted'>;
    hunkStates?: Record<string, Record<number, DiffHunkState>>;
    /** 'unified' (default), 'split', or 'auto' */
    view?: 'unified' | 'split' | 'auto';
  };
  Element: HTMLDivElement;
}

/**
 * The review surface for what a turn (or a session) changed: TurnChanges
 * down the side, the chosen file's diff beside it with Keep and Revert on
 * every hunk, the file's own Keep and Revert, and Keep all / Revert all to
 * finish. Under 560px the list stacks above the diff.
 */
export class ChangeReview extends Component<ChangeReviewSignature> {
  @tracked selected: string | undefined;

  get current(): ReviewFile | undefined {
    return (
      this.args.files.find((f) => f.path === this.selected) ?? this.args.files[0]
    );
  }
  linesOf = (file: ReviewFile): DiffLine[] =>
    file.lines ?? lineDiff(file.before, file.after, { context: 2 });
  get changed(): ChangedFile[] {
    return this.args.files.map((file) => {
      let lines = this.linesOf(file);
      return {
        path: file.path,
        status: file.status ?? (file.before === undefined ? 'added' : file.after === undefined ? 'deleted' : 'modified'),
        added: lines.filter((l) => l.op === 'add').length,
        removed: lines.filter((l) => l.op === 'del').length,
        state: this.args.fileStates?.[file.path],
      };
    });
  }
  get currentState() {
    return this.current ? this.args.fileStates?.[this.current.path] : undefined;
  }
  get decided(): number {
    return Object.keys(this.args.fileStates ?? {}).length;
  }
  get progress(): string {
    return `${this.decided} of ${this.args.files.length} reviewed`;
  }
  open = (file: ChangedFile) => (this.selected = file.path);
  keepHunk = (hunk: DiffHunk) =>
    this.current && this.args.onKeepHunk?.(this.current.path, hunk);
  revertHunk = (hunk: DiffHunk) =>
    this.current && this.args.onRevertHunk?.(this.current.path, hunk);
  keepFile = (path: string) => this.args.onKeepFile?.(path);
  revertFile = (path: string) => this.args.onRevertFile?.(path);
  keepAll = () => this.args.onKeepAll?.();
  revertAll = () => this.args.onRevertAll?.();
  hunkStatesOf = (path: string) => this.args.hunkStates?.[path];
  <template>
    <div class='pretui-review' data-test-pretui-change-review ...attributes>
      <div class='pretui-review-body'>
        <TurnChanges
          class='pretui-review-files'
          @files={{this.changed}}
          @selected={{this.current.path}}
          @onOpen={{this.open}}
        />
        {{#if this.current}}
          <div class='pretui-review-file' data-test-pretui-change-review-file={{this.current.path}}>
            <ToolDiff
              @path={{this.current.path}}
              @lines={{this.linesOf this.current}}
              @maxLines={{400}}
              @onKeepHunk={{if @onKeepHunk this.keepHunk}}
              @onRevertHunk={{if @onRevertHunk this.revertHunk}}
              @hunkStates={{this.hunkStatesOf this.current.path}}
              @view={{@view}}
            />
            <div class='pretui-review-fileactions'>
              {{#if this.currentState}}
                <span class='pretui-review-state' data-test-pretui-change-review-state>{{this.currentState}}</span>
              {{else}}
                {{#if @onKeepFile}}<button type='button' class='pretui-review-act' data-test-pretui-change-review-keep-file {{on 'click' (fn this.keepFile this.current.path)}}>Keep file</button>{{/if}}
                {{#if @onRevertFile}}<button type='button' class='pretui-review-act' data-kind='quiet' data-test-pretui-change-review-revert-file {{on 'click' (fn this.revertFile this.current.path)}}>Revert file</button>{{/if}}
              {{/if}}
            </div>
          </div>
        {{/if}}
      </div>
      <div class='pretui-review-foot'>
        <span class='pretui-review-progress' role='status'>{{this.progress}}</span>
        {{#if @onRevertAll}}<button type='button' class='pretui-review-act' data-kind='quiet' data-test-pretui-change-review-revert-all {{on 'click' this.revertAll}}>Revert all</button>{{/if}}
        {{#if @onKeepAll}}<button type='button' class='pretui-review-act' data-kind='primary' data-test-pretui-change-review-keep-all {{on 'click' this.keepAll}}>Keep all</button>{{/if}}
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-review {
          container-type: inline-size;
          display: grid;
          gap: 8px;
        }
        .pretui-review-body {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 8px;
        }
        @container (min-width: 560px) {
          .pretui-review-body {
            grid-template-columns: minmax(160px, 0.4fr) minmax(0, 1fr);
            align-items: start;
          }
        }
        .pretui-review-file {
          display: grid;
          gap: 6px;
          min-width: 0;
        }
        .pretui-review-fileactions,
        .pretui-review-foot {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
        }
        .pretui-review-foot {
          padding-top: 8px;
          box-shadow: 0 -1px 0 var(--border);
        }
        .pretui-review-progress {
          margin-inline-end: auto;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
        }
        .pretui-review-state {
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          color: var(--muted-foreground);
        }
        .pretui-review-act {
          height: 26px;
          padding: 0 11px;
          border: 0;
          border-radius: 13px;
          background: none;
          box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 500;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-review-act[data-kind='primary'] {
          box-shadow: none;
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-dark));
        }
        .pretui-review-act[data-kind='quiet'] {
          box-shadow: none;
          color: var(--muted-foreground);
        }
        .pretui-review-act[data-kind='quiet']:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-review-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
      }
    </style>
  </template>
}
