import { performance, PerformanceObserver } from "node:perf_hooks";

export function historyDiagnostics() {
  const origin = performance.now();
  const gc = [];
  const schedulerSlices = [];
  const eventLoopGaps = [];
  const collect = (entries) => gc.push(...entries.map((entry) => ({
    startMs: entry.startTime - origin, durationMs: entry.duration,
    kind: entry.detail.kind, flags: entry.detail.flags,
  })));
  const observer = new PerformanceObserver((list) => collect(list.getEntries()));
  observer.observe({ entryTypes: ["gc"] });
  function mark(wallTime = performance.now()) {
    return { wallTime, thread: process.threadCpuUsage(), process: process.cpuUsage() };
  }
  function record(target, index, start, end) {
    const durationMs = end.wallTime - start.wallTime;
    if (durationMs <= 50) return;
    const cpu = (scope) => {
      const userMs = (end[scope].user - start[scope].user) / 1000;
      const systemMs = (end[scope].system - start[scope].system) / 1000;
      return { userMs, systemMs, totalMs: userMs + systemMs };
    };
    const threadCpu = cpu("thread");
    target.push({ index, startMs: start.wallTime - origin, durationMs,
      threadCpu, processCpu: cpu("process"), wallMinusThreadCpuMs: durationMs - threadCpu.totalMs });
  }
  return {
    mark,
    schedulerSlice: (index, start, end) => record(schedulerSlices, index, start, end),
    eventLoopGap: (index, start, end) => record(eventLoopGaps, index, start, end),
    async finish() {
      await new Promise((resolve) => setImmediate(resolve));
      collect(observer.takeRecords());
      observer.disconnect();
      for (const interval of [...schedulerSlices, ...eventLoopGaps]) {
        interval.gcEntryIndexes = gc.flatMap((entry, index) => entry.startMs < interval.startMs + interval.durationMs
          && entry.startMs + entry.durationMs > interval.startMs ? [index] : []);
      }
      return { schedulerSlices, eventLoopGaps, gc };
    },
    dispose: () => observer.disconnect(),
  };
}
