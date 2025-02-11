import { VirtualNetwork } from '@cardstack/runtime-common';

import { AddFieldToCardDefinitionCommand } from './add-field-to-card-definition';
import { AddSkillsToRoomCommand } from './add-skills-to-room';
import { CopyCardCommand } from './copy-card';
import { CreateAIAssistantRoomCommand } from './create-ai-assistant-room';
import { OpenAiAssistantRoomCommand } from './open-ai-assistant-room';
import { PatchCardCommand } from './patch-card';
import { ReloadCardCommand } from './reload-card';
import { SaveCardCommand } from './save-card';
import {
  SearchCardsByTypeAndTitleCommand,
  SearchCardsByQueryCommand,
} from './search-cards';
import { SendAiAssistantMessageCommand } from './send-ai-assistant-message';
import { SetActiveLLMCommand } from './set-active-llm';
import { ShowCardCommand } from './show-card';
import { SwitchSubmodeCommand } from './switch-submode';
import { UpdateSkillActivationCommand } from './update-skill-activation';
import { WriteTextFileCommand } from './write-text-file';

export function shimHostCommands(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/add-field-to-card-definition',
    { AddFieldToCardDefinitionCommand },
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/add-skills-to-room',
    { AddSkillsToRoomCommand },
  );
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/copy-card', {
    CopyCardCommand,
  });
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-ai-assistant-room',
    { CreateAIAssistantRoomCommand },
  );
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/patch-card', {
    PatchCardCommand,
  });
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/reload-card', {
    ReloadCardCommand,
  });
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/save-card', {
    SaveCardCommand,
  });
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/search-cards', {
    SearchCardsByTypeAndTitleCommand,
    SearchCardsByQueryCommand,
  });
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/open-ai-assistant-room',
    { OpenAiAssistantRoomCommand },
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/send-ai-assistant-message',
    { SendAiAssistantMessageCommand },
  );
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/set-active-llm', {
    SetActiveLLMCommand,
  });
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/show-card', {
    ShowCardCommand,
  });
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/switch-submode', {
    SwitchSubmodeCommand,
  });
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/update-skill-activation',
    { UpdateSkillActivationCommand },
  );
  virtualNetwork.shimModule('@cardstack/boxel-host/commands/write-text-file', {
    WriteTextFileCommand,
  });
}
