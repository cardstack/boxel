import { service } from '@ember/service';

import {
  loadCardDef,
  specRef,
  type ResolvedCodeRef,
  isCardDef,
  isFieldDef,
  type Query,
  type Loader,
  getAncestor,
} from '@cardstack/runtime-common';

import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import type { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { Spec } from 'https://cardstack.com/base/spec';
import type { SpecType } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';
import {
  type CardOrFieldDeclaration,
  type ModuleDeclaration,
  isCardOrFieldDeclaration,
  isReexportCardOrField,
} from '../services/module-contents-service';

import GenerateReadmeSpecCommand from './generate-readme-spec';

import type CardService from '../services/card-service';
import type ModuleContentsService from '../services/module-contents-service';
import type StoreService from '../services/store';

class SpecTypeGuesser {
  constructor(private declaration: ModuleDeclaration) {}

  get type(): SpecType | undefined {
    return this.guess(this.declaration);
  }

  private guess(declaration: ModuleDeclaration): SpecType | undefined {
    // Check if it's a card or field declaration
    if (isCardOrFieldDeclaration(declaration)) {
      // Check if it's a field definition
      if (isFieldDef(declaration.cardOrField)) {
        return 'field';
      }

      // Check if it's a card definition
      if (isCardDef(declaration.cardOrField)) {
        if (this.isApp(declaration)) {
          return 'app';
        }
        return 'card';
      }
    }

    // Check if it's a component
    if (this.isComponent(declaration)) {
      return 'component';
    }

    // Check if it's a command
    if (this.isCommand(declaration)) {
      return 'command';
    }

    return;
  }

  private isApp(declaration: CardOrFieldDeclaration): boolean {
    if (declaration.exportName === 'AppCard') {
      return true;
    }
    if (declaration.super) {
      return (
        declaration.super.type === 'external' &&
        declaration.super.name === 'AppCard'
      );
    }
    return false;
  }

  private isComponent(declaration: ModuleDeclaration): boolean {
    if (
      !('super' in declaration) ||
      !declaration.super ||
      declaration.super.type !== 'external'
    ) {
      return false;
    }
    const superName = declaration.super.name;
    const superModule = declaration.super.module;
    return (
      superModule === '@glimmer/component' ||
      (superName === 'Component' &&
        superModule === 'https://cardstack.com/base/card-api') ||
      superName === 'GlimmerComponent' ||
      superName?.includes('Component')
    );
  }

  private isCommand(declaration: ModuleDeclaration): boolean {
    if (
      !('super' in declaration) ||
      !declaration.super ||
      declaration.super.type !== 'external'
    ) {
      return false;
    }
    const superName = declaration.super.name;
    return (
      superName === 'Command' ||
      superName === 'HostBaseCommand' ||
      superName?.includes('Command')
    );
  }
}
interface CreateSpecResult {
  spec: Spec;
  new: boolean;
}

export default class CreateSpecCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateSpecsInput,
  typeof BaseCommandModule.CreateSpecsResult
> {
  @service declare private store: StoreService;
  @service declare private cardService: CardService;
  @service declare private moduleContentsService: ModuleContentsService;

  static actionVerb = 'Create';
  requireInputFields = ['targetRealm'];

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateSpecsInput } = commandModule;
    return CreateSpecsInput;
  }

  private async createSpec(
    declaration: ModuleDeclaration,
    codeRef: ResolvedCodeRef,
    targetRealm: string,
    SpecKlass: typeof BaseDef,
    createIfExists: boolean = false,
    autoGenerateReadme: boolean = false,
  ): Promise<CreateSpecResult> {
    const title = this.getSpecTitle(declaration, codeRef.name);
    const specType = new SpecTypeGuesser(declaration).type;

    const specClassToUse = await getSpecClassFromDeclaration(
      codeRef,
      SpecKlass,
      this.loaderService.loader,
    );
    let createdSpecRes: CreateSpecResult;
    if (!createIfExists) {
      // Check if a spec already exists for this code ref
      const existingSpecsQuery: Query = {
        filter: {
          on: specRef,
          eq: {
            ref: codeRef,
          },
        },
      };

      const existingSpecs = await this.store.search(
        existingSpecsQuery,
        new URL(targetRealm),
      );
      if (existingSpecs.length > 0) {
        console.warn(`Spec already exists for ${title}, skipping`);
        let savedSpec = existingSpecs[0] as Spec;
        createdSpecRes = { spec: savedSpec, new: false };
      } else {
        let spec = new specClassToUse({
          specType,
          ref: codeRef,
          title,
        }) as Spec;
        let savedSpec = (await this.store.add<Spec>(spec, {
          realm: targetRealm,
        })) as Spec;
        createdSpecRes = { spec: savedSpec, new: true };
      }
    } else {
      let spec = new specClassToUse({
        specType,
        ref: codeRef,
        title,
      }) as Spec;

      let savedSpec = (await this.store.add<Spec>(spec, {
        realm: targetRealm,
      })) as Spec;
      createdSpecRes = { spec: savedSpec, new: true };
    }

    if (!createdSpecRes.spec) {
      throw new Error('Failed to create or retrieve spec');
    }

    if (autoGenerateReadme && !createdSpecRes.spec.readMe) {
      // we populate the readme when is not already set even when spec is already created
      let generateReadmeSpecCommand = new GenerateReadmeSpecCommand(
        this.commandContext,
      );
      await generateReadmeSpecCommand.execute({
        spec: createdSpecRes.spec,
      });
    }

    return createdSpecRes;
  }

  private getSpecTitle(
    declaration: ModuleDeclaration,
    fallbackName: string,
  ): string {
    if (
      isCardOrFieldDeclaration(declaration) ||
      isReexportCardOrField(declaration)
    ) {
      return declaration.cardOrField.displayName ?? fallbackName;
    }

    return fallbackName;
  }

  protected async run(
    input: BaseCommandModule.CreateSpecsInput,
  ): Promise<BaseCommandModule.CreateSpecsResult> {
    let { codeRef, targetRealm, module, autoGenerateReadme } = input;

    if (!targetRealm) {
      throw new Error('targetRealm is required');
    }

    let url: string;
    if (codeRef) {
      let relativeTo = new URL(codeRef.module);
      let maybeAbsoluteRef = codeRefWithAbsoluteURL(codeRef, relativeTo);
      if (isResolvedCodeRef(maybeAbsoluteRef)) {
        codeRef = maybeAbsoluteRef;
      }
      url = codeRef.module;
    } else if (module) {
      url = module;
    } else {
      throw new Error('Either codeRef or module must be provided');
    }

    let declarations = await this.moduleContentsService.assemble(url);
    let SpecKlass = await loadCardDef(specRef, {
      loader: this.loaderService.loader,
    });

    let specs: Spec[] = [];
    let newSpecs: Spec[] = [];

    if (codeRef?.name) {
      // Single spec generation when codeRef.name is provided
      const declaration = declarations.find(
        (decl) =>
          decl.exportName === codeRef.name || decl.localName === codeRef.name,
      );

      if (!declaration) {
        throw new Error(
          `Could not find declaration for ${codeRef.name} in ${codeRef.module}`,
        );
      }

      const savedSpec = await this.createSpec(
        declaration,
        codeRef,
        targetRealm,
        SpecKlass,
        false,
        autoGenerateReadme ?? false,
      );

      if (savedSpec.new) {
        newSpecs.push(savedSpec.spec);
      }
      specs.push(savedSpec.spec);
    } else {
      // Multiple specs generation when codeRef.name is not provided
      const specPromises = declarations.map(async (declaration) => {
        let name = declaration.exportName || declaration.localName;
        if (!name) {
          throw new Error('declaration no name');
        }
        let specCodeRef: ResolvedCodeRef = {
          module: url.replace('.gts', ''), // Remember to remove .gts extension
          name,
        };

        try {
          return await this.createSpec(
            declaration,
            specCodeRef,
            targetRealm,
            SpecKlass,
            false,
            false,
            // intentionally not generating readme for multiple spec creation
          );
        } catch (e) {
          console.warn(
            `Failed to create spec for ${declaration.exportName || declaration.localName}:`,
            e,
          );
          return null;
        }
      });

      const promises = await Promise.all(specPromises);
      const successfulPromises = promises.filter(
        (p): p is CreateSpecResult => p !== null,
      );
      newSpecs.push(
        ...successfulPromises.filter((r) => r?.new).map((r) => r.spec),
      );
      specs.push(...successfulPromises.map((r) => r.spec));
    }

    try {
      let commandModule = await this.loadCommandModule();
      const { CreateSpecsResult } = commandModule;
      return new CreateSpecsResult({
        newSpecs,
        specs,
      });
    } catch (e) {
      console.error('Error creating specs:', e);
      throw e;
    }
  }
}

/**
 * Finds the appropriate Spec class to use when creating a spec instance.
 *
 * @param codeRef - Code reference of the code being documented (used for naming convention)
 * @param fallbackSpecClass - Base Spec class to use if no subclass found
 * @param loader - Module loader for dynamically loading Spec subclasses
 * @returns Spec subclass if found, otherwise fallback base Spec
 */
async function getSpecClassFromDeclaration(
  codeRef: ResolvedCodeRef,
  fallbackSpecClass: typeof BaseDef,
  loader: Loader,
): Promise<typeof BaseDef> {
  try {
    const specCodeRef: ResolvedCodeRef = {
      module: codeRef.module,
      name: codeRef.name,
    };
    const loadedSpec = await loadCardDef(specCodeRef, {
      loader,
      relativeTo: new URL(codeRef.module),
    });

    if (
      loadedSpec &&
      loadedSpec !== fallbackSpecClass &&
      isSpecSubclass(loadedSpec, fallbackSpecClass)
    ) {
      return loadedSpec;
    }
  } catch {
    // Spec subclass doesn't exist; fall back to base Spec
  }

  return fallbackSpecClass;
}

/**
 * Checks if candidate class extends ancestor class via prototype chain.
 */
function isSpecSubclass(
  candidate: typeof BaseDef,
  ancestor: typeof BaseDef,
): boolean {
  let current: typeof BaseDef | undefined = candidate;
  while (current) {
    const parent = getAncestor(current);
    if (parent === ancestor) {
      return true;
    }
    current = parent;
  }
  return false;
}
