import GlimmerComponent from '@glimmer/component';
interface EntityDisplayArgs {
  Args: {
    name?: string | null;
    center?: boolean;
    underline?: boolean;
  };
  Blocks: {
    thumbnail: [];
    tag: [];
  };
  Element: HTMLElement;
}

export class EntityDisplay extends GlimmerComponent<EntityDisplayArgs> {
  get entityDisplayPositionClass() {
    const center = this.args.center ? 'center' : '';
    return ['entity-display', center].filter(Boolean).join(' ');
  }

  get entityNameTextClass() {
    const underline = this.args.underline ? 'underline' : '';
    return ['entity-name', underline].filter(Boolean).join(' ');
  }

  <template>
    <div class={{this.entityDisplayPositionClass}} ...attributes>
      <div class='entity-thumbnail'>{{yield to='thumbnail'}}</div>

      <div class='entity-name-tag'>
        <span class={{this.entityNameTextClass}}>
          {{@name}}
        </span>

        {{yield to='tag'}}
      </div>
    </div>
    <style scoped>
      .entity-display {
        display: inline-flex;
        align-items: start;
        gap: var(--boxel-sp-xs);
      }
      .entity-display.center {
        align-items: center;
      }
      .entity-thumbnail {
        width: var(--boxel-icon-sm);
        height: calc(var(--boxel-icon-sm) - 2px);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--boxel-600);
      }
      .entity-name-tag {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .entity-name {
        word-break: break-word;
      }
      .entity-name.underline {
        text-decoration: underline;
      }
    </style>
  </template>
}
