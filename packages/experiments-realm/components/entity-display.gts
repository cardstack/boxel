import GlimmerComponent from '@glimmer/component';
interface EntityDisplayArgs {
  Args: {
    name?: string | null;
    underline?: boolean;
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

      <div class='name-tag'>
        <span class='name {{if @underline "underline"}}'>
          {{@name}}
        </span>
        {{yield to='tag'}}
      </div>
    </div>
    <style scoped>
      .row {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .name-tag {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .name.underline {
        text-decoration: underline;
      }
    </style>
  </template>
}
