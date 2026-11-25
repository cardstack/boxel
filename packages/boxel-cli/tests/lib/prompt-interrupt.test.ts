import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { interruptCommand } from '../../src/lib/prompt.ts';

describe('Ctrl+C at a prompt', () => {
  let saved: NodeJS.SignalsListener[];

  beforeEach(() => {
    saved = process.listeners('SIGINT') as NodeJS.SignalsListener[];
    process.removeAllListeners('SIGINT');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.removeAllListeners('SIGINT');
    for (let listener of saved) {
      process.on('SIGINT', listener);
    }
  });

  it("hands the interrupt to the command's SIGINT handlers, which do their cleanup", () => {
    let exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    let cleanup = vi.fn();
    process.on('SIGINT', cleanup);

    interruptCommand();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits as an interrupted command when nothing is listening', () => {
    let exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    interruptCommand();

    expect(exit).toHaveBeenCalledWith(130);
  });
});
