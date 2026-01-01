import Component from '@glimmer/component';
import { cssVar } from '@cardstack/boxel-ui/helpers';

interface TagSignature {
  Element: HTMLSpanElement;
  Args: {
    label: string;
    icon?: string;
    accentColor?: string;
  };
}

export class Tag extends Component<TagSignature> {
  <template>
    <span class='tag' style={{cssVar accent-color=@accentColor}} ...attributes>
      {{#if @icon}}
        <span aria-hidden='true'>{{@icon}}</span>
      {{/if}}
      {{@label}}
    </span>

    <style scoped>
      .tag {
        --_tag-color: var(--accent-color, var(--foreground, var(--boxel-700)));
        --_tag-background: color-mix(
          in oklab,
          var(--_tag-color) 15%,
          transparent
        );

        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.35rem 0.75rem;
        border-radius: var(--boxel-border-radius-xs);
        background: var(--_tag-background);
        color: var(--foreground, var(--boxel-dark));
        font-family: var(--boxel-caption-font-family);
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-caption-font-weight);
        line-height: var(--boxel-caption-line-height);
      }
    </style>
  </template>
}
