(() => {
  const fixedEpochMilliseconds = 1_777_344_000_000;
  const fixedPerformanceMilliseconds = 1_000;
  Date.now = () => fixedEpochMilliseconds;
  Object.defineProperty(Performance.prototype, "now", {
    configurable: true,
    value: () => fixedPerformanceMilliseconds,
  });
  Object.defineProperty(globalThis, "__issue24VisualClock", {
    configurable: false,
    value: Object.freeze({
      epochMilliseconds: fixedEpochMilliseconds,
      performanceMilliseconds: fixedPerformanceMilliseconds,
    }),
  });
})();
