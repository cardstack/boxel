import { Actions } from '@cardstack/runtime-common';

export function setupAllRealmsInfo(args: any) {
  let allRealmsInfo =
    (args.context?.actions as Actions)?.allRealmsInfo?.() ?? {};
  let writableRealms: { name: string; url: string; iconURL?: string }[] = [];
  if (allRealmsInfo) {
    Object.entries(allRealmsInfo).forEach(([realmUrl, realmInfo]) => {
      if (realmInfo.canWrite) {
        writableRealms.push({
          name: realmInfo.info.name,
          url: realmUrl,
          iconURL: realmInfo.info.iconURL ?? '/default-realm-icon.png',
        });
      }
    });
  }
  return writableRealms;
}
