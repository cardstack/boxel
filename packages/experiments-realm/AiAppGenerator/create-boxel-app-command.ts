import { CardDef } from 'https://cardstack.com/base/card-api';
import { Command } from '@cardstack/runtime-common';
import CreateProductRequirementsInstance, {
  CreateProductRequirementsInput,
} from '../../catalog-realm/AiAppGenerator/create-product-requirements-command';
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';
import WriteTextFileCommand from '@cardstack/boxel-host/commands/write-text-file';
import GenerateCodeCommand from './generate-code-command';
import { GenerateCodeInput } from './generate-code-command';
import { AppCard } from '../app-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

export { CreateProductRequirementsInput };

export default class CreateBoxelApp extends Command<
  CreateProductRequirementsInput,
  CardDef
> {
  inputType = CreateProductRequirementsInput;

  protected async run(input: CreateProductRequirementsInput): Promise<CardDef> {
    let createPRDCommand = new CreateProductRequirementsInstance(
      this.commandContext,
      undefined,
    );
    let { productRequirements: prdCard, roomId } =
      await createPRDCommand.execute(input);

    let showCardCommand = new ShowCardCommand(this.commandContext);
    let ShowCardInput = await showCardCommand.getInputType();

    let showPRDCardInput = new ShowCardInput();
    showPRDCardInput.cardToShow = prdCard;
    await showCardCommand.execute(showPRDCardInput);

    let generateCodeCommand = new GenerateCodeCommand(this.commandContext);
    let generateCodeInput = new GenerateCodeInput({
      roomId,
      productRequirements: prdCard,
    });

    let { code, appName } = await generateCodeCommand.execute(
      generateCodeInput,
    );

    // Generate a unique name for the module using timestamp
    let timestamp = Date.now();
    let moduleName = `generated-apps/${timestamp}/${appName}`;
    let filePath = `${moduleName}.gts`;
    let moduleId = new URL(moduleName, input.realm).href;
    let writeFileCommand = new WriteTextFileCommand(this.commandContext);
    let writeFileInput = new (await writeFileCommand.getInputType())({
      path: filePath,
      content: code,
      realm: input.realm,
    });

    await writeFileCommand.execute(writeFileInput);

    // get the app card def from the module
    let loader = (import.meta as any).loader;
    let module = await loader.import(moduleId + '.gts');
    let MyAppCard = Object.values(module).find(
      (declaration) =>
        declaration &&
        typeof declaration === 'function' &&
        'isCardDef' in declaration &&
        AppCard.isPrototypeOf(declaration),
    ) as typeof AppCard;
    if (!MyAppCard) {
      throw new Error('App definition not found');
    }

    let myAppCard = new MyAppCard({
      moduleId: moduleId,
    });

    // save card
    let saveCardCommand = new SaveCardCommand(this.commandContext);
    let SaveCardInputType = await saveCardCommand.getInputType();

    let saveCardInput = new SaveCardInputType({
      realm: input.realm,
      card: myAppCard,
    });
    await saveCardCommand.execute(saveCardInput);

    // show the app card
    let showAppCardInput = new ShowCardInput();
    showAppCardInput.cardToShow = myAppCard;
    await showCardCommand.execute(showAppCardInput);

    return myAppCard;
  }

  async getInputType(): Promise<
    new (args: any) => CreateProductRequirementsInput
  > {
    return CreateProductRequirementsInput;
  }
}
