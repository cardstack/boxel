// Pretui — VisuallyHidden usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { VisuallyHidden } from './visually-hidden';
import { Button } from './button';

const SOURCE = "<Button>✕<VisuallyHidden>Close dialog</VisuallyHidden></Button>";

const VisuallyHiddenUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='VisuallyHidden'
    @description='Text for assistive technology that takes no space on screen: the clip pattern, not display: none, visibility: hidden or aria-hidden, all of which remove it from the accessibility tree. Use it to name an icon-only control or to add context a sighted reader gets from layout.'
    @source={{SOURCE}}
  >
    <:example>
      <Button>✕<VisuallyHidden>Close dialog</VisuallyHidden></Button>
    </:example>
    <:api as |Args|>
      <Args.Bool @name='focusable' @defaultValue={{false}} @description='Show the content while it or anything in it has focus.' />
      <Args.Yield @name='default' @description='The text to announce.' />
    </:api>
  </FreestyleUsage>
</template>;

export const DEMOS_VISUALLY_HIDDEN: Record<string, unknown> = {
  VisuallyHidden: VisuallyHiddenUsage,
};
