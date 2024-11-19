import { CardDef } from 'https://cardstack.com/base/card-api';
import { Command } from '@cardstack/runtime-common';
import CreateProductRequirementsInstance, {
  CreateProductRequirementsInput,
} from './create-product-requirements-command';
import GenerateCodeFromPRDCommand, {
  GenerateCodeFromPRDInput,
} from './generate-code-from-prd-command';
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

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
    let showCardCommand = new ShowCardCommand(this.commandContext);
    let ShowPRDCardInput = await showCardCommand.getInputType();
    let showPRDCardInput = new ShowPRDCardInput();
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
    let saveCardCommand = new SaveCardCommand(this.commandContext);
    let SaveCardInput = await saveCardCommand.getInputType();
    let saveCardInput = new SaveCardInput();
    let appCard: CardDef; // = new moduleCard(); // TODO create instance from code ref
    saveCardInput.card = appCard;
    saveCardInput.realm = input.realm;
    await saveCardCommand.execute(saveCardInput);
    // open new app card
    let ShowCardInput = await showCardCommand.getInputType();
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
