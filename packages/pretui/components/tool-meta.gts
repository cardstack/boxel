// Pretui — ToolMeta: the call's particulars (tool · profile · elapsed · cost), quiet until asked for.
import Component from '@glimmer/component';

export interface ToolMetaSignature {
  Args: {
    /** the particulars, in reading order: 'run-realm-code', 'ctse',
     * '1m 32s', '18 credits'. Empty entries are dropped */
    items: (string | undefined)[];
    /** 'hover' (default): shown while the pointer or focus is in the row
     * that holds it, and always on a touch screen; 'always': shown */
    reveal?: 'hover' | 'always';
  };
  Element: HTMLDivElement;
}

/**
 * A sans caption line of particulars for the reader who wants them. It stays in
 * the accessibility tree while hidden (it fades, it is not removed), so a
 * screen reader reads it with the row.
 *
 * ```hbs
 * <ToolRow …><:rows>…<ToolMeta @items={{array 'run-realm-code' 'ctse' '42s' '6 credits'}} /></:rows></ToolRow>
 * ```
 */
export class ToolMeta extends Component<ToolMetaSignature> {
  get items(): string[] {
    return this.args.items.filter((item): item is string => Boolean(item));
  }
  <template>
    <div
      class='pretui-toolmeta'
      data-reveal={{if @reveal @reveal 'hover'}}
      data-test-pretui-tool-meta
      ...attributes
    >
      {{#each this.items as |item index|}}{{#if index}}<span
            class='pretui-toolmeta-sep'
            aria-hidden='true'
          > · </span>{{/if}}<span>{{item}}</span>{{/each}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-toolmeta {
          padding-inline-start: calc(
            var(--pretui-toolrow-disc, 16px) + var(--pretui-toolrow-gap, 8px)
          );
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--subtle-foreground);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: opacity 160ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        @media (hover: hover) {
          .pretui-toolmeta[data-reveal='hover'] {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-toolmeta {
            transition: none;
          }
        }
      }
      /* revealed by the row that holds it: a rule about another
         component's element, so the whole selector is global, and every
         part of it is a Pret UI name */
      @layer PretComponent {
        :global(.pretui-toolrow:hover .pretui-toolmeta[data-reveal='hover']),
        :global(
          .pretui-toolrow:focus-within .pretui-toolmeta[data-reveal='hover']
        ) {
          opacity: 1;
        }
      }
    </style>
  </template>
}
