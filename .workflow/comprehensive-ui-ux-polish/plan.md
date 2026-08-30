# Comprehensive Spiral Day UI and UX polish

## Goal

Raise every current Spiral Day UI surface to a cohesive, polished Obsidian-native
experience without changing scheduling, execution, write-safety, or navigation
semantics.

## Success Criteria

- Planner hierarchy is immediately scannable in wide, compact, light, and dark contexts.
- Execution popover and active-task view communicate current state, grouping, and actions clearly.
- Loading, missing, stale, over-limit, error, empty, pending, warning, and unavailable states are visually intentional.
- Keyboard focus, target sizing, contrast, reduced motion, forced colors, localization expansion, and 200% zoom remain supported.
- The 519/520/521 px layout boundary, dockable sizing, interaction semantics, and Obsidian host-token integration remain intact.
- Focused UI suites, repository verification, build, mechanical design detector, and bounded rendered QA pass.
- Any unavailable real-Obsidian or VoiceOver proof is reported separately from automated harness evidence.

## Current Context

- Baseline is clean `main` at `4faaae0`, aligned with `origin/main` when inspected.
- Incumbent UI authority is `styles/{theme,planner,execution,a11y}.css` and `src/ui/{planner,execution}`.
- Visual harnesses already cover planner and execution surfaces; planner-controls owns a pinned golden matrix.
- Prior closeout evidence says real Obsidian plus VoiceOver acceptance was incomplete because native Computer Use failed.

## Constraints

- Preserve product behavior, copy meaning, information architecture, native affordances, and host adapters.
- No dependency upgrades, release/publish actions, remote mutations, core scheduling changes, or vault writes.
- Use Obsidian semantic tokens and existing icon renderer; avoid a detached visual world or custom asset dependency.
- Keep edits concentrated in UI styles/components/tests plus this workflow evidence.

## Risks

- CSS changes can invalidate tightly specified responsive and golden contracts.
- Broad visual polish can accidentally reduce contrast or hide affordances in one theme.
- Execution controls carry write actions, so visual regrouping must not change DOM action semantics.
- Harness rendering is necessary but does not prove native Obsidian or screen-reader integration.

## Approval Required

No additional approval is required for local, non-destructive UI and test edits. Stop for any dependency upgrade, external publish, destructive operation, real-vault mutation, or change outside this workspace.

## Work Packets

1. `01-discovery`: planner surface UX, responsive, and visual-system audit. Read-only production scope.
2. `02-execution`: execution popover and active-task UX/state audit. Read-only production scope.
3. `03-verification`: accessibility, test-harness, and regression-risk audit. Read-only production scope.

The parent owns all production edits and integration so packet observations cannot conflict at file level.

## Integration Policy

- Accept findings supported by current code, rendered evidence, or explicit parity requirements.
- Reject proposals that alter core behavior, copy meaning, layout thresholds, or Obsidian-native conventions.
- Resolve conflicts by prioritizing task completion, accessibility, semantic host tokens, and responsive stability.

## Verification

- Narrow UI runners first, then `npm run verify` and `npm run build`.
- Run the Impeccable detector once after UI edits.
- Run one batched visual inspection across planner/execution, desktop/narrow, and light/dark; fix in one batch, then confirm once.
- Validate this workflow with `verify_workflow.py --require-all-results`.

## Reusable Artifacts

This workflow run itself is retained as the decision/evidence record. No new reusable recipe unless the integration reveals a repeatable project-specific UI audit pattern.
