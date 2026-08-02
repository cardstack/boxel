import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { RealmRunnerError } from './errors.js';

async function loadBxlModule() {
  if (process.env.BXL_API) {
    return import(pathToFileURL(resolve(process.env.BXL_API)).href);
  }

  try {
    return await import('@cardstack/bxl/runtime-bare');
  } catch (packageError) {
    let here = dirname(fileURLToPath(import.meta.url));
    let adjacent = resolve(here, '../../bxl/dist/runtime-bare.js');
    try {
      await access(adjacent);
      return await import(pathToFileURL(adjacent).href);
    } catch {
      throw new RealmRunnerError(
        'BXL_NOT_FOUND',
        'Could not load @cardstack/bxl/runtime-bare. Build an adjacent BXL checkout or set BXL_API to dist/runtime-bare.js.',
        {
          cause:
            packageError instanceof Error
              ? packageError.message
              : String(packageError),
        },
      );
    }
  }
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
