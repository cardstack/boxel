import GlimmerComponent from '@glimmer/component';

interface Signature<T> {
  Args: {
    // Section heading, e.g. "File Results".
    sectionTitle: string;
    // The per-file / per-module / per-card entries to render as groups.
    items: T[] | undefined;
    // Per-item predicate; truthy marks the group with the error border.
    hasErrors: (item: T) => unknown;
  };
  Blocks: {
    // Rendered inside the group header row (name + status badge).
    header: [item: T];
    // Rendered below the header (the card-specific row list or error block).
    body: [item: T];
  };
  Element: HTMLElement;
}

// Shared scaffold for the detail list shown in every result card's isolated
// view: the section heading, the bordered groups, and the group header row.
// Callers supply the header contents and the per-item body via blocks, since
// those differ per result type (violation rows, error blocks, test rows, …).
export class ResultDetailsSection<T> extends GlimmerComponent<Signature<T>> {
  <template>
    {{#if @items.length}}
      <section class='detail-section' ...attributes>
        <h2>{{@sectionTitle}}</h2>
        <div class='detail-groups'>
          {{#each @items as |item|}}
            <div class='detail-group {{if (@hasErrors item) "has-errors"}}'>
              <div class='detail-group-header'>
                {{yield item to='header'}}
              </div>
              {{yield item to='body'}}
            </div>
          {{/each}}
        </div>
      </section>
    {{/if}}
    <style scoped>
      .detail-section {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .detail-section > h2 {
        margin: 0;
        font: 600 var(--boxel-font-sm);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground, var(--boxel-500));
      }
      .detail-groups {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .detail-group {
        border: 1px solid
          color-mix(
            in oklch,
            var(--border, var(--boxel-border-color)) 60%,
            transparent
          );
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
      }
      .detail-group.has-errors {
        border-color: color-mix(in oklch, oklch(55% 0.22 25) 50%, transparent);
      }
      .detail-group-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-xs);
        border-bottom: 1px solid
          color-mix(
            in oklch,
            var(--border, var(--boxel-border-color)) 50%,
            transparent
          );
        margin-bottom: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
