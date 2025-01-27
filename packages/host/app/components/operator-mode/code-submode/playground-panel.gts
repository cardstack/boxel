import GlimmerComponent from '@glimmer/component';

interface Signature {
  Element: HTMLElement;
}

export default class PlaygroundPanel extends GlimmerComponent<Signature> {
  <template>
    <section class='playground-panel' data-test-playground-panel>
    </section>
    <style scoped>
      .playground-panel {
        background-image: url('./playground-background.png');
        background-position: left top;
        background-repeat: repeat;
        background-size: 22.5px;
        height: 100%;
        width: 100%;
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        overflow: auto;
      }
    </style>
  </template>
}
