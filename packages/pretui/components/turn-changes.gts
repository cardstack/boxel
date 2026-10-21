// Pretui — TurnChanges: the files a turn changed, each with its size, and Review.
import Component from '@glimmer/component';
import CheckIcon from '@cardstack/boxel-icons/check';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { DiffStat } from './diff-stat';

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
  /** 'modified' (default), 'added', 'deleted', 'renamed' */
  status?: 'modified' | 'added' | 'deleted' | 'renamed';
  /** the review's verdict on the file, once there is one */
  state?: 'kept' | 'reverted';
}

export interface TurnChangesSignature {
  Args: {
    files: ChangedFile[];
    /** open one file's diff */
    onOpen?: (file: ChangedFile) => void;
    /** open the review of them all */
    onReview?: () => void;
    /** the file shown in a review, highlighted */
    selected?: string;
  };
  Element: HTMLDivElement;
}

const STATUS: Record<string, string> = { added: 'A', deleted: 'D', renamed: 'R', modified: 'M' };

/**
 * "3 files changed +24 −7 · Review" over the files a turn touched, each a
 * row with its status letter, path and DiffStat. A row opens its file; the
 * header opens the review of all of them.
 */
export class TurnChanges extends Component<TurnChangesSignature> {
  get added() {
    return this.args.files.reduce((n, f) => n + f.added, 0);
  }
  get removed() {
    return this.args.files.reduce((n, f) => n + f.removed, 0);
  }
  get summary(): string {
    let n = this.args.files.length;
    return `${n} ${n === 1 ? 'file' : 'files'} changed`;
  }
  letter = (file: ChangedFile) => STATUS[file.status ?? 'modified'];
  isSelected = (file: ChangedFile) => file.path === this.args.selected;
  open = (file: ChangedFile) => this.args.onOpen?.(file);
  review = () => this.args.onReview?.();
  isKept = (file: ChangedFile) => file.state === 'kept';
  <template>
    <div class='pretui-turnchanges' data-test-pretui-turn-changes ...attributes>
      <div class='pretui-turnchanges-head'>
        <span class='pretui-turnchanges-summary'>{{this.summary}}</span>
        <DiffStat @added={{this.added}} @removed={{this.removed}} @blocks={{0}} />
        {{#if @onReview}}<button type='button' class='pretui-turnchanges-review' data-test-pretui-turn-changes-review {{on 'click' this.review}}>Review</button>{{/if}}
      </div>
      <ul class='pretui-turnchanges-list' aria-label='Changed files'>
        {{#each @files as |file|}}
          <li>
            <button
              type='button'
              class='pretui-turnchanges-file'
              aria-current={{if (this.isSelected file) 'true'}}
              data-status={{if file.status file.status 'modified'}}
              data-state={{file.state}}
              data-test-pretui-turn-changes-file={{file.path}}
              {{on 'click' (fn this.open file)}}
            >
              <span class='pretui-turnchanges-letter' title={{if file.status file.status 'modified'}}>{{this.letter file}}</span>
              <span class='pretui-turnchanges-path'>{{file.path}}</span>
              {{#if file.state}}<span class='pretui-turnchanges-state'>{{#if (this.isKept file)}}<CheckIcon
                    width='11'
                    height='11'
                    aria-hidden='true'
                  />{{/if}}{{file.state}}</span>{{/if}}
              <DiffStat @added={{file.added}} @removed={{file.removed}} />
            </button>
          </li>
        {{/each}}
      </ul>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-turnchanges {
          display: grid;
          gap: 2px;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
        }
        .pretui-turnchanges-head {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          min-height: 28px;
        }
        .pretui-turnchanges-summary {
          font-weight: 600;
          color: var(--foreground);
        }
        .pretui-turnchanges-review {
          margin-inline-start: auto;
          height: 28px;
          padding: 0 var(--step-12, 12px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
          font: inherit;
          font-weight: 400;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-turnchanges-review:hover {
          color: var(--pretui-link, var(--primary));
        }
        .pretui-turnchanges-list {
          display: grid;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .pretui-turnchanges-file {
          display: flex;
          align-items: center;
          gap: var(--step-8, 8px);
          width: 100%;
          min-height: 28px;
          padding: 0 var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          font: inherit;
          text-align: start;
          color: var(--pretui-toolrow-settled-ink, var(--foreground));
          cursor: pointer;
        }
        .pretui-turnchanges-file:hover,
        .pretui-turnchanges-file[aria-current='true'] {
          background: var(--hover, var(--inset));
          color: var(--foreground);
        }
        .pretui-turnchanges-file:focus-visible,
        .pretui-turnchanges-review:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* the status letter is the row's mark, not a string to paste: sans */
        .pretui-turnchanges-letter {
          width: 12px;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 600;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-turnchanges-file[data-status='added'] .pretui-turnchanges-letter {
          color: var(--success, var(--boxel-highlight));
        }
        .pretui-turnchanges-file[data-status='deleted'] .pretui-turnchanges-letter {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-turnchanges-path {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          /* a path is a pasteable string: mono at the data size */
          font-family: var(--font-mono);
          font-size: var(--type-data, 12px);
          line-height: var(--leading-data, 18px);
        }
        .pretui-turnchanges-file[data-state='reverted'] .pretui-turnchanges-path {
          text-decoration: line-through;
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-turnchanges-state {
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-2, var(--muted-foreground));
        }
        /* kept is done: ink with a check, not green */
        .pretui-turnchanges-file[data-state='kept'] .pretui-turnchanges-state {
          display: inline-flex;
          align-items: center;
          gap: var(--step-4, 4px);
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
