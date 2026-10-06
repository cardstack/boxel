// Pretui — StackDivider: the layout-local hairline that pairs with Stack.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { pretuiOrientation } from '../internal/structure-layout';
import type { Orientation, OrientationAlias } from '../internal/structure-layout';

const axisOf = (orientation?: string, direction?: string): Orientation =>
  pretuiOrientation(orientation, direction, 'vertical');

// the rule runs across the Stack, so it is announced perpendicular to its axis
const ruleOf = (orientation?: string, direction?: string): Orientation =>
  axisOf(orientation, direction) === 'horizontal' ? 'vertical' : 'horizontal';

/**
 * A hairline, exported here because `Stack` documents it as the semantic
 * partner to its own decorative rule and because `Separator` is the name the
 * React corpus uses. Deliberately thin: `Divider` in the reading territory
 * stays the canonical one — this is the layout-local rule with an
 * `@orientation` that matches Stack's.
 */
export interface StackDividerSignature {
  Args: {
    orientation?: Orientation;
    direction?: OrientationAlias;
    /** Semantic separator rather than decoration — announced to readers. */
    semantic?: boolean;
  };
  Element: HTMLSpanElement;
}

export const StackDivider: TemplateOnlyComponent<StackDividerSignature> =
  <template>
    <span
      class='pretui-stack-divider'
      data-orientation={{axisOf @orientation @direction}}
      role={{if @semantic 'separator'}}
      aria-orientation={{if @semantic (ruleOf @orientation @direction)}}
      aria-hidden={{unless @semantic 'true'}}
      data-test-pretui-stack-divider
      ...attributes
    ></span>
    <style scoped>
      @layer PretComponent {
        .pretui-stack-divider {
          flex: none;
          align-self: stretch;
          background: var(--pretui-stack-rule-color, var(--border));
        }
        .pretui-stack-divider[data-orientation='vertical'],
        .pretui-stack-divider[data-orientation='column'] {
          block-size: 1px;
        }
        .pretui-stack-divider[data-orientation='horizontal'],
        .pretui-stack-divider[data-orientation='row'] {
          inline-size: 1px;
        }
      }
    </style>
  </template>;
