import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cssVar from '../helpers/css-var';
import { or } from '../helpers/truth-helpers';
import { svgJar } from '../helpers/svg-jar';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    color?: string;
  };
  Blocks: {};
}

const LoadingIndicator: TemplateOnlyComponent<Signature> = <template>
  <div class='boxel-loading-indicator' ...attributes>
    {{svgJar
      'loading-indicator'
      style=(cssVar icon-color=(or @color '#000'))
      role='presentation'
    }}
  </div>
</template>;

export default LoadingIndicator;
