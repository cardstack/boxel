import {
  copyCardURLToClipboard,
  type MenuItemOptions,
} from '@cardstack/boxel-ui/helpers';

import ArrowLeft from '@cardstack/boxel-icons/arrow-left';
import CodeIcon from '@cardstack/boxel-icons/code';
import Eye from '@cardstack/boxel-icons/eye';
import LinkIcon from '@cardstack/boxel-icons/link';

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
    if (fileDefInstanceId && params.canEdit) {
      // TODO: add menu item to delete the file
    }
  }
  if (
    params.menuContext === 'ai-assistant' &&
    params.menuContextParams.canEditActiveRealm
  ) {
    menuItems.push({
      label: 'Copy to Workspace',
      action: async () => {
        let { newFileUrl } = await new CopyFileToRealmCommand(
          params.commandContext,
        ).execute({
          sourceFileUrl: fileDefInstance.sourceUrl,
          targetRealm: params.menuContextParams.activeRealmURL,
        });

        await new ShowFileCommand(params.commandContext).execute({
          fileUrl: newFileUrl,
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
