// Pretui — KeyValue: read-only labeled values in a definition list.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface KeyValueItem {
  key: string;
  value: string;
}
export interface KeyValueSignature {
  Args: { items: KeyValueItem[] };
  Blocks: { value: [item: KeyValueItem] };
  Element: HTMLDListElement;
}

export const KeyValue: TemplateOnlyComponent<KeyValueSignature> = <template>
  <dl class='pretui-kv' data-test-pretui-kv ...attributes>
    {{#each @items as |item|}}
      <dt>{{item.key}}</dt>
      <dd>{{#if (has-block 'value')}}{{yield item to='value'}}{{else}}{{item.value}}{{/if}}</dd>
    {{/each}}
  </dl>
  <style scoped>
    .pretui-kv {
      display: grid;
      grid-template-columns: max-content 1fr;
      column-gap: var(--space-6, 19px);
      row-gap: 7px;
      font-size: var(--text-ui-md, 12.5px);
      align-content: start;
      align-items: center;
      margin: 0;
    }
    .pretui-kv dt {
      color: var(--muted-foreground);
      font-size: var(--text-ui, 12px);
      line-height: 18px;
    }
    .pretui-kv dd {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  </style>
</template>;
