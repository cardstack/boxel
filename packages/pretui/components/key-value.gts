// Pretui — KeyValue: read-only labeled values in a definition list.
import Component from '@glimmer/component';

export interface KeyValueItem {
  key: string;
  value: string;
}

export type KeyValueLayout = 'horizontal' | 'stacked' | 'inline';

export interface KeyValueSignature {
  Args: {
    items: KeyValueItem[];
    /** 'horizontal' (default): keys in one column, values beside them.
     *  'stacked': each key above its value. 'inline': pairs side by side,
     *  wrapping onto the next line. 'vertical' is an alias of 'stacked'. */
    layout?: KeyValueLayout | 'vertical';
    /** 'eyebrow' sets the keys in the theme's eyebrow role (uppercase,
     *  tracked out). Default 'default'. */
    labelStyle?: 'default' | 'eyebrow';
  };
  Blocks: { value: [item: KeyValueItem] };
  Element: HTMLDListElement;
}

export class KeyValue extends Component<KeyValueSignature> {
  get layout(): KeyValueLayout {
    let { layout } = this.args;
    if (layout === 'stacked' || layout === 'vertical') {
      return 'stacked';
    }
    return layout === 'inline' ? 'inline' : 'horizontal';
  }
  get isInline(): boolean {
    return this.layout === 'inline';
  }
  get labelStyle(): 'eyebrow' | undefined {
    return this.args.labelStyle === 'eyebrow' ? 'eyebrow' : undefined;
  }
  <template>
    <dl
      class='pretui-kv'
      data-layout={{this.layout}}
      data-label-style={{this.labelStyle}}
      data-test-pretui-kv
      ...attributes
    >
      {{#if this.isInline}}
        {{! A div per pair keeps each key on the same line as its value when the strip wraps; HTML allows a div around each dt/dd group. }}
        {{#each @items as |item|}}
          <div class='pretui-kv-pair'>
            <dt>{{item.key}}</dt>
            <dd>{{#if (has-block 'value')}}{{yield item to='value'}}{{else}}{{item.value}}{{/if}}</dd>
          </div>
        {{/each}}
      {{else}}
        {{#each @items as |item|}}
          <dt>{{item.key}}</dt>
          <dd>{{#if (has-block 'value')}}{{yield item to='value'}}{{else}}{{item.value}}{{/if}}</dd>
        {{/each}}
      {{/if}}
    </dl>
    <style scoped>
      @layer PretComponent {
        .pretui-kv {
          --pretui-kv-line-height: 1.125rem;
          display: grid;
          grid-template-columns: max-content 1fr;
          column-gap: var(--boxel-sp-lg);
          row-gap: var(--boxel-sp-2xs);
          font-size: var(--boxel-font-size-xs);
          align-content: start;
          align-items: first baseline;
          margin: 0;
        }
        /* Key typography knobs. The four without a fallback inherit while
           unset. */
        .pretui-kv dt {
          color: var(--pretui-kv-label-color, var(--muted-foreground));
          font-family: var(--pretui-kv-label-font-family);
          font-size: var(
            --pretui-kv-label-font-size,
            var(--boxel-font-size-xs)
          );
          font-weight: var(--pretui-kv-label-font-weight);
          line-height: var(
            --pretui-kv-label-line-height,
            var(--pretui-kv-line-height)
          );
          letter-spacing: var(--pretui-kv-label-letter-spacing);
          text-transform: var(--pretui-kv-label-text-transform);
        }
        /* The theme's eyebrow role (--boxel-eyebrow-*). The knobs above
           still win. */
        .pretui-kv[data-label-style='eyebrow'] dt {
          font-family: var(
            --pretui-kv-label-font-family,
            var(--boxel-eyebrow-font-family)
          );
          font-size: var(
            --pretui-kv-label-font-size,
            var(--boxel-eyebrow-font-size)
          );
          font-weight: var(
            --pretui-kv-label-font-weight,
            var(--boxel-eyebrow-font-weight)
          );
          line-height: var(
            --pretui-kv-label-line-height,
            var(--boxel-eyebrow-line-height)
          );
          letter-spacing: var(
            --pretui-kv-label-letter-spacing,
            var(--boxel-eyebrow-letter-spacing)
          );
          text-transform: var(--pretui-kv-label-text-transform, uppercase);
        }
        .pretui-kv dd {
          margin: 0;
          min-width: 0;
          overflow-wrap: break-word;
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-2xs);
        }
        .pretui-kv[data-layout='stacked'] {
          grid-template-columns: minmax(0, 1fr);
          row-gap: var(--boxel-sp-6xs);
        }
        .pretui-kv[data-layout='stacked'] dt:not(:first-child) {
          margin-block-start: var(--boxel-sp-xs);
        }
        .pretui-kv[data-layout='inline'] {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
        }
        .pretui-kv-pair {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-2xs);
          min-inline-size: 0;
        }
      }
    </style>
  </template>
}
