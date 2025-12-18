import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

// deliberately unscoped CSS
const style = `
::view-transition-group(scrim) {
  animation-duration: 0.5s;
}
`;

const styleNode = document.createElement('style');
styleNode.appendChild(document.createTextNode(style));
document.head.appendChild(styleNode);

export const Plane = <template>
  <style scoped>
    .plane {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      pointer-events: none;
    }
    .scrim {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
      background-color: #00000070;
      view-transition-name: scrim;
    }
    .content {
      position: relative;
      pointer-events: auto;
    }
  </style>
  {{! template-lint-disable no-invalid-interactive }}
  <div class='scrim' {{on 'click' @scrimClicked}}></div>
  <div class='plane'>
    <div class='content'>
      {{yield}}
    </div>
  </div>
</template> satisfies TemplateOnlyComponent<{
  Blocks: {
    default: [];
  };
  Args: {
    scrimClicked: () => void;
  };
}>;
