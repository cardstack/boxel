import GlimmerComponent from '@glimmer/component';
interface EntityDisplayArgs {
  Args: {
    name: string;
  };
  Blocks: {
    thumbnail: [];
    tag: [];
  };
  Element: HTMLElement;
}

export class EntityDisplay extends GlimmerComponent<EntityDisplayArgs> {
  <template>
    <div class='row'>
      {{yield to='thumbnail'}}
      <span class='name'>
        {{@name}}
      </span>
      {{yield to='tag'}}
    </div>
    <style scoped>
      .row {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .name {
        text-decoration: underline;
      }
    </style>
  </template>
}
