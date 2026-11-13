import type { BaseDef, CardCrudFunctions, CardDef } from './card-api';
import { instanceRealmId, openableURLOf } from './card-api';
import {
  copyCardURLToClipboard,
  type MenuItemOptions,
} from '@cardstack/boxel-ui/helpers';

import CopyCardAsMarkdownTool from '@cardstack/boxel-host/commands/copy-card-as-markdown';
import CopyCardCommand from '@cardstack/boxel-host/commands/copy-card';
import GenerateExampleCardsTool from '@cardstack/boxel-host/commands/generate-example-cards';
import OpenCreateListingModalTool from '@cardstack/boxel-host/commands/open-create-listing-modal';
import OpenInInteractModeTool from '@cardstack/boxel-host/commands/open-in-interact-mode';
import PopulateWithSampleDataTool from '@cardstack/boxel-host/commands/populate-with-sample-data';
import SetWorkspacePinTool from '@cardstack/boxel-host/commands/set-workspace-pin';
import ShowCardTool from '@cardstack/boxel-host/commands/show-card';
import type {
  ToolContext,
  Format,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  cardTypeIcon,
  identifyCard,
  isRealmIndexCardId,
  isResolvedCodeRef,
  realmURL,
  rri,
} from '@cardstack/runtime-common';
import { resolveAdoptsFrom } from '@cardstack/runtime-common';

import ArrowLeft from '@cardstack/boxel-icons/arrow-left';
import ClipboardCopy from '@cardstack/boxel-icons/clipboard-copy';
import Eye from '@cardstack/boxel-icons/eye';
import LinkIcon from '@cardstack/boxel-icons/link';
import Pin from '@cardstack/boxel-icons/pin';
import PinOff from '@cardstack/boxel-icons/pin-off';
import Trash2Icon from '@cardstack/boxel-icons/trash-2';
import Wand from '@cardstack/boxel-icons/wand';

const GENERATED_EXAMPLE_COUNT = 3;

// The card's id is canonical RRI, so its realm is taken in the same form.
function isWorkspaceIndexCard(card: CardDef): boolean {
  let cardId = typeof card.id === 'string' ? rri(card.id) : undefined;
  return isRealmIndexCardId(cardId, instanceRealmId(card));
}

type MenuContext =
  | {
      menuContext: 'interact' | 'code-mode-preview' | 'code-mode-playground';
    }
  | {
      menuContext: 'ai-assistant';
      menuContextParams: {
        canEditActiveRealm: boolean;
        activeRealmURL: string;
      };
    };

export type GetMenuItemParams = {
  canEdit: boolean;
  // Whether to offer Delete. Absent, Delete is offered exactly where editing
  // is. A host sets it where a delete can be admitted without write access,
  // such as on a grant in the realm's policy.
  canDelete?: boolean;
  cardCrudFunctions: Partial<CardCrudFunctions>;
  toolContext: ToolContext;
  format?: Format;
  useBaseTemplate?: boolean;
  // Set by the host when the user can pin this card to its workspace.
  workspacePin?: { pinned: boolean };
} & MenuContext;

function makeWorkspacePinItem(
  card: CardDef,
  params: GetMenuItemParams,
): MenuItemOptions | undefined {
  let cardId = card.id as unknown as string;
  if (!params.workspacePin || !cardId || isWorkspaceIndexCard(card)) {
    return undefined;
  }
  let { pinned } = params.workspacePin;
  return {
    label: pinned ? 'Unpin from Workspace' : 'Pin to Workspace',
    action: () =>
      new SetWorkspacePinTool(params.toolContext).execute({
        cardId,
        pinned: !pinned,
      }),
    icon: pinned ? PinOff : Pin,
  };
}

function makeToggleTemplateItem(
  card: CardDef,
  useBaseTemplate: boolean | undefined,
  action: (useBaseTemplate: boolean) => void,
): MenuItemOptions {
  return {
    label: 'Toggle Standard View',
    action: () => action(!useBaseTemplate),
    icon: Eye,
    checked: !!useBaseTemplate,
    disabled: !card.id,
  };
}

export function getDefaultCardMenuItems(
  card: CardDef,
  params: GetMenuItemParams,
): MenuItemOptions[] {
  let cardId = card.id as unknown as string;
  let menuItems: MenuItemOptions[] = [];
  if (
    ['interact', 'code-mode-preview', 'code-mode-playground'].includes(
      params.menuContext,
    )
  ) {
    menuItems.push({
      label: 'Copy Card URL',
      action: () => copyCardURLToClipboard(openableURLOf(card) ?? cardId),
      icon: LinkIcon,
      disabled: !cardId,
    });
    let pinItem = makeWorkspacePinItem(card, params);
    if (pinItem) {
      menuItems.push(pinItem);
    }
  }
  if (params.menuContext === 'interact') {
    menuItems.push({
      label: 'Copy as Markdown',
      action: () =>
        new CopyCardAsMarkdownTool(params.toolContext).execute({
          cardId,
        }),
      icon: ClipboardCopy,
      disabled: !cardId,
    });
    if (
      cardId &&
      params.canEdit &&
      params.format === 'edit' &&
      (card.constructor as typeof CardDef).hasCustomEditTemplate
    ) {
      menuItems.push(
        makeToggleTemplateItem(
          card,
          params.useBaseTemplate,
          (useBaseTemplate) =>
            params.cardCrudFunctions.editCard?.(card, { useBaseTemplate }),
        ),
      );
    }
    if (
      cardId &&
      params.format === 'isolated' &&
      (card.constructor as typeof CardDef).hasCustomIsolatedTemplate
    ) {
      menuItems.push(
        makeToggleTemplateItem(
          card,
          params.useBaseTemplate,
          (useBaseTemplate) =>
            params.cardCrudFunctions.viewCard?.(card, 'isolated', {
              useBaseTemplate,
            }),
        ),
      );
    }
    // The workspace index card is neither deleted nor used as a template.
    let isIndexCard = isWorkspaceIndexCard(card);
    if (!isIndexCard && cardId && params.canEdit) {
      menuItems.push({
        label: 'New Card of This Type',
        action: () => {
          if (!card) {
            return;
          }
          let ref = identifyCard(card.constructor);
          if (!ref) {
            return;
          }
          params.cardCrudFunctions.createCard?.(ref, undefined, {
            realmURL: card[realmURL],
          });
        },
        icon: cardTypeIcon(card as BaseDef),
        disabled: !card,
      });
    }
    if (!isIndexCard && cardId && (params.canDelete ?? params.canEdit)) {
      menuItems.push({
        label: 'Delete',
        action: () => params.cardCrudFunctions.deleteCard?.(card),
        icon: Trash2Icon,
        dangerous: true,
        disabled: !card.id,
      });
    }
  }
  if (
    params.menuContext === 'ai-assistant' &&
    params.menuContextParams.canEditActiveRealm
  ) {
    menuItems.push({
      label: 'Copy to Workspace',
      action: async () => {
        const { newCardId } = await new CopyCardCommand(
          params.toolContext,
        ).execute({
          sourceCard: card,
          targetRealm: params.menuContextParams.activeRealmURL,
        });

        let showCardCommand = new ShowCardTool(params.toolContext);
        await showCardCommand.execute({
          cardId: newCardId,
        });
      },
      icon: ArrowLeft,
    });
  }
  if (
    ['code-mode-preview', 'code-mode-playground'].includes(params.menuContext)
  ) {
    menuItems.push({
      label: 'Open in Interact Mode',
      action: () => {
        new OpenInInteractModeTool(params.toolContext).execute({
          cardId,
          format: params.format === 'edit' ? 'edit' : 'isolated',
        });
      },
      icon: Eye,
      disabled: !card.id,
    });
  }
  if (params.menuContext === 'code-mode-playground') {
    // No "Open in Code Mode" here: the playground panel already lives inside
    // code submode, so the entry would be a no-op switch to the mode we're in.
    menuItems = [...menuItems, ...getSampleDataMenuItems(card, params)];
    if (cardId && !isWorkspaceIndexCard(card)) {
      menuItems.push({
        label: `Create Listing`,
        action: async () => {
          const codeRef = resolveAdoptsFrom(card);
          if (!codeRef) {
            throw new Error('Unable to resolve codeRef from card');
          }
          const targetRealm = card[realmURL]?.href;
          if (!targetRealm) {
            throw new Error('Unable to determine target realm from card');
          }
          await new OpenCreateListingModalTool(params.toolContext).execute({
            codeRef,
            openCardIds: [cardId],
            targetRealm,
          });
        },
        icon: Wand,
        disabled: !params.canEdit,
      });
    }
  }
  return menuItems;
}

function getSampleDataMenuItems(
  card: CardDef,
  { toolContext }: Pick<GetMenuItemParams, 'toolContext'>,
): MenuItemOptions[] {
  let cardId = card.id as unknown as string;
  let menuItems: MenuItemOptions[] = [];
  if (cardId) {
    menuItems.push({
      label: `Fill in Sample Data with AI`,
      action: async () =>
        await new PopulateWithSampleDataTool(toolContext).execute({
          cardId: card.id,
        }),
      icon: Wand,
      tags: ['playground-sample-data'],
    });
  }
  let codeRef = identifyCard(card.constructor);
  if (codeRef && isResolvedCodeRef(codeRef)) {
    menuItems.push({
      label: `Generate ${GENERATED_EXAMPLE_COUNT} examples with AI`,
      action: async () => {
        await new GenerateExampleCardsTool(toolContext).execute({
          count: GENERATED_EXAMPLE_COUNT,
          codeRef: codeRef as ResolvedCodeRef,
          realm: card[realmURL]?.href,
          exampleCard: card,
        });
      },
      icon: Wand,
      tags: ['playground-sample-data'],
    });
  }
  return menuItems;
}
