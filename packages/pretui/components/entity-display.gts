// Pretui — EntityDisplay: an entity's icon or thumbnail with its name and tags.
import Component from '@glimmer/component';
import { Chip } from './chip';

// ── EntityDisplay ────────────────────────────────────────────────────────
// Merges entity-icon-display + entity-thumbnail-display semantics: a visual
// slot (icon or thumbnail dress via @variant) beside a title row with an
// optional Chip tag, then a subtitle line — or the <:meta> block when the
// second row needs real markup (meta wins over @subtitle, mirroring the
// block-beats-arg precedence of the boxel-ui originals).
export interface EntityDisplaySignature {
  Args: {
    title?: string;
    subtitle?: string;
    tag?: string;
    variant?: 'icon' | 'thumbnail';
    center?: boolean;
    underline?: boolean;
  };
  Blocks: { visual?: []; meta?: [] };
  Element: HTMLElement;
}

export class EntityDisplay extends Component<EntityDisplaySignature> {
  get variant(): 'icon' | 'thumbnail' {
    return this.args.variant ?? 'icon';
  }
  <template>
    <div
      class='pretui-entity'
      data-variant={{this.variant}}
      data-center={{if @center 'true'}}
      data-test-pretui-entity-display
      ...attributes
    >
      {{#if (has-block 'visual')}}
        <span class='pretui-entity-visual'>{{yield to='visual'}}</span>
      {{/if}}
      <div class='pretui-entity-info'>
        <div class='pretui-entity-titlerow'>
          {{#if @title}}
            <span
              class='pretui-entity-title'
              data-underline={{if @underline 'true'}}
            >{{@title}}</span>
          {{/if}}
          {{#if @tag}}
            <Chip @label={{@tag}} @dot={{false}} />
          {{/if}}
        </div>
        {{#if (has-block 'meta')}}
          <div class='pretui-entity-meta'>{{yield to='meta'}}</div>
        {{else if @subtitle}}
          <div class='pretui-entity-meta'>{{@subtitle}}</div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .pretui-entity {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3, 8px);
        min-width: 0;
      }
      .pretui-entity[data-center] {
        align-items: center;
      }
      .pretui-entity-visual {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
      }
      .pretui-entity[data-variant='icon'] .pretui-entity-visual {
        width: var(--pretui-entity-visual-size, 18px);
        height: var(--pretui-entity-visual-size, 18px);
        color: var(--muted-foreground);
      }
      .pretui-entity[data-variant='icon'] .pretui-entity-visual :deep(svg) {
        width: 100%;
        height: 100%;
      }
      .pretui-entity[data-variant='thumbnail'] .pretui-entity-visual {
        width: var(--pretui-entity-visual-size, 22px);
        height: var(--pretui-entity-visual-size, 22px);
        border-radius: var(--radius-chip, 6px);
        overflow: hidden;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .pretui-entity-info {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .pretui-entity-titlerow {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
      }
      .pretui-entity-title {
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
        color: var(--foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-entity-title[data-underline] {
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .pretui-entity-meta {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}
