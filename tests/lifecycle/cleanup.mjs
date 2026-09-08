async function settleWithin(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation).then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function finalizeOwnedHost({ beforeClose, browser, child, childExited, exitPromise, deadline,
  browserTimeout = 2000, terminateTimeout = 5000, killTimeout = 5000 }) {
  const errors = [];
  try {
    await beforeClose();
  } catch (error) { errors.push({ phase: "before-host-cleanup", error }); }
  finally {
    try {
      if (browser && !await settleWithin(() => browser.close(), browserTimeout)) {
        throw new Error("Browser close exceeded its cleanup deadline");
      }
    } catch (error) { errors.push({ phase: "browser-close", error }); }
    finally {
      try {
        if (child && !childExited()) {
          try { child.kill("SIGTERM"); }
          catch (error) { errors.push({ phase: "child-sigterm", error }); }
          await settleWithin(() => exitPromise, terminateTimeout);
          if (!childExited()) {
            try { child.kill("SIGKILL"); }
            catch (error) { errors.push({ phase: "child-sigkill", error }); }
            await settleWithin(() => exitPromise, killTimeout);
            if (!childExited()) throw new Error("Owned child exit was not observed after SIGKILL");
          }
        }
      } catch (error) { errors.push({ phase: "owned-child-cleanup", error }); }
      finally { clearTimeout(deadline); }
    }
  }
  return errors;
}
