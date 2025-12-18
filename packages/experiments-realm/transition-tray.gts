import { viewTransitionName } from '@cardstack/view-transitions';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

// deliberately unscoped CSS
const style = `
/*
  This view-transition-group wraps around each pair of captured outer divs.
  We apply the border animations directly to this wrapper. It naturally
  animates its width, height, and position to cover the before/after states.
*/
::view-transition-group(.expansion) {
  animation-duration: 0.5s;
  border: 1px solid black;
  box-sizing: border-box;
  border-radius: 10px;
  background-color: white;
  box-shadow: #0000007d 5px 5px 9px 0px;
}

/*
  These are the captured screenshots of the outer div. We don't use them at
  all, because instead we're animating the view-transition-group that wraps
  around them. If we animated these, we'd see nasty scaling of the border
  and border radius.
*/
::view-transition-old(.expansion),
::view-transition-new(.expansion) {
  animation: none;
  display: none;
}

/*
  If either the old or new captured div was marked as the expanded one, our
  transition group gets lifted above the others. Without this, background
  cards can be in front of our moving card.
*/
::view-transition-group(.isolated) {
  z-index: 10;
}

/*
  This group covers the captured inner divs. It mostly relies on defaults
  (which do a blended cross fade). The captured screenshots get extra
  clpping of their corners so they don't leak over the rounded corners of
  the animating outer div. To do this more precisely, we would need Nested
  View Transitions
  (https://developer.chrome.com/docs/css-ui/view-transitions/nested-view-transition-groups).
  */
::view-transition-group(.content-swap) {
  animation-duration: 0.5s;
  overflow: clip;
  clip-path: inset(0px round 10px);
}
`;

const styleNode = document.createElement('style');
styleNode.appendChild(document.createTextNode(style));
document.head.appendChild(styleNode);

export const Tray = <template>
  <style scoped>
    .outer {
      border: 1px solid black;
      border-radius: 10px;
      box-shadow: #0000007d 5px 5px 9px 0px;
      background-color: white;
      overflow: clip;
      view-transition-class: expansion;
    }
    .expanded.outer {
      view-transition-class: expansion isolated;
    }
    .inner {
      view-transition-class: content-swap;
      width: 100%;
      height: 100%;
    }
    .expanded .inner {
      view-transition-class: content-swap isolated;
    }
  </style>
  <div
    class='outer {{if @expanded "expanded"}}'
    ...attributes
    {{viewTransitionName 'outer' @matchId}}
  >
    <div class='inner' {{viewTransitionName 'inner' @matchId}}>
      {{yield}}
    </div>
  </div>
</template> satisfies TemplateOnlyComponent<{
  Element: HTMLElement;
  Blocks: { default: [] };
  Args: { matchId: string | number; expanded?: boolean };
}>;
