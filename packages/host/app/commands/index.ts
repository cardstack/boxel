import { VirtualNetwork } from '@cardstack/runtime-common';

import * as AddSkillsToRoomCommandModule from './add-skills-to-room';
import * as CreateAIAssistantRoomCommandModule from './create-ai-assistant-room';
import * as PatchCardCommandModule from './patch-card';
import * as ReloadCardCommandModule from './reload-card';
import * as SaveCardCommandModule from './save-card';
import * as ShowCardCommandModule from './show-card';
import * as SwitchSubmodeCommandModule from './switch-submode';
import * as WriteTextFileCommandModule from './write-text-file';

export function shimHostCommands(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/add-skills-to-room',
    AddSkillsToRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-ai-assistant-room',
    CreateAIAssistantRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/patch-card',
    PatchCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/reload-card',
    ReloadCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/save-card',
    SaveCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/show-card',
    ShowCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/switch-submode',
    SwitchSubmodeCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/write-text-file',
    WriteTextFileCommandModule,
  );
}
