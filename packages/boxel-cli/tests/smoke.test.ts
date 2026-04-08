import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const cliEntry = resolve(__dirname, '../dist/index.js');

describe('boxel-cli', () => {
  it('prints help output', () => {
    const output = execFileSync(process.execPath, [cliEntry, '--help'], {
      encoding: 'utf8',
    });
    expect(output).toMatch(/Usage:/);
    expect(output).toMatch(/Options:/);
  });

  it('prints version', () => {
    const output = execFileSync(process.execPath, [cliEntry, '--version'], {
      encoding: 'utf8',
    });
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
