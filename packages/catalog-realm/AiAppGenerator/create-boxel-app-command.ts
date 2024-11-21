import { CardDef } from 'https://cardstack.com/base/card-api';
import { Command } from '@cardstack/runtime-common';
import CreateProductRequirementsInstance, {
  CreateProductRequirementsInput,
} from './create-product-requirements-command';
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';

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
    let { productRequirements: prdCard } = await createPRDCommand.execute(
      input,
    );
    let showCardCommand = new ShowCardCommand(this.commandContext);
    let ShowPRDCardInput = await showCardCommand.getInputType();
    let showPRDCardInput = new ShowPRDCardInput();
    showPRDCardInput.cardToShow = prdCard;
    await showCardCommand.execute(showPRDCardInput);
    return prdCard;
  }

  async getInputType(): Promise<
    new (args: any) => CreateProductRequirementsInput
  > {
    return CreateProductRequirementsInput;
  }
}
