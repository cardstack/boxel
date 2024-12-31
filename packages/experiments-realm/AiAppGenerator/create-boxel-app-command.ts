import { CardDef } from 'https://cardstack.com/base/card-api';
import { Command } from '@cardstack/runtime-common';
import CreateProductRequirementsInstance, {
  CreateProductRequirementsInput,
} from './create-product-requirements-command';
import ShowCardCommand from '@cardstack/boxel-host/commands/show-card';
import WriteTextFileCommand from '@cardstack/boxel-host/commands/write-text-file';
import GenerateCodeCommand from './generate-code-command';
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
    await showCardCommand.execute({ cardToShow: prdCard });

    let generateCodeCommand = new GenerateCodeCommand(this.commandContext);
    let { code, appName } = await generateCodeCommand.execute({
      roomId,
      productRequirements: prdCard,
    });

    // Generate a unique name for the module using timestamp
    let timestamp = Date.now();
    let moduleName = `generated-apps/${timestamp}/${appName}`;
    let filePath = `${moduleName}.gts`;
    let moduleId = new URL(moduleName, input.realm).href;
    let writeFileCommand = new WriteTextFileCommand(this.commandContext);
    await writeFileCommand.execute({
      path: filePath,
      content: code,
      realm: input.realm,
    });

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
    await saveCardCommand.execute({
      realm: input.realm,
      card: myAppCard,
    });

    // show the app card
    await showCardCommand.execute({ cardToShow: myAppCard });

    return myAppCard;
  }

  async getInputType(): Promise<
    new (args: any) => CreateProductRequirementsInput
  > {
    return CreateProductRequirementsInput;
  }
}
