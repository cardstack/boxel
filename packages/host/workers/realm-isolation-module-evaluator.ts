import type {
  ModuleEvaluator,
  ModuleRegistration,
} from '@cardstack/runtime-common';

export interface RealmSandboxCompartment {
  compartment: Compartment;
  moduleEvaluator: ModuleEvaluator;
}

export function createRealmSandboxCompartment(
  name: string,
  globals: Record<string, unknown>,
): RealmSandboxCompartment {
  let activeModule: string | undefined;
  let activeRegistration: ModuleRegistration | undefined;

  let define = harden(
    (_moduleId: string, dependencyList: string[], implementation: Function) => {
      if (!activeModule) {
        throw new Error('Module registration attempted outside evaluation');
      }
      if (activeRegistration) {
        throw new Error(`Module ${activeModule} registered more than once`);
      }
      if (
        !Array.isArray(dependencyList) ||
        dependencyList.some((dependency) => typeof dependency !== 'string') ||
        typeof implementation !== 'function'
      ) {
        throw new Error(`Module ${activeModule} registered an invalid shape`);
      }
      activeRegistration = harden({
        dependencyList: [...dependencyList],
        implementation,
      });
    },
  );
  let compartment = new Compartment({
    name,
    globals: {
      ...globals,
      define,
    } as unknown as Map<string, unknown>,
    __options__: true,
  });

  let moduleEvaluator: ModuleEvaluator = (source, moduleIdentifier) => {
    if (activeModule) {
      throw new Error(
        `Cannot evaluate ${moduleIdentifier} while ${activeModule} is registering`,
      );
    }
    activeModule = moduleIdentifier;
    activeRegistration = undefined;
    try {
      compartment.evaluate(source);
      if (!activeRegistration) {
        throw new Error(`Module ${moduleIdentifier} did not register itself`);
      }
      return activeRegistration;
    } finally {
      activeModule = undefined;
      activeRegistration = undefined;
    }
  };

  return harden({ compartment, moduleEvaluator });
}
