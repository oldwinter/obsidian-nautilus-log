# Packet 03-verification: Accessibility and verification audit

Packet ID: 03-verification
Objective: Identify accessibility, responsive, localization, state-coverage, and visual-test risks the implementation and final QA must address.
Context: Existing plugin has focused UI runners, visual harnesses, high-contrast/forced-color CSS, reduced-motion behavior, and fixed responsive thresholds.
Files / sources:
- `styles/a11y.css`, `styles/{planner,execution,theme}.css`
- `src/i18n/**`, `src/ui/**`
- `tests/ui/**`, `package.json`
- parity and visual-interaction decision docs
Ownership: Production code is read-only. Write only `results/03-verification.md`.
Assignee: subagent-verification-audit

## Do

- Map must-preserve contracts and the smallest reliable verification command set.
- Find concrete gaps in focus, touch size, zoom/text-fit, locale expansion, reduced motion, forced colors, and state coverage.
- Recommend new/updated assertions only where they reduce a real regression risk.

## Do Not

- Revert unrelated edits.
- Expand scope beyond this packet.
- Perform risky external or destructive actions without approval.
- Edit production files, tests, screenshots, or any workflow result except the owned result.

## Expected Output

- `results/03-verification.md` with Accepted, Rejected, Decisions, Risks, and Verification sections.

## Verification

- Cite existing tests/contracts and exact commands.

## Stop Condition

- Stop after the result file is written. Do not run destructive or external checks.
