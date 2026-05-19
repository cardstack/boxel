import {
  copyCardURLToClipboard,
  type MenuItemOptions,
} from '@cardstack/boxel-ui/helpers';

import ArrowLeft from '@cardstack/boxel-icons/arrow-left';
import ClipboardCopy from '@cardstack/boxel-icons/clipboard-copy';
import CodeIcon from '@cardstack/boxel-icons/code';
import Eye from '@cardstack/boxel-icons/eye';
import LinkIcon from '@cardstack/boxel-icons/link';
import Trash2Icon from '@cardstack/boxel-icons/trash-2';

import CopyCardAsMarkdownCommand from '@cardstack/boxel-host/commands/copy-card-as-markdown';
import CopyFileToRealmCommand from '@cardstack/boxel-host/commands/copy-file-to-realm';
import OpenInInteractModeCommand from '@cardstack/boxel-host/commands/open-in-interact-mode';
import ShowFileCommand from '@cardstack/boxel-host/commands/show-file';
import SwitchSubmodeCommand from '@cardstack/boxel-host/commands/switch-submode';

import type { FileDef } from './card-api';
import type { GetMenuItemParams } from './menu-items';

export function getDefaultFileMenuItems(
  fileDefInstance: FileDef,
  params: GetMenuItemParams,
): MenuItemOptions[] {
  let fileDefInstanceId = fileDefInstance.id as unknown as string;
  let menuItems: MenuItemOptions[] = [];
  if (
    ['interact', 'code-mode-preview', 'code-mode-playground'].includes(
      params.menuContext,
    )
  ) {
    menuItems.push({
      label: 'Copy File URL',
      action: () => copyCardURLToClipboard(fileDefInstanceId),
      icon: LinkIcon,
      disabled: !fileDefInstanceId,
    });
  }
  if (params.menuContext === 'interact') {
    if (fileDefInstanceId) {
      // Mirror the CardDef menu so users get a consistent set of actions on
      // file rows. `CopyCardAsMarkdownCommand` is generic — it fetches the
      // URL with `Accept: text/markdown` — so a file URL works the same way
      // a card URL does, returning whatever the file row's `markdown`
      // column holds (populated by the FileRender pass; null today for
      // `.gts`/`.ts` rows pending CS-11171).
      menuItems.push({
        label: 'Copy as Markdown',
        action: () =>
          new CopyCardAsMarkdownCommand(params.commandContext).execute({
            cardId: fileDefInstanceId,
          }),
        icon: ClipboardCopy,
      });
      // Files are read-only in interact-mode (no edit format). The "Open in
      // Code Mode" entry is the canonical way for a user who opened a file
      // via CardsGrid's All Files group to jump to the editing surface.
      menuItems.push({
        label: 'Open in Code Mode',
        action: async () => {
          await new SwitchSubmodeCommand(params.commandContext).execute({
            submode: 'code',
            codePath: fileDefInstanceId,
          });
        },
        icon: CodeIcon,
      });
      if (params.canEdit) {
        // `deleteCard` ultimately routes through `store.delete(id)`, which
        // calls the realm's source-delete endpoint — the endpoint doesn't
        // care whether the URL points at a card JSON or some other file
        // kind, so reusing it for FileDef rows is the right plumbing.
        menuItems.push({
          label: 'Delete',
          action: () =>
            params.cardCrudFunctions.deleteCard?.(fileDefInstanceId),
          icon: Trash2Icon,
          dangerous: true,
        });
      }
    }
  }
  if (
    params.menuContext === 'ai-assistant' &&
    params.menuContextParams.canEditActiveRealm
  ) {
    menuItems.push({
      label: 'Copy to Workspace',
      action: async () => {
        let { newFileIdentifier } = await new CopyFileToRealmCommand(
          params.commandContext,
        ).execute({
          sourceFileIdentifier: fileDefInstance.sourceUrl,
          targetRealm: params.menuContextParams.activeRealmURL,
        });

        await new ShowFileCommand(params.commandContext).execute({
          fileIdentifier: newFileIdentifier,
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
        new OpenInInteractModeCommand(params.commandContext).execute({
          cardId: fileDefInstanceId,
          format: params.format === 'edit' ? 'edit' : 'isolated',
        });
      },
      icon: Eye,
    });
  }
  if (params.menuContext === 'code-mode-playground') {
    menuItems.push({
      label: 'Open in Code Mode',
      action: async () => {
        await new SwitchSubmodeCommand(params.commandContext).execute({
          submode: 'code',
          codePath: fileDefInstanceId,
        });
      },
      icon: CodeIcon,
    });
  }
  return menuItems;
}
