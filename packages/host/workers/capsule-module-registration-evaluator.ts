import type {
  ModuleEvaluator,
  ModuleRegistration,
} from '@cardstack/runtime-common';

export interface CapsuleCompartment {
  compartment: Compartment;
  moduleEvaluator: ModuleEvaluator;
}

function escapeHtmlCommentTokensForSES(source: string): string {
  // SES conservatively rejects the raw HTML-comment tokens anywhere in a
  // script, including inside the serialized Glimmer template block emitted by
  // Boxel's trusted transpiler. Escape one character in each token so normal
  // JS strings, template strings, and regular expressions evaluate to the
  // original value while SES never sees the ambiguous Annex B spelling. If a
  // token somehow occurs as executable JS rather than generated literal data
  // or a comment, the inserted hex escape is invalid in that position and the
  // compartment still fails closed with a syntax error.
  return source.split('<!--').join('<\\x21--').split('-->').join('--\\x3e');
}

export function createCapsuleCompartment(
  name: string,
  globals: Record<string, unknown>,
): CapsuleCompartment {
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
      compartment.evaluate(escapeHtmlCommentTokensForSES(source));
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
