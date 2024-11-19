import { CardDef } from 'https://cardstack.com/base/card-api';
import {
  CreateInstanceInput,
  ShowCardInput,
} from 'https://cardstack.com/base/command';
import { Command } from '@cardstack/runtime-common';
import CreateProductRequirementsInstance, {
  CreateProductRequirementsInput,
} from './create-product-requirements-command';
import GenerateCodeFromPRDCommand, {
  GenerateCodeFromPRDInput,
} from './generate-code-from-prd-command';

export { CreateProductRequirementsInput };

export default class CreateBoxelApp extends Command<
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
    await showCardCommand.execute(showPRDCardInput);
    // Generate App
    let generateAppCommand = new GenerateCodeFromPRDCommand(
      this.commandContext,
      undefined,
    );
    let generateAppInput = new GenerateCodeFromPRDInput();
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
    createInstanceInput.module = moduleCard;
    createInstanceInput.realm = input.realm;
    let appCard = await createInstanceCommand.execute(createInstanceInput);
    // open new app card
    let showCardInput = new ShowCardInput();
    showCardInput.cardToShow = appCard;
    await showCardCommand.execute(showCardInput);
    //   // generate some sample data
    //   // Notes:
    //   //  - We're going to need to look through the module and get the types?
    return appCard;
  }

  async getInputType(): Promise<
    new (args: any) => CreateProductRequirementsInput
  > {
    return CreateProductRequirementsInput;
  }
}
