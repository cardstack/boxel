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
          <h2 class='exg-cap'>Examples</h2>
          <span class='exg-count'>{{this.countLabel}}</span>
        </header>
        <ul class='exg-grid'>
          {{#each this.specs as |spec|}}
            <li class='exg-card'>
              <div class='exg-demo'>
                <spec.component />
              </div>
              <div class='exg-meta'>
                <h3 class='exg-title'>{{spec.title}}</h3>
                {{#if spec.note}}<span
                    class='exg-note'
                  >{{spec.note}}</span>{{/if}}
              </div>
            </li>
          {{/each}}
        </ul>
      </section>
    {{/if}}
    <style scoped>
      .exg {
        --_exg-tile-min-w: 18.75rem;
        --_exg-demo-shadow-room: var(--boxel-sp-sm);

        display: grid;
        gap: var(--boxel-sp-sm);
        align-content: start;
      }
      .exg-h {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
      }
      /* THE caps treatment — one per page region (workbench type spec) */
      .exg-cap {
        font-family: var(--boxel-eyebrow-font-family);
        font-size: var(--boxel-eyebrow-font-size);
        font-weight: var(--boxel-eyebrow-font-weight);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .exg-count {
        font-size: var(--boxel-caption-font-size);
        color: var(--muted-foreground);
      }
      .exg-grid {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(var(--_exg-tile-min-w), 100%), 1fr)
        );
        gap: var(--boxel-sp-sm);
        align-items: stretch;
      }
      .exg-card {
        background-color: var(--card);
        color: var(--card-foreground);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 0 0 1px var(--border);
        padding: var(--boxel-sp-sm);
        /* each card takes two of the grid's rows as a subgrid, so the demo
           and meta rows line up across every card in a row */
        display: grid;
        grid-row: span 2;
        grid-template-rows: subgrid;
        /* at least the demo's shadow room, so its clip box stops short of
           the meta row */
        gap: var(--_exg-demo-shadow-room);
        min-width: 0;
      }
      /* clips a wide demo, with a margin of room so a demo's own shadow
         isn't cut off; the negative margin keeps the layout where it was */
      .exg-demo {
        min-width: 0;
        align-self: center;
        margin: calc(-1 * var(--_exg-demo-shadow-room));
        padding: var(--_exg-demo-shadow-room);
        overflow: hidden;
      }
      .exg-meta {
        min-width: 0;
        display: grid;
        gap: var(--boxel-sp-6xs);
        padding-block-start: var(--boxel-sp-xs);
        box-shadow: inset 0 1px 0 var(--border);
      }
      /* an h3 for navigation, set in the caption role */
      .exg-title {
        font-family: var(--boxel-caption-font-family);
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-caption-font-weight);
        line-height: var(--boxel-caption-line-height);
        letter-spacing: var(--boxel-caption-letter-spacing);
        overflow-wrap: break-word;
      }
      .exg-note {
        font-size: var(--boxel-caption-font-size);
        line-height: 1.5;
        color: var(--muted-foreground);
        overflow-wrap: break-word;
      }
    </style>
  </template>
}
