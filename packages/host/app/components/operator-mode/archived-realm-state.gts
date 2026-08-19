import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { CardHeader } from '@cardstack/boxel-ui/components';
import type { MenuItem } from '@cardstack/boxel-ui/helpers';
import { Lock } from '@cardstack/boxel-ui/icons';

import type { CardErrorJSONAPI } from '@cardstack/host/services/store';

interface Signature {
  Args: {
    error: CardErrorJSONAPI;
    headerOptions?: {
      isTopCard?: boolean;
      moreOptionsMenuItems?: MenuItem[];
      onClose?: () => void;
    };
  };
  Element: HTMLElement;
}

// Shown in place of card chrome when a realm responds 403 (archived). An
// archived realm is sealed for everyone, so there is no read-only browsing —
// the only way back in is to restore it.
const ArchivedRealmState: TemplateOnlyComponent<Signature> = <template>
  <CardHeader
    class='archived-header'
    @cardTypeDisplayName='Workspace Archived'
    @cardTypeIcon={{Lock}}
    @isTopCard={{@headerOptions.isTopCard}}
    @moreOptionsMenuItems={{@headerOptions.moreOptionsMenuItems}}
    @onClose={{@headerOptions.onClose}}
    ...attributes
  />
  <div class='archived-realm-state' data-test-archived-realm-state>
    <Lock class='icon' />
    <div class='message'>
      <p class='headline'>This workspace is archived</p>
      <p class='detail'>
        Restore it from the workspace chooser, or ask an owner to restore it.
      </p>
    </div>
  </div>
  <style scoped>
    .icon {
      height: 100px;
      width: 100px;
      color: var(--boxel-400);
    }
    .archived-realm-state {
      display: flex;
      height: 100%;
      align-content: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp);
    }
    .message {
      width: 100%;
      text-align: center;
      text-wrap: pretty;
    }
    .headline {
      margin: 0;
      font: 600 var(--boxel-font);
    }
    .detail {
      margin: var(--boxel-sp-xxs) 0 0;
      color: var(--boxel-450);
      font: var(--boxel-font-sm);
    }
    .archived-header {
      min-height: var(--boxel-form-control-height);
      background-color: var(--boxel-100);
      box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
    }
  </style>
</template>;

export default ArchivedRealmState;
