// Pretui — ExampleGallery: the realistic usage galleries worn at the foot of
// a component's workbench page. The sets themselves live in ./examples.
import Component from '@glimmer/component';
import type { ExampleSpec } from './examples-kit';

export class ExampleGallery extends Component<{
  Args: { specs?: ExampleSpec[] };
}> {
  get specs(): ExampleSpec[] | undefined {
    return this.args.specs?.length ? this.args.specs : undefined;
  }
  get countLabel(): string {
    let n = this.specs?.length ?? 0;
    return n === 1 ? '1 example' : `${n} examples`;
  }
  <template>
    {{#if this.specs}}
      <section class='exg' data-test-pretui-examples>
        <header class='exg-h'>
          <span class='exg-cap'>Examples</span>
          <span class='exg-count'>{{this.countLabel}}</span>
        </header>
        <div class='exg-grid'>
          {{#each this.specs as |spec|}}
            <div class='exg-card'>
              <div class='exg-demo'>
                <spec.component />
              </div>
              <div class='exg-meta'>
                <span class='exg-title'>{{spec.title}}</span>
                {{#if spec.note}}<span class='exg-note'>{{spec.note}}</span>{{/if}}
              </div>
            </div>
          {{/each}}
        </div>
      </section>
    {{/if}}
    <style scoped>
      .exg {
        display: grid;
        gap: var(--space-4, 11px);
        align-content: start;
      }
      .exg-h {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      /* THE caps treatment — one per page region (workbench type spec) */
      .exg-cap {
        font-size: var(--text-ui-xs, 11px);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .exg-count {
        font-size: var(--text-ui, 12px);
        color: var(--ink-3, var(--boxel-400));
      }
      .exg-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--space-4, 11px);
        align-items: stretch;
      }
      .exg-card {
        background: var(--card);
        border-radius: 6px;
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        padding: var(--space-4, 11px);
        display: grid;
        grid-template-rows: 1fr auto;
        gap: 10px;
        min-width: 0;
      }
      .exg-demo {
        min-width: 0;
        align-self: center;
        padding: 4px 0;
        overflow: hidden;
      }
      .exg-meta {
        display: grid;
        gap: 2px;
        padding-top: 8px;
        box-shadow: inset 0 1px 0 var(--border);
      }
      .exg-title {
        font-size: var(--text-ui, 12px);
        font-weight: 500;
        color: var(--foreground);
      }
      .exg-note {
        font-size: var(--text-ui, 12px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
