// Your Workspaces leads with the most recently updated workspaces as tiles,
// enough to fill this many grid rows beside New Workspace. The rest follow
// as rows, this many grid rows of them until the user asks for the rest.
export const RECENT_WORKSPACE_ROWS = 3;
export const COLLAPSED_WORKSPACE_ROWS = 10;

// Fills the recent rows exactly, less the cell New Workspace takes; a dozen
// tiles until the grid has been measured.
export function recentWorkspaceCount(columns: number): number {
  return (columns ? columns * RECENT_WORKSPACE_ROWS : 13) - 1;
}

// Most recently updated first. Workspaces with no update time keep their list
// order, after the rest.
export function sortByUpdatedAtDesc<T extends string>(
  urls: T[],
  infoFor: (url: T) => { updatedAt?: string | null },
): T[] {
  let times = new Map(
    urls.map((url) => {
      let { updatedAt } = infoFor(url);
      let time = updatedAt ? new Date(updatedAt).getTime() : NaN;
      return [url, Number.isNaN(time) ? -Infinity : time];
    }),
  );
  return [...urls].sort((a, b) => {
    let aTime = times.get(a)!;
    let bTime = times.get(b)!;
    return aTime === bTime ? 0 : bTime > aTime ? 1 : -1;
  });
}

// The columns a grid lays out, as CSS resolved them.
export function gridColumnCount(grid: HTMLElement): number {
  let columns = getComputedStyle(grid).gridTemplateColumns;
  return columns && columns !== 'none' ? columns.split(' ').length : 0;
}
