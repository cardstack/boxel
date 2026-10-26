// Pretui — TurnChanges: the files a turn changed, each with its size, and Review.
import Component from '@glimmer/component';
import CheckIcon from '@cardstack/boxel-icons/check';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { DiffStat } from './diff-stat';
import { VisuallyHidden } from './visually-hidden';

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

const STATUS: Record<string, { letter: string; word: string }> = {
  added: { letter: 'A', word: 'Added' },
  deleted: { letter: 'D', word: 'Deleted' },
  renamed: { letter: 'R', word: 'Renamed' },
  modified: { letter: 'M', word: 'Modified' },
};

/**
 * "3 files changed +24 −7 · Review" over the files a turn touched, each a
 * row with its status letter, path and DiffStat. The letter is for the eye;
 * a screen reader hears the status as a word. A row opens its file; the
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
  letter = (file: ChangedFile) => STATUS[file.status ?? 'modified']?.letter;
  statusWord = (file: ChangedFile) => STATUS[file.status ?? 'modified']?.word;
  isSelected = (file: ChangedFile) => file.path === this.args.selected;
  open = (file: ChangedFile) => this.args.onOpen?.(file);
  review = () => this.args.onReview?.();
  isKept = (file: ChangedFile) => file.state === 'kept';
  <template>
    <div class='pretui-turnchanges' data-test-pretui-turn-changes ...attributes>
      <div class='pretui-turnchanges-head'>
        <span class='pretui-turnchanges-summary'>{{this.summary}}</span>
        <DiffStat
          @added={{this.added}}
          @removed={{this.removed}}
          @blocks={{0}}
        />
        {{#if @onReview}}<button
            type='button'
            class='pretui-turnchanges-review'
            {{on 'click' this.review}}
            data-test-pretui-turn-changes-review
          >Review</button>{{/if}}
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
              {{on 'click' (fn this.open file)}}
              data-test-pretui-turn-changes-file={{file.path}}
            >
              <span
                class='pretui-turnchanges-letter'
                aria-hidden='true'
              >{{this.letter file}}</span>
              <VisuallyHidden
                data-test-pretui-turn-changes-status
              >{{this.statusWord file}}</VisuallyHidden>
              <span class='pretui-turnchanges-path'>{{file.path}}</span>
              {{#if file.state}}<span class='pretui-turnchanges-state'>{{#if
                    (this.isKept file)
                  }}<CheckIcon
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
          gap: var(--boxel-sp-6xs);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
        }
        .pretui-turnchanges-head {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: 1.75rem;
        }
        .pretui-turnchanges-summary {
          font-weight: 600;
          color: var(--foreground);
        }
        .pretui-turnchanges-review {
          margin-inline-start: auto;
          height: 1.75rem;
          padding: 0 var(--boxel-sp-sm);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          box-shadow: inset 0 0 0 1px var(--border-strong);
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          font-weight: 400;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-turnchanges-review:hover {
          color: var(--primary-ink);
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
          gap: var(--boxel-sp-xs);
          width: 100%;
          min-height: 1.75rem;
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
          text-align: start;
          color: var(--pretui-toolrow-settled-ink, var(--foreground));
          cursor: pointer;
        }
        .pretui-turnchanges-file:hover,
        .pretui-turnchanges-file[aria-current='true'] {
          background-color: var(--hover);
          color: var(--foreground);
        }
        .pretui-turnchanges-file:focus-visible,
        .pretui-turnchanges-review:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        /* the status letter is the row's mark, not a string to paste: sans */
        .pretui-turnchanges-letter {
          width: 0.75rem;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-weight: 600;
          color: var(--muted-foreground);
        }
        .pretui-turnchanges-file[data-status='added']
          .pretui-turnchanges-letter {
          color: var(--success-ink);
        }
        .pretui-turnchanges-file[data-status='deleted']
          .pretui-turnchanges-letter {
          color: var(--destructive-ink);
        }
        .pretui-turnchanges-path {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          /* a path is a pasteable string: mono at the data size */
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
        }
        .pretui-turnchanges-file[data-state='reverted']
          .pretui-turnchanges-path {
          text-decoration: line-through;
          color: var(--muted-foreground);
        }
        .pretui-turnchanges-state {
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--muted-foreground);
        }
        /* kept is done: ink with a check, not green */
        .pretui-turnchanges-file[data-state='kept'] .pretui-turnchanges-state {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
