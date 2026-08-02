import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadBxlModule() {
  if (process.env.BXL_API) {
    return import(pathToFileURL(resolve(process.env.BXL_API)).href);
  }

  return import('../vendor/bxl-runtime-bare.js');
}

export class BxlAdapter {
  constructor(evaluate) {
    if (typeof evaluate !== 'function') {
      throw new TypeError('BXL evaluator is required');
    }
    this.evaluateFn = evaluate;
  }

  static async create() {
    let bxl = await loadBxlModule();
    return new BxlAdapter(bxl.evaluateBxlBare);
  }

  evaluate(expression, input, options = {}) {
    let readableSyntax;
    if (options.syntax === 'jq') {
      readableSyntax = false;
    } else if (options.syntax === 'readable') {
      readableSyntax = true;
    }
    return this.evaluateFn(expression, input, {
      readableSyntax,
      runtimeLimits: {
        maxSteps: 250_000,
        maxOutputs: 1_000,
        maxOutputBytes: 1 * 1024 * 1024,
        maxMillis: 2_000,
      },
    });
  }
}
