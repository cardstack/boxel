// Disable ANSI escapes when stdout isn't a TTY (piped to file/pager) or
// NO_COLOR is set — see https://no-color.org. Evaluated at module load.
const COLOR_ENABLED = process.stdout.isTTY === true && !process.env.NO_COLOR;

const c = (code: string): string => (COLOR_ENABLED ? code : '');

export const FG_GREEN = c('\x1b[32m');
export const FG_YELLOW = c('\x1b[33m');
export const FG_CYAN = c('\x1b[36m');
export const FG_MAGENTA = c('\x1b[35m');
export const FG_RED = c('\x1b[31m');
export const DIM = c('\x1b[2m');
export const BOLD = c('\x1b[1m');
export const RESET = c('\x1b[0m');
