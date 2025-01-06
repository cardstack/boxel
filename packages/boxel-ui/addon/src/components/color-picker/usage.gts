import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import ColorPicker from './index.gts';

export default class ColorPickerUsage extends Component {
  @tracked color = '#ff0000';

  private onChange = (newColor: string) => {
    this.color = newColor;
  };

  <template>
    <div class='usage'>

      <section>
        <h4>Usage</h4>
        <div class='picker-row'>
          <ColorPicker @value={{this.color}} @onChange={{this.onChange}} />
          {{this.color}}
        </div>
      </section>
    </div>

    <style scoped>
      .usage {
        padding: var(--boxel-sp-lg);
      }

      .picker-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
      }

      section {
        margin-block: var(--boxel-sp-lg);
      }

      h3 {
        font: var(--boxel-font-h3);
        margin-bottom: var(--boxel-sp-lg);
      }

      h4 {
        font: var(--boxel-font-h4);
        margin-bottom: var(--boxel-sp);
      }
    </style>
  </template>
}
