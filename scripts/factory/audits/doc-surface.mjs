// Audits user-facing docs against the live command/settings/error surface.
// Failing checks report file:line; unresolved bold tokens are reported only.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, evidenceDir } from "../checks/lib.mjs";

const LOCALE_FILES = ["execution.ts", "planner.ts", "review.ts", "shared.ts"];
const EN_DOCS = ["docs/user-guide.md", "docs/troubleshooting.md", "README.md"];
const ZH_DOCS = ["docs/user-guide.zh.md"];
const SETTINGS_DOC = "docs/reference/settings.md";
const NEGATION = /\b(not|never|no longer|won't|doesn't|does not|cannot)\b|不|并非|没有/;

// Quoted UI markers used by the zh handbook for prose emphasis as well as
// labels; anything not a real locale value is listed for review, not failed.
const findings = [];

function localeValues(locale) {
  const dir = path.join(REPO_ROOT, "src", "i18n", "locales", locale);
  const values = new Map();
  for (const file of LOCALE_FILES) {
    const text = readFileSync(path.join(dir, file), "utf8");
    for (const match of text.matchAll(/^\s*"([^"]+)":\s*"([^"]*)",?\s*$/gm)) {
      values.set(match[1], match[2]);
    }
  }
  return values;
}

function internalCodes() {
  const codes = new Set();
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith(".ts")) {
        for (const match of readFileSync(full, "utf8")
          .matchAll(/"([a-z][a-z0-9]*(?:-[a-z0-9]+){2,})"/g)) codes.add(match[1]);
      }
    }
  };
  scan(path.join(REPO_ROOT, "src"));
  return codes;
}

function push(file, line, check, detail, severity = "fail") {
  findings.push({ file, line, check, detail, severity });
}

function checkCommandTitles(file, text, titles, locale) {
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/`([^`]*Spiral Day:[^`]*)`/g)) {
      const title = match[1].trim();
      if (title === "Spiral Day:") continue; // prefix mention, not a title
      if (!titles.has(title)) {
        push(file, index + 1, "command-title",
          `backticked command/menu title "${title}" is not a live ${locale} command.* or menu.* message`);
      }
    }
  });
}

function checkNoMessageKeys(file, text) {
  text.split("\n").forEach((line, index) => {
    if (/`(command|settings|menu|error|notice|action)\.[a-zA-Z]+`/.test(line)) {
      push(file, index + 1, "message-key", "doc leaks a raw message key; docs must show rendered titles");
    }
  });
}

function checkCodeHygiene(file, text, codes) {
  // Negation is evaluated on the containing sentence: docs may name an internal
  // code only to state that it is not user-facing, and sentences wrap lines.
  const paragraphs = text.split(/\n\n+/);
  let lineCursor = 0;
  for (const paragraph of paragraphs) {
    const start = lineCursor;
    lineCursor += paragraph.split("\n").length + 1;
    const sentences = paragraph.replace(/\n/g, " ").split(/(?<=[.。?!！？])\s+/);
    for (const sentence of sentences) {
      for (const match of sentence.matchAll(/`([^`\s]+)`/g)) {
        if (codes.has(match[1]) && !NEGATION.test(sentence)) {
          push(file, start + 1, "internal-code",
            `internal code "${match[1]}" presented without a not-user-facing qualifier`);
        }
      }
    }
  }
}

function reportUnresolvedBolds(file, text, values) {
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/\*\*([^*]{2,})\*\*/g)) {
      const token = match[1].trim();
      if (!values.has(token) && token.length <= 40) {
        push(file, index + 1, "bold-review", `unresolved bold token "${token}"`, "review");
      }
    }
  });
}

function checkSettingsTable(file, text, labels) {
  const rows = text.split("\n")
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /^\|[^-]/.test(line))
    .map(({ line, index }) => ({ cell: line.split("|")[1]?.trim(), index }))
    .filter(({ cell }) => cell && cell !== "Setting" && !/^-+$/.test(cell));
  const documented = new Set(rows.map(({ cell }) => cell));
  for (const label of labels) {
    if (!documented.has(label)) {
      push(file, 0, "settings-label", `settings label "${label}" missing from the reference table`);
    }
  }
  for (const { cell, index } of rows) {
    if (!labels.has(cell)) {
      push(file, index, "settings-label", `table row "${cell}" is not a live en settings.* display name`);
    }
  }
}

function checkZhUiTokens(file, text, zhValues) {
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/「([^」]{1,30})」/g)) {
      if (!zhValues.has(match[1])) {
        push(file, index + 1, "zh-ui-token",
          `「${match[1]}」 is not a live zh-CN UI string`, "review");
      }
    }
  });
}

const en = localeValues("en");
const zh = localeValues("zh-CN");
const EN_TITLES = new Map([...en].filter(([key]) => /^(command|menu)\./.test(key)));
const ZH_TITLES = new Map([...zh].filter(([key]) => /^(command|menu)\./.test(key)));
const enSettingLabels = new Map([...en].filter(([key]) =>
  /^settings\.[a-zA-Z]+$/.test(key) && !/(Desc|Rejected|HostIgnored|onboarding)/.test(key) && key !== "settings.title"));
const enValues = new Set(en.values());
const zhValues = new Set(zh.values());
const codes = internalCodes();

for (const file of EN_DOCS) {
  const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
  checkCommandTitles(file, text, new Set(EN_TITLES.values()), "en");
  checkNoMessageKeys(file, text);
  checkCodeHygiene(file, text, codes);
  reportUnresolvedBolds(file, text, enValues);
}
for (const file of ZH_DOCS) {
  const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
  checkCommandTitles(file, text, new Set(ZH_TITLES.values()), "zh-CN");
  checkNoMessageKeys(file, text);
  checkCodeHygiene(file, text, codes);
  checkZhUiTokens(file, text, zhValues);
  reportUnresolvedBolds(file, text, zhValues);
}
{
  const text = readFileSync(path.join(REPO_ROOT, SETTINGS_DOC), "utf8");
  checkSettingsTable(SETTINGS_DOC, text, new Set(enSettingLabels.values()));
  checkNoMessageKeys(SETTINGS_DOC, text);
  checkCodeHygiene(SETTINGS_DOC, text, codes);
}

const failures = findings.filter((item) => item.severity === "fail");
const reviews = findings.filter((item) => item.severity === "review");
const out = evidenceDir("doc-surface");
const report = path.join(out, "report.json");
mkdirSync(out, { recursive: true });
writeFileSync(report, JSON.stringify({
  checked: [...EN_DOCS, ...ZH_DOCS, SETTINGS_DOC],
  surface: {
    enTitles: EN_TITLES.size, zhTitles: ZH_TITLES.size,
    enSettings: enSettingLabels.size, internalCodes: codes.size,
  },
  failures, reviews,
}, null, 2));

for (const item of failures) console.log(`FAIL ${item.file}:${item.line} [${item.check}] ${item.detail}`);
if (reviews.length) {
  console.log(`review-only tokens (${reviews.length}) -> ${report}`);
  for (const item of reviews.slice(0, 10)) console.log(`  ${item.file}:${item.line} "${item.detail.match(/"([^"]*)"/)?.[1]}"`);
}
assert.equal(failures.length, 0, `${failures.length} doc-surface drift item(s); see ${report}`);
console.log(`doc-surface audit: PASS (${EN_TITLES.size} en titles, ${ZH_TITLES.size} zh titles, ${enSettingLabels.size} settings labels, ${codes.size} internal codes)`);
