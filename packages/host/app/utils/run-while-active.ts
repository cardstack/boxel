interface CleanupRegistrar {
  cleanup(callback: () => void): void;
}

export function runWhileActive(
  on: CleanupRegistrar,
  task: (isActive: () => boolean) => Promise<void>,
): void {
  let active = true;
  on.cleanup(() => {
    active = false;
  });
  void task(() => active);
}
