import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { SkillCard } from 'https://cardstack.com/base/skill-card';
import {
  CreateInstanceInput,
  CreateModuleInput,
  ModuleCard,
  PatchCardInput,
  SaveCardInput,
  ShowCardInput,
} from 'https://cardstack.com/base/command';
import { Command } from '@cardstack/runtime-common';
import { ProductRequirementDocument } from '../product-requirement-document';
import CodeRefField from 'https://cardstack.com/base/code-ref';

export class CreateProductRequirementsInput extends CardDef {
  @field targetAudience = contains(StringField);
  @field productDescription = contains(StringField);
  @field features = contains(StringField);
  @field realm = contains(StringField);
}

export class CreateProductRequirementsResult extends CardDef {
  @field productRequirements = linksTo(ProductRequirementDocument);
  @field roomId = contains(StringField);
}

export class CreateProductRequirementsInstance extends Command<
  CreateProductRequirementsInput,
  CreateProductRequirementsResult
> {
  inputType = CreateProductRequirementsInput;

  get skillCard() {
    return new SkillCard({
      id: 'SkillCard1',
      name: 'PRD Helper',
      description:
        'This skill card can be used to help with creating product requirements',
      instructions:
        'You are a helpful assistant that can help with creating product requirements, etc. You *MUST* make the patchCard function call',
    });
  }

  createPrompt(input: CreateProductRequirementsInput) {
    return `Create product requirements for ${input.targetAudience} with the following description: ${input.productDescription}. Focus on the following features: ${input.features}`;
  }

  protected async run(
    input: CreateProductRequirementsInput,
  ): Promise<CreateProductRequirementsResult> {
    console.log('Input into the run', input);
    // Create new card
    let prdCard = new ProductRequirementDocument();
    console.log('prdCard', prdCard);

    let saveCardCommand = this.commandContext.lookupCommand<
      SaveCardInput,
      undefined
    >('save-card'); // lookupCommand creates the instance and passes in the context
    console.log('saveCardCommand', saveCardCommand);
    let SaveCardInputType = await saveCardCommand.getInputType();
    await saveCardCommand.execute(
      new SaveCardInputType({
        realm: input.realm,
        card: prdCard,
      }),
    );
    console.log('prdCard after save', prdCard);

    // Get patch command, this takes the card and returns a command that can be used to patch the card
    let patchPRDCommand = this.commandContext.lookupCommand<
      PatchCardInput,
      undefined,
      ProductRequirementDocument
    >('patch-card', { cardType: ProductRequirementDocument });
    console.log('patchPRDCommand', patchPRDCommand);

    // This should return a session ID so that we can potentially send followup messages
    // This should delegate to a matrix service method. Besides actually sending the message,
    // with attached cards, skill cards, and commands, it should also be responsible for assigning
    // ids to the commands which are used to give the tools unique names (e.g. patchCard_ABC)
    // service should maintain a mapping of commandIds to command instances in order to map an apply
    // back to the correct command instance
    // Auto execute commands are commands that should be executed automatically if they are returned
    // as tool calls from the AI.

    let { roomId } = await this.commandContext.sendAiAssistantMessage({
      show: false, // maybe? open the side panel
      prompt: this.createPrompt(input),
      attachedCards: [prdCard],
      skillCards: [this.skillCard],
      commands: [{ command: patchPRDCommand, autoExecute: true }], // this should persist over multiple messages, matrix service is responsible to tracking whic
    });

    console.log('roomId', roomId);

    // Wait for the PRD command to have been applied
    await patchPRDCommand.waitForNextCompletion();
    // TODO: alternate approach is to have room have a goal, and monitor for that completion as opposed to command completion
    // TODO: alternate simpler approach, send a message and wait for a reply. If the reply is a the tool call, continue, otherwise, show room to the user and wait for the next reply

    console.log('prdCard after patch', prdCard);

    let reloadCommand = await this.commandContext.lookupCommand<
      CardDef,
      undefined
    >('reload-card');
    await reloadCommand.execute(prdCard);
    console.log('prdCard after reload', prdCard);
    let result = new CreateProductRequirementsResult();
    result.productRequirements = prdCard;
    result.roomId = roomId;
    return result;
  }
}

export class GenerateAppInput extends CardDef {
  @field productRequirements = linksTo(ProductRequirementDocument);
  @field realm = contains(StringField);
  @field roomId = contains(StringField);
}

class GenerateCodeFromPRDResult extends CardDef {
  @field module = contains(CodeRefField);
  @field roomId = contains(StringField);
}

export class GenerateCodeFromPRDCommand extends Command<
  GenerateAppInput,
  GenerateCodeFromPRDResult
> {
  inputType = GenerateAppInput;

  get skillCard() {
    return new SkillCard({
      name: 'Boxel App Generator',
      description:
        'This skill card helps generate code from product requirements',
      instructions:
        'You are an expert programmer. Given product requirements, generate appropriate code that implements those requirements. Use the createModule command to create the module with the generated code.',
    });
  }

  createPrompt(prdCard: ProductRequirementDocument) {
    // TODO: use this PRD card value?
    return `Please analyze the provided product requirements and generate appropriate code to implement them. Consider best practices, maintainability, and performance.`;
  }

  protected async run(
    input: GenerateAppInput,
  ): Promise<GenerateCodeFromPRDResult> {
    // Get the create module command
    let createModuleCommand = this.commandContext.lookupCommand<
      CreateModuleInput,
      ModuleCard
    >('createModule');

    // Send message to AI assistant with the PRD card and wait for it to generate code
    let { roomId } = await this.commandContext.sendAiAssistantMessage({
      roomId: input.roomId,
      show: true,
      prompt: this.createPrompt(input.productRequirements),
      attachedCards: [input.productRequirements],
      skillCards: [this.skillCard],
      commands: [{ command: createModuleCommand, autoExecute: true }],
    });

    // Wait for the module to be created
    const moduleCard = await createModuleCommand.waitForNextCompletion();

    let result = new GenerateCodeFromPRDResult();
    result.module = moduleCard.module;
    result.roomId = roomId;
    return result;
  }
}

export class CreateBoxelApp extends Command<
  CreateProductRequirementsInput,
  CardDef
> {
  inputType = CreateProductRequirementsInput;

  protected async run(input: CreateProductRequirementsInput): Promise<CardDef> {
    // Create PRD
    let createPRDCommand = new CreateProductRequirementsInstance(
      this.commandContext,
      undefined,
    );
    let { productRequirements: prdCard, roomId } =
      await createPRDCommand.execute(input);
    let showCardCommand = this.commandContext.lookupCommand<
      ShowCardInput,
      undefined
    >('show-card');
    let showPRDCardInput = new ShowCardInput();
    showPRDCardInput.cardToShow = prdCard;
    showPRDCardInput.placement = 'addToStack'; // probably want to be able to lookup what stack to add this to, based on where the app card is, if visible
    await showCardCommand.execute(showPRDCardInput);
    // Generate App
    let generateAppCommand = new GenerateCodeFromPRDCommand(
      this.commandContext,
      undefined,
    );
    let generateAppInput = new GenerateAppInput();
    generateAppInput.productRequirements = prdCard;
    generateAppInput.realm = input.realm;
    generateAppInput.roomId = roomId;
    let { module: moduleCard } = await generateAppCommand.execute(
      generateAppInput,
    );
    // Create instance
    let createInstanceCommand = this.commandContext.lookupCommand<
      CreateInstanceInput,
      CardDef
    >('createInstance');
    let createInstanceInput = new CreateInstanceInput();
    createInstanceInput.module = moduleCard.module;
    createInstanceInput.realm = input.realm;
    let appCard = await createInstanceCommand.execute(createInstanceInput);
    // open new app card
    let showCardInput = new ShowCardInput();
    showCardInput.cardToShow = appCard;
    showCardInput.placement = 'addToStack'; // probably want to be able to lookup what stack to add this to, based on where the app card is, if visible
    await showCardCommand.execute(showCardInput);
    //   // generate some sample data
    //   // Notes:
    //   //  - We're going to need to look through the module and get the types?
    return appCard;
  }
}
