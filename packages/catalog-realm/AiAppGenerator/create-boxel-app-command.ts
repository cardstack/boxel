import { CardDef } from 'https://cardstack.com/base/card-api';
import { ShowCardInput } from 'https://cardstack.com/base/command';
import { Command } from '@cardstack/runtime-common';
import CreateProductRequirementsInstance, {
  CreateProductRequirementsInput,
} from './create-product-requirements-command';

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
    let showCardCommand = this.commandContext.lookupCommand<
      ShowCardInput,
      undefined
    >('show-card');
    let showPRDCardInput = new ShowCardInput();
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
