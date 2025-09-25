import type { BaseDef, CardCrudFunctions, CardDef } from './card-api';
import { copyCardURLToClipboard, MenuItem } from '@cardstack/boxel-ui/helpers';

import CopyCardCommand from '@cardstack/boxel-host/commands/copy-card';
import GenerateExampleCardsCommand from '@cardstack/boxel-host/commands/generate-example-cards';
import ListingCreateCommand from '@cardstack/boxel-host/commands/listing-create';
import OpenInInteractModeCommand from '@cardstack/boxel-host/commands/open-in-interact-mode';
import PopulateWithSampleDataCommand from '@cardstack/boxel-host/commands/populate-with-sample-data';
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';
import SwitchSubmodeCommand from '@cardstack/boxel-host/commands/switch-submode';
import {
  cardTypeIcon,
  CommandContext,
  Format,
  identifyCard,
  isResolvedCodeRef,
  realmURL,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

import CodeIcon from '@cardstack/boxel-icons/code';
import ArrowLeft from '@cardstack/boxel-icons/arrow-left';
import Eye from '@cardstack/boxel-icons/eye';
import LinkIcon from '@cardstack/boxel-icons/link';
import Trash2Icon from '@cardstack/boxel-icons/trash-2';
import { AiBw as AiBwIcon } from '@cardstack/boxel-ui/icons';

const GENERATED_EXAMPLE_COUNT = 3;

export interface GetCardMenuItemParams {
  canEdit: boolean;
  cardCrudFunctions: Partial<CardCrudFunctions>;
  menuContext:
    | 'interact'
    | 'ai-assistant'
    | 'code-mode-preview'
    | 'code-mode-playground';
  commandContext: CommandContext;
  format?: Format;
}

export function getDefaultCardMenuItems(
  card: CardDef,
  params: GetCardMenuItemParams,
): MenuItem[] {
  let cardId = card.id as unknown as string;
  let menuItems: MenuItem[] = [];
  if (
    ['interact', 'code-mode-preview', 'code-mode-playground'].includes(
      params.menuContext,
    )
  ) {
    menuItems.push(
      new MenuItem('Copy Card URL', 'action', {
        action: () => copyCardURLToClipboard(cardId),
        icon: LinkIcon,
        disabled: !cardId,
      }),
    );
  }
  if (params.menuContext === 'interact') {
    if (
      !isIndexCard(card) && // workspace index card cannot be deleted
      cardId &&
      params.canEdit
    ) {
      menuItems.push(
        new MenuItem('New Card of This Type', 'action', {
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
        }),
        new MenuItem('Delete', 'action', {
          action: () => params.cardCrudFunctions.deleteCard?.(card),
          icon: Trash2Icon,
          dangerous: true,
          disabled: !card.id,
        }),
      );
    }
  }
  if (params.menuContext === 'ai-assistant') {
    menuItems.push(
      new MenuItem('Copy to Workspace', 'action', {
        action: async () => {
          const { newCardId } = await new CopyCardCommand(
            params.commandContext,
          ).execute({
            sourceCard: card,
          });

          let showCardCommand = new ShowCardCommand(params.commandContext);
          await showCardCommand.execute({
            cardId: newCardId,
          });
        },
        icon: ArrowLeft,
      }),
    );
  }
  if (
    ['code-mode-preview', 'code-mode-playground'].includes(params.menuContext)
  ) {
    menuItems.push(
      new MenuItem('Open in Interact Mode', 'action', {
        action: () => {
          new OpenInInteractModeCommand(params.commandContext).execute({
            cardId,
            format: params.format === 'edit' ? 'edit' : 'isolated',
          });
        },
        icon: Eye,
        disabled: !card.id,
      }),
    );
  }
  if (params.menuContext === 'code-mode-playground') {
    menuItems.push(
      new MenuItem('Open in Code Mode', 'action', {
        action: async () => {
          await new SwitchSubmodeCommand(params.commandContext).execute({
            submode: 'code',
            codePath: cardId ? new URL(cardId).href : undefined,
          });
        },
        icon: CodeIcon,
        disabled: !cardId,
      }),
    );
    menuItems = [...menuItems, ...getSampleDataMenuItems(card, params)];
    menuItems.push(
      new MenuItem(`Create listing with AI`, 'action', {
        action: async () => {
          await new ListingCreateCommand(params.commandContext).execute({
            openCardId: cardId,
          });
        },
        icon: AiBwIcon,
        disabled: !params.canEdit,
      }),
    );
  }
  return menuItems;
}

function getSampleDataMenuItems(
  card: CardDef,
  { commandContext }: Pick<GetCardMenuItemParams, 'commandContext'>,
): MenuItem[] {
  let cardId = card.id as unknown as string;
  let menuItems: MenuItem[] = [];
  if (cardId) {
    menuItems.push(
      new MenuItem(`Fill in sample data with AI`, 'action', {
        action: async () =>
          await new PopulateWithSampleDataCommand(commandContext).execute({
            cardId: card.id,
          }),
        icon: AiBwIcon,
        tags: ['playground-sample-data'],
      }),
    );
  }
  let codeRef = identifyCard(card.constructor);
  if (codeRef && isResolvedCodeRef(codeRef)) {
    menuItems.push(
      new MenuItem(
        `Generate ${GENERATED_EXAMPLE_COUNT} examples with AI`,
        'action',
        {
          action: async () => {
            await new GenerateExampleCardsCommand(commandContext).execute({
              count: GENERATED_EXAMPLE_COUNT,
              codeRef: codeRef as ResolvedCodeRef,
              realm: card[realmURL]?.href,
              exampleCard: card,
            });
          },
          icon: AiBwIcon,
          tags: ['playground-sample-data'],
        },
      ),
    );
  }
  return menuItems;
}

function isIndexCard(card: CardDef): boolean {
  let cardRealmURL = card[realmURL];
  if (!cardRealmURL) {
    return false;
  }
  return (card.id as unknown as string) === `${cardRealmURL.href}index`;
}
