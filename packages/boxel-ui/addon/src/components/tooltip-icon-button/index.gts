import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { MiddlewareState } from '@floating-ui/dom';

import IconButton, { type IconButtonArgs } from '../icon-button/index.gts';
import Tooltip from '../tooltip/index.gts';

interface SignatureArgs extends IconButtonArgs {
  offset?: number;
  placement?: MiddlewareState['placement'];
  tooltipClass?: string;
}

interface Signature {
  Args: SignatureArgs;
  Blocks: {
    default: [];
    tooltipContent?: [];
  };
  Element: HTMLElement;
}

const TooltipIconButton: TemplateOnlyComponent<Signature> = <template>
  <Tooltip
    class={{@tooltipClass}}
    @placement={{@placement}}
    @offset={{@offset}}
  >
    <:trigger>
      <IconButton
        @icon={{@icon}}
        @size={{@size}}
        @kind={{@kind}}
        @round={{@round}}
        @loading={{@loading}}
        @disabled={{@disabled}}
        @width={{@width}}
        @height={{@height}}
        ...attributes
      >
        {{yield}}
      </IconButton>
    </:trigger>
    <:content>
      {{yield to='tooltipContent'}}
    </:content>
  </Tooltip>
</template>;

export default TooltipIconButton;
