import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cssVar from '../../helpers/css-var';
import { svgJar } from '../../helpers/svg-jar';
import { type EmptyObject } from '@ember/component/helper';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    color?: string;
  };
  Blocks: EmptyObject;
}

const LoadingIndicator: TemplateOnlyComponent<Signature> = <template>
  <div class='boxel-loading-indicator' ...attributes>
    {{svgJar
      'loading-indicator'
      style=(cssVar icon-color=(if @color @color '#000'))
      role='presentation'
    }}
  </div>
</template>;

export default LoadingIndicator;
