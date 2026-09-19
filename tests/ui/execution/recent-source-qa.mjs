// Start serve-visual-harness.mjs first; this optional browser check uses agent-browser.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const session = `recent-source-${process.pid}`;
const url = process.argv[2] ?? "http://127.0.0.1:43127";
const browser = (...args) => {
  const result = JSON.parse(execFileSync("agent-browser", ["--session", session, "--json", ...args], {
    encoding: "utf8",
  }));
  assert.equal(result.success, true, JSON.stringify(result.error));
  return result.data;
};
const evaluate = (code) => browser("eval", code).result;
const row = (number) => `.spiral-day-execution__recent li:nth-child(${number}) button`;
const inspectRows = () => evaluate(`Array.from(document.querySelectorAll('.spiral-day-execution__recent li')).map(row => {
  const button = row.querySelector('button');
  const source = button.querySelector('.spiral-day-execution__recent-source');
  const meta = row.querySelector('.spiral-day-execution__row-meta');
  return {
    path: source.textContent,
    name: button.getAttribute('aria-label'),
    display: getComputedStyle(source).display,
    wraps: button.scrollWidth <= button.clientWidth + 1,
    overlaps: button.getBoundingClientRect().right > meta.getBoundingClientRect().left,
    children: source.children.length,
  };
})`);

try {
  browser("set", "viewport", "1280", "800");
  browser("open", url);
  browser("wait", "--fn", "Boolean(window.executionHarness)");
  const english = inspectRows();
  assert.equal(english.length, 3);
  assert.deepEqual(english.slice(0, 2).map(({ path }) => path), ["Daily/2026-08-29.md", "Projects/Release.md"]);
  for (const result of english) {
    assert.ok(result.name.endsWith(` · ${result.path}`));
    assert.equal(result.display, "block");
    assert.equal(result.wraps, true);
    assert.equal(result.overlaps, false);
  }
  assert.ok(english[2].path.endsWith("/<release>&验收.md"));
  assert.equal(english[2].children, 0, "A source path must be text, not HTML");

  browser("click", row(1));
  browser("focus", row(2));
  browser("press", "Shift+Enter");
  browser("focus", row(3));
  browser("press", "Space");
  const navigation = evaluate("window.executionHarness.inspect().recentNavigation");
  assert.deepEqual(navigation.map(({ path, sourceOrder, location }) => ({ path, sourceOrder, location })), [
    { path: english[0].path, sourceOrder: 2, location: "main" },
    { path: english[1].path, sourceOrder: 4, location: "sidebar" },
    { path: english[2].path, sourceOrder: 6, location: "main" },
  ]);
  assert.equal(new Set(navigation.map(({ ownerId }) => ownerId)).size, 3);

  browser("click", "#locale");
  browser("click", "#theme");
  browser("set", "viewport", "320", "800");
  browser("click", "#execution-trigger");
  assert.equal(evaluate("document.querySelector('.spiral-day-execution__recent h3').textContent"), "最近");
  const chinese = inspectRows();
  assert.deepEqual(chinese, english);
  assert.equal(evaluate("window.executionHarness.inspect().horizontalOverflow"), false);
  browser("focus", row(2));
  browser("press", "Enter");
  assert.equal(evaluate("window.executionHarness.inspect().recentNavigation.at(-1).path"), english[1].path);
  browser("press", "Escape");
  browser("click", "#execution-trigger");
  assert.deepEqual(inspectRows(), chinese, "Reopening retains source context");
  const errors = browser("errors");
  assert.deepEqual(errors.errors, []);
  console.log(JSON.stringify({ passed: true, english, chinese, navigation, errors }, null, 2));
} finally {
  browser("close");
}
