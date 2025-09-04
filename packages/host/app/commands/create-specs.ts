import { service } from '@ember/service';

import {
  loadCardDef,
  specRef,
  type ResolvedCodeRef,
  isCardDef,
  isFieldDef,
  type Query,
} from '@cardstack/runtime-common';

import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';
import {
  type CardOrFieldDeclaration,
  type ModuleDeclaration,
  isCardOrFieldDeclaration,
} from '../services/module-contents-service';

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
  ): Promise<Spec | null> {
    const title = codeRef.name;
    const specType = new SpecTypeGuesser(declaration).type;

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
        return null;
      }
    }

    let spec = new SpecKlass({
      specType,
      ref: codeRef,
      title,
    }) as Spec;

    let savedSpec = (await this.store.add<Spec>(spec, {
      realm: targetRealm,
    })) as Spec;

    return savedSpec;
  }

  protected async run(
    input: BaseCommandModule.CreateSpecsInput,
  ): Promise<BaseCommandModule.CreateSpecsResult> {
    let { codeRef, targetRealm, module } = input;

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
      );

      if (savedSpec) {
        specs.push(savedSpec);
      }
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
          );
        } catch (e) {
          console.warn(
            `Failed to create spec for ${declaration.exportName || declaration.localName}:`,
            e,
          );
          return null;
        }
      });

      const promiseResults = await Promise.all(specPromises);
      const createdSpecs: Spec[] = promiseResults.filter(
        (spec): spec is Spec => spec !== null,
      );

      specs.push(...createdSpecs);
    }

    try {
      let commandModule = await this.loadCommandModule();
      const { CreateSpecsResult } = commandModule;
      return new CreateSpecsResult({
        specs,
      });
    } catch (e) {
      console.error('Error creating specs:', e);
      throw e;
    }
  }
}
