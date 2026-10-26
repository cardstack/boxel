// Pretui — DiffStat: a change's size at a glance: +added −removed and a five-block bar.
import Component from '@glimmer/component';

export interface DiffStatSignature {
  Args: {
    added: number;
    removed: number;
    /** blocks in the bar. Default 5; 0 hides it */
    blocks?: number;
  };
  Element: HTMLSpanElement;
}

/**
 * "+24 −7 ▮▮▮▮▯": the counts, and a bar whose blocks split the change
 * between additions and removals, as a code host's file list draws it.
 */
export class DiffStat extends Component<DiffStatSignature> {
  get bar(): ('add' | 'del' | 'none')[] {
    let n = this.args.blocks ?? 5;
    let { added, removed } = this.args;
    let total = added + removed;
    // a side with any change gets at least one block; together they never
    // exceed the bar
    let adds = total
      ? Math.max(added ? 1 : 0, Math.round((added / total) * n))
      : 0;
    let dels = total
      ? Math.max(removed ? 1 : 0, Math.round((removed / total) * n))
      : 0;
    while (adds + dels > n) {
      adds > dels ? adds-- : dels--;
    }
    return Array.from({ length: n }, (_u, i) =>
      i < adds ? 'add' : i < adds + dels ? 'del' : 'none',
    );
  }
  get label(): string {
    return `${this.args.added} added, ${this.args.removed} removed`;
  }
  <template>
    <span
      class='pretui-diffstat'
      role='img'
      aria-label={{this.label}}
      data-test-pretui-diff-stat
      ...attributes
    >
      <span
        class='pretui-diffstat-n'
        data-op='add'
        aria-hidden='true'
      >+{{@added}}</span>
      <span
        class='pretui-diffstat-n'
        data-op='del'
        aria-hidden='true'
      >−{{@removed}}</span>
      {{#if this.bar.length}}<span
          class='pretui-diffstat-bar'
          aria-hidden='true'
        >{{#each this.bar as |block|}}<span
              class='pretui-diffstat-block'
              data-op={{block}}
            ></span>{{/each}}</span>{{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-diffstat {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-2xs);
          font-variant-numeric: tabular-nums;
        }
        .pretui-diffstat-n[data-op='add'] {
          color: var(--success, var(--boxel-highlight));
        }
        .pretui-diffstat-n[data-op='del'] {
          color: var(--destructive-ink);
        }
        .pretui-diffstat-bar {
          display: inline-flex;
          gap: 1px;
        }
        .pretui-diffstat-block {
          width: 7px;
          height: 7px;
          border-radius: 1px;
          background: var(--border-strong, var(--border));
        }
        .pretui-diffstat-block[data-op='add'] {
          background: var(--success, var(--boxel-highlight));
        }
        .pretui-diffstat-block[data-op='del'] {
          background: var(--destructive);
        }
      }
    </style>
  </template>
}
