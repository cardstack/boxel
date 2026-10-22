// Pretui — Affix: pin a child to the top (or bottom) of its scroll container once it scrolls past a threshold.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
// type-only gap: 'ember-modifier' resolves at realm runtime; glint cannot see
// it here (accepted parse baseline, same as toaster.gts / focus.gts)
import { modifier } from 'ember-modifier';
import { scrollParent } from '../internal/structure-scroll';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';

export interface AffixSignature {
  Args: {
    /** Pin to the 'top' (default) or 'bottom' edge of the scroll container. */
    position?: 'top' | 'bottom';
    /** Distance from that edge while pinned, any kit-valid CSS length (default 0). */
    offset?: string;
    /** Fires with true when the child becomes pinned and false when it is released. */
    onChange?: (pinned: boolean) => void;
  };
  Blocks: { default: [pinned: boolean] };
  Element: HTMLDivElement;
}

/**
 * Ant and Mantine Affix, done with CSS: the wrapper is `position: sticky`, so
 * the browser pins it inside its nearest scroll container — the pane, not the
 * window — with no scroll listener and no portal. What CSS cannot say is
 * *whether* it is pinned, so a zero-height sentinel just before (or after)
 * the child is watched with an IntersectionObserver rooted at the scroll
 * container: when the sentinel leaves, the child is stuck. That state is
 * yielded, set as `data-pinned` for styling, and reported by `@onChange`.
 *
 * Pinning is visual, so nothing is announced. Sticky needs the scroll
 * container to be the nearest ancestor with overflow; a parent with
 * `overflow: hidden` in between stops it, which is the one case a portal-
 * based affix handles and this does not.
 */
export class Affix extends Component<AffixSignature> {
  @tracked pinned = false;

  get position(): 'top' | 'bottom' {
    return this.args.position === 'bottom' ? 'bottom' : 'top';
  }
  get isTop(): boolean {
    return this.position === 'top';
  }
  get style() {
    return cssStyleFrom([cssDeclaration('--pretui-affix-offset', this.args.offset)]);
  }

  watch = modifier((sentinel: HTMLElement, [position, offset]: [string, string | undefined]) => {
    void offset;
    let root = scrollParent(sentinel);
    // The wrapper sticks at its used inset (rem, calc, whatever @offset was),
    // so the observer's edge moves in by the same amount; otherwise the
    // pinned state lags the pinning by the offset.
    let wrapper = (position === 'top' ? sentinel.nextElementSibling : sentinel.previousElementSibling) as HTMLElement | null;
    let inset = wrapper ? parseFloat(getComputedStyle(wrapper)[position === 'top' ? 'top' : 'bottom']) || 0 : 0;
    let rootMargin = position === 'top' ? `${-inset}px 0px 0px 0px` : `0px 0px ${-inset}px 0px`;
    let observer = new IntersectionObserver(
      (entries) => {
        let entry = entries[entries.length - 1];
        if (!entry) {
          return;
        }
        // Stuck when the sentinel has left through the pinned edge.
        let box = entry.rootBounds;
        let rect = entry.boundingClientRect;
        let gone = !entry.isIntersecting;
        let pinned = gone && (box ? (position === 'top' ? rect.top < box.top : rect.bottom > box.bottom) : true);
        if (pinned !== this.pinned) {
          this.pinned = pinned;
          this.args.onChange?.(pinned);
        }
      },
      { root, rootMargin, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  <template>
    {{#if this.isTop}}<div class='pretui-affix-sentinel' aria-hidden='true' {{this.watch this.position @offset}}></div>{{/if}}
    <div
      class='pretui-affix'
      data-position={{this.position}}
      data-pinned={{if this.pinned 'true' 'false'}}
      style={{this.style}}
      data-test-pretui-affix
      ...attributes
    >{{yield this.pinned}}</div>
    {{#unless this.isTop}}<div class='pretui-affix-sentinel' aria-hidden='true' {{this.watch this.position @offset}}></div>{{/unless}}
    <style scoped>
      @layer PretComponent {
        .pretui-affix {
          position: sticky;
          z-index: var(--pretui-z-sticky, 10);
        }
        .pretui-affix[data-position='top'] {
          inset-block-start: var(--pretui-affix-offset, 0);
        }
        .pretui-affix[data-position='bottom'] {
          inset-block-end: var(--pretui-affix-offset, 0);
        }
        .pretui-affix[data-pinned='true'] {
          box-shadow: var(--pretui-affix-shadow, none);
        }
        .pretui-affix-sentinel {
          block-size: 0;
          pointer-events: none;
        }
      }
    </style>
  </template>

}

