# Feature map — Spiral Day

One file per user-facing feature. Each file answers: what it is, how a user
reaches it, how the harness drives it, and what observable end state proves it.
A feature with no drive recipe is a gap, not a pass.

| Feature | Surface | Primary proof |
| --- | --- | --- |
| [planner](planner.md) | Planner view (ribbon **Open Spiral Day**) | host lane `probe` / `full` — `planner-*` assertions |
| [execution-timing](execution-timing.md) | Execution panel → **Timing** | host lane `full` — `lifecycle-*`, `clock-*` |
| [plan-tab](plan-tab.md) | Execution panel → **Plan** | host lane `full` — `clock-*`, `execution-source-navigation` |
| [review](review.md) | Execution panel → **Review** | host lane `review` — Review matrix assertions |
| [settings-and-commands](settings-and-commands.md) | Settings → Spiral Day, command palette, editor menu | `npm run verify` focused suites |

Read `../SKILL.md` first for the launch and doctor steps; every recipe below
assumes the plugin bundle was built with `mise exec node@24.20.0 -- npm run build`
and that `.claude/skills/verify/scripts/host-lane.sh` reported `ok` on all four
doctor lines.

The host runner's fixture is `tests/host-matrix/fixture.mjs`: three generated
Daily Notes around the runner's local date, four tasks per note, one closed
12-minute CLOCK in the prior-day note, and tasks named `Host fixture Alpha`,
`Host fixture Beta`, `Host fixture Review today`. Selectors in the recipes quote
that fixture.
