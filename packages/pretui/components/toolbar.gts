// Pretui — Toolbar: a header strip with a title, eyebrow, meta and trailing actions.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface ToolbarSignature {
  Args: { title?: string; eyebrow?: string; meta?: string };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export const Toolbar: TemplateOnlyComponent<ToolbarSignature> = <template>
  <div class='pretui-toolbar' data-test-pretui-toolbar ...attributes>
    <div class='pretui-toolbar-id'>
      {{#if @eyebrow}}<span class='pretui-eyebrow'>{{@eyebrow}}</span>{{/if}}
      {{#if @title}}<h2>{{@title}}</h2>{{/if}}
      {{#if @meta}}<span class='pretui-toolbar-meta'>{{@meta}}</span>{{/if}}
    </div>
    <div class='pretui-toolbar-actions'>{{yield}}</div>
  </div>
  <style scoped>
    .pretui-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4, 11px);
      min-height: 44px;
    }
    .pretui-toolbar-id {
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    .pretui-toolbar-id h2 {
      margin: 0;
      font-size: var(--text-heading, 19px);
      font-weight: var(--weight-heading, 700);
      letter-spacing: var(--track-heading, -0.02em);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pretui-eyebrow {
      font-family: var(--font-mono);
      font-size: var(--text-ui-xs, 11px);
      font-weight: 500;
      letter-spacing: var(--track-eyebrow, 0.08em);
      text-transform: uppercase;
      color: var(--muted-foreground);
    }
    .pretui-toolbar-meta {
      font-size: var(--text-ui-sm, 11.5px);
      color: var(--muted-foreground);
    }
    .pretui-toolbar-actions {
      display: flex;
      align-items: center;
      gap: var(--space-3, 8px);
      flex: none;
    }
  </style>
</template>;
