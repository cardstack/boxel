import { VirtualNetwork } from '@cardstack/runtime-common';

import CreateModuleCommand from './create-module';
import PatchCardCommand from './patch-card';
import ReloadCardCommand from './reload-card';
import SaveCardCommand from './save-card';
import ShowCardCommand from './show-card';
import SwitchSubmodeCommand from './switch-submode';

export function shimHostCommands(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-module',
    CreateModuleCommand,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/potch-card',
    PatchCardCommand,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/reload-card',
    ReloadCardCommand,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/save-card',
    SaveCardCommand,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/show-card',
    ShowCardCommand,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/switch-submode',
    SwitchSubmodeCommand,
  );
}
