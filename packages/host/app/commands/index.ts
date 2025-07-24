import { VirtualNetwork } from '@cardstack/runtime-common';

import * as AddFieldToCardDefinitionCommandModule from './add-field-to-card-definition';
import * as AddSkillsToRoomCommandModule from './add-skills-to-room';
import * as ApplySearchReplaceBlockCommandModule from './apply-search-replace-block';
import * as CopyCardCommandModule from './copy-card';
import * as CopySourceCommandModule from './copy-source';
import * as CreateAIAssistantRoomCommandModule from './create-ai-assistant-room';
import * as GetEventsFromRoomCommandModule from './get-events-from-room';
import * as ListingInitCommandModule from './listing-action-init';
import * as ListingCreateCommandModule from './listing-create';
import * as ListingInstallCommandModule from './listing-install';
import * as ListingRemixCommandModule from './listing-remix';
import * as ListingUseCommandModule from './listing-use';
import * as OpenAiAssistantRoomCommandModule from './open-ai-assistant-room';
import * as OpenWorkspaceCommandModule from './open-workspace';
import * as PatchCardInstanceCommandModule from './patch-card-instance';
import * as PatchCodeCommandModule from './patch-code';
import * as PreviewFormatCommandModule from './preview-format';
import * as ReadCardForAiAssistantCommandModule from './read-card-for-ai-assistant';
import * as ReadFileForAiAssistantCommandModule from './read-file-for-ai-assistant';
import * as SaveCardCommandModule from './save-card';
import * as SearchCardsCommandModule from './search-cards';
import * as SendAiAssistantMessageModule from './send-ai-assistant-message';
import * as SetActiveLlmModule from './set-active-llm';
import * as ShowCardCommandModule from './show-card';
import * as SwitchSubmodeCommandModule from './switch-submode';
import * as TransformCardsCommandModule from './transform-cards';
import * as UpdateCodePathWithSelectionCommandModule from './update-code-path-with-selection';
import * as UpdatePlaygroundSelectionCommandModule from './update-playground-selection';
import * as UpdateSkillActivationCommandModule from './update-skill-activation';
import * as CommandUtilsModule from './utils';
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
    '@cardstack/boxel-host/commands/apply-search-replace-block',
    ApplySearchReplaceBlockCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-card',
    CopyCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-source',
    CopySourceCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-ai-assistant-room',
    CreateAIAssistantRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-events-from-room',
    GetEventsFromRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/listing-action-init',
    ListingInitCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/listing-create',
    ListingCreateCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/listing-install',
    ListingInstallCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/listing-use',
    ListingUseCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/listing-remix',
    ListingRemixCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/patch-card-instance',
    PatchCardInstanceCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/patch-code',
    PatchCodeCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/preview-format',
    PreviewFormatCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/read-card-for-ai-assistant',
    ReadCardForAiAssistantCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/read-file-for-ai-assistant',
    ReadFileForAiAssistantCommandModule,
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
    '@cardstack/boxel-host/commands/open-workspace',
    OpenWorkspaceCommandModule,
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
    '@cardstack/boxel-host/commands/transform-cards',
    TransformCardsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/update-code-path-with-selection',
    UpdateCodePathWithSelectionCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/update-playground-selection',
    UpdatePlaygroundSelectionCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/update-skill-activation',
    UpdateSkillActivationCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/utils',
    CommandUtilsModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/write-text-file',
    WriteTextFileCommandModule,
  );
}
