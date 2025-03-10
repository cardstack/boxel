import { VirtualNetwork } from '@cardstack/runtime-common';

import * as AddFieldToCardDefinitionCommandModule from './add-field-to-card-definition';
import * as AddSkillsToRoomCommandModule from './add-skills-to-room';
import * as CopyCardCommandModule from './copy-card';
import * as CreateAIAssistantRoomCommandModule from './create-ai-assistant-room';
import * as GetBoxelUiStateModule from './get-boxel-ui-state';
import * as OpenAiAssistantRoomCommandModule from './open-ai-assistant-room';
import * as PatchCardCommandModule from './patch-card';
import * as ReloadCardCommandModule from './reload-card';
import * as SaveCardCommandModule from './save-card';
import * as SearchCardsCommandModule from './search-cards';
import * as SendAiAssistantMessageModule from './send-ai-assistant-message';
import * as SetActiveLlmModule from './set-active-llm';
import * as ShowCardCommandModule from './show-card';
import * as SwitchSubmodeCommandModule from './switch-submode';
import * as UpdateSkillActivationCommandModule from './update-skill-activation';
import * as WriteTextFileCommandModule from './write-text-file';

export function shimHostCommands(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/add-field-to-card-definition',
    AddFieldToCardDefinitionCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/add-skills-to-room',
    AddSkillsToRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-card',
    CopyCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-ai-assistant-room',
    CreateAIAssistantRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-boxel-ui-state',
    GetBoxelUiStateModule,
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
    '@cardstack/boxel-host/commands/search-cards',
    SearchCardsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/open-ai-assistant-room',
    OpenAiAssistantRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/send-ai-assistant-message',
    SendAiAssistantMessageModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/set-active-llm',
    SetActiveLlmModule,
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
    '@cardstack/boxel-host/commands/update-skill-activation',
    UpdateSkillActivationCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/write-text-file',
    WriteTextFileCommandModule,
  );
}
