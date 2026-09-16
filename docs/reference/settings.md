# Settings reference

Open **Settings → Spiral Day**. Settings are stored in the plugin data document
(schema version 1). Missing, invalid, or unsupported saved values are repaired
to defaults; unknown fields are ignored. The first-run checklist at the top is
instructional and stays visible after a plan exists.

## General settings

| Setting | Accepted values | Default | Effect |
| --- | --- | --- | --- |
| Language | `en` or `zh` | Obsidian language on first enable, otherwise `en` | Changes labels on mounted planner and execution surfaces, plus command palette names, editor-menu titles, and the Planner ribbon. Insert or a Settings change saves the first-run snapshot; a later Settings value is kept. |
| Chart start | `5`, `6`, `7`, `8` | `5` | First chart hour. |
| Chart end | `18`, `19`, `20`, `21`, `22`, `23`, `24` | `21` | Last chart hour; it must be later than the start. |
| Component prefix | any string | `[[Nautilus Log]]` | Stored compatibility setting; it does not change grammar v1 parsing. |
| Legend maximum length | `14`, `16`, `18`, `20`, `22`, `24`, `26`, `28` | `22` | Maximum planner legend label length. |
| Default task duration | `5`, `10`, `15`, `20`, `25`, `30`, `45`, `60` minutes | `15` | Duration for a Flexible Task with no duration token. |
| Urgent trigger word | any string | empty | Whitespace is removed; a matching token marks Flexible Tasks urgent. |

The urgent trigger is not removed from labels and never changes scheduling
priority. An empty trigger disables urgency.

## Execution settings

Enable **Execution Layer** to show timing, plan, and review surfaces and to
register execution commands. It is off by default. The dependent settings are
shown only while it is enabled.

| Setting | Accepted values | Default | Effect |
| --- | --- | --- | --- |
| Execution Layer | on/off | off | Enables CLOCK tracking, POMO, commands, and execution surfaces. |
| Keep Timing Line first in the right sidebar | on/off | on | Opens the active task view after a successful Clock in. |
| Pomodoro threshold | `15`, `20`, `25`, `30`, `45`, `50`, `60`, `90` minutes | `45` | Adds warning styling after the threshold; it does not stop timing. |
| Recent retention minutes | non-negative integer | `45` | How long closed task timings remain in Recent. `0` disables retention. |
| Forgotten timer minutes | non-negative integer | `120` | Adds a forgotten-clock warning after this duration. `0` disables the warning. |

The two free-form minute fields are rounded to the nearest integer and clamped
at zero. Empty input is ignored. Non-numeric input falls back to 45 for Recent
retention and 120 for Forgotten timer.

## Daily Note settings

| Setting | Accepted values | Default | Effect |
| --- | --- | --- | --- |
| Daily Note folder | vault-relative folder; empty means vault root | Core Daily Notes `folder` on first enable, otherwise empty | Prefix for the resolved Daily Note path. Backslashes are normalized to `/`. Insert or a Settings change locks the first-run value so later core-plugin edits do not overwrite it. An invalid folder is rejected; the field returns to the last accepted value instead of falling back to the factory default while you type. |
| Daily Note date format | a format containing year, month, and day tokens | Core Daily Notes `format` on first enable, otherwise `YYYY-MM-DD` | Produces the Daily Note path for the requested logical date. Insert or a Settings change locks the first-run value. Unsupported tokens such as `dddd` are rejected; the field returns to the last accepted format. |

Supported date tokens:

- `YYYY`: four-digit year (required).
- `MM` / `M`: two-digit or variable-width month.
- `DD` / `D`: two-digit or variable-width day.
- `[literal]`: literal text, including letters that must not be interpreted as
  tokens.

Use separators around variable-width `M` and `D` tokens. The rendered path must
be a normalized relative Markdown path; it must not be absolute, contain `..`,
end in `.md`, or contain forbidden path characters. The plugin adds the `.md`
extension when resolving a Daily Note.

If core Daily Notes uses an unsupported format such as `YYYY-MM-DD dddd`, first
enable does not copy that format. Settings then shows the host string and
explains that Planner and Insert use the plugin format below.
