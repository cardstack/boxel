import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Button } from '@cardstack/pretui/components/button';

import { RealmIcon } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

import type { EnhancedRealmInfo } from '@cardstack/host/services/realm';

import HostedPill from './hosted-pill';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    realmInfo: EnhancedRealmInfo;
    wallpaper: string | undefined;
    isHosted: boolean;
  };
}

// One workspace in a section rail flyout: its wallpaper and icon, its name
// and whether it's hosted. The caller handles the click.
const FlyoutWorkspace: TemplateOnlyComponent<Signature> = <template>
  <Button class='flyout-workspace' @appearance='plain' ...attributes>
    <span class='content'>
      <span class='thumb' style={{cssVar flyout-wallpaper=@wallpaper}}>
        <RealmIcon class='icon' @realmInfo={{@realmInfo}} aria-hidden='true' />
      </span>
      <span class='name'>{{@realmInfo.name}}</span>
      {{#if @isHosted}}
        <HostedPill />
      {{/if}}
    </span>
  </Button>

  <style scoped>
    .flyout-workspace {
      --pretui-button-h: 2.75rem;
      --pretui-button-px: var(--boxel-sp-xs);
      --pretui-button-radius: var(--boxel-border-radius-lg);
      justify-content: flex-start;
      width: 100%;
    }
    /* The panel's content width, less the row's padding and border, so a
       long name truncates instead of widening the row. */
    .content {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-sm);
      width: calc(
        var(--section-rail-flyout-content-width) - 2 * var(--boxel-sp-xs) - 2px
      );
    }
    .thumb {
      position: relative;
      flex-shrink: 0;
      width: 3rem;
      height: 2rem;
      border-radius: var(--boxel-border-radius-sm);
      background-color: var(--muted);
      background-image: var(--flyout-wallpaper);
      background-size: cover;
      background-position: center;
      box-shadow: inset 0 0 0 1px var(--boxel-light-10);
    }
    .icon {
      --boxel-realm-icon-size: 1.125rem;
      --boxel-realm-icon-border-radius: var(--boxel-border-radius-xs);
      --boxel-realm-icon-background-color: var(--boxel-light);
      position: absolute;
      inset-inline-start: var(--boxel-sp-5xs);
      bottom: var(--boxel-sp-5xs);
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--boxel-font-size-sm);
      font-weight: 600;
    }
  </style>
</template>;

export default FlyoutWorkspace;
