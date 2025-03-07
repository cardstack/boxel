export function suspendGlobalErrorHook(hooks: NestedHooks) {
  let tmp: any;
  let capturedExceptions: any[] = [];
  hooks.before(() => {
    tmp = QUnit.onUncaughtException;
    QUnit.onUncaughtException = (err) => {
      capturedExceptions.push(err);
    };
  });

  hooks.after(() => {
    QUnit.onUncaughtException = tmp;
    capturedExceptions = [];
  });
  return { capturedExceptions };
}
