# Markdown grammar v1 reference

This is the user-facing syntax reference for the accepted grammar described in
[the grammar decision](../decisions/markdown-grammar-and-plan-item-identity.md).

## Plan Region

Use this exact pair, each on a complete physical line at column zero:

```markdown
<!-- nautilus-log:plan/v1 -->
<!-- /nautilus-log:plan -->
```

Markers are case-sensitive, must be outside a code fence, and may have trailing
spaces or tabs. The first opening marker in source order determines the Primary
Plan. A missing close, nested marker, or unsupported version fails closed; the
parser does not skip to a later region. A heading, frontmatter field, filename,
tag, or ordinary task does not create a region.

## Plan Items

Only direct unordered list items in the Primary Plan are candidates. `-`, `+`,
and `*` are equivalent. Ordered items, nested items, quoted content, tables,
HTML blocks, and code blocks are not Plan Items. Only the first physical line
contributes label and scheduling tokens; continuation text and nested children
remain source content.

The supported first-line shape is:

```text
[indent] BULLET [space] [STATUS space] CONTENT [space] [terminal block ID] [trailing whitespace]
```

`STATUS` is exactly `[ ]`, `[x]`, or `[X]` immediately after the bullet. Any
other checkbox marker is foreign Markdown and is ignored by the planner.

| Source status | Planner projection | Execution actions |
| --- | --- | --- |
| no checkbox (`plain`) | Fixed Event or Flexible Task | none |
| `[ ]` (`open`) | Fixed Event or Flexible Task | open Flexible Tasks only |
| `[x]` / `[X]` (`done`) | historical/completed item | no Clock In; Planner may offer Reopen |

An item must have a non-empty visible label after owned syntax is removed.

## Inline projection

Scheduling scans visible semantic text. Markdown link destinations, image
targets, embed targets, inline code, HTML, and comments do not participate.
Links use their visible label; wiki links use their alias or target text; images
use alt text; embeds are never dereferenced. Tags and third-party fields remain
visible, unowned text. Inline code is the escape for token-like text:
`` `9-10` `` and `` `30m` `` are displayed but not parsed.

## Scheduling tokens

Matching is ASCII case-insensitive unless stated otherwise. The first matching
token wins and is removed from the projected label. Tokens are read only on the
first physical line.

### Duration

Supported forms are `30m`, `30min`, `2h`, and `2h30m`. Minutes may be greater
than 59 (`1h90m` is 150 minutes). Decimals, punctuation-wrapped forms, and
spaced composites (`1h 30m`) are not one token. If no duration is present, the
configured default applies (15 minutes by default). A valid duration on a Fixed
Event does not change its reserved time range.

### Time range

Use two clocks with `-`, `–`, `až`, or `to`, for example `09:00-10:30`,
`9-10pm`, or `12 až 13`. Minutes must be 0–59. A 24-hour clock uses hours
0–23; AM/PM uses 1–12. The first syntactic match is authoritative: if it is
invalid, a later range cannot replace it. A valid range makes the item a Fixed
Event. An end before the start is displayed through 24:00; equal times produce
a zero-length event.

### Progress

The first boundary-delimited `dNNN%` token is progress. Values above 100 clamp
to 100. Remaining duration is rounded to the nearest minute, with half values
rounded up. Progress is removed from the display label.

### Completion anchor

For a completed Flexible Task only, the first case-sensitive `dH`, `dHH`,
`dH:M`, or `dHH:MM` substring can provide a historical completion anchor. It
does not schedule pending work.

### Urgent trigger

The configured trigger is whitespace-stripped. Its first case-sensitive,
boundary-delimited occurrence marks a Flexible Task as urgent. The trigger stays
in the label and affects color only; it does not change order, duration, or
execution eligibility.

## Identity and writes

A terminal block ID is written as `^` followed by letters, digits, or hyphens,
for example `^stand-up`. It must be unique across the vault to be durable. A
generated ID uses `^nl-<uuid>`.

Parsing, opening, refreshing, navigation, and settings changes are read-only.
An explicit action such as Clock in or Complete may assign an ID and perform its
requested write in one transaction. Writers preserve all unowned Markdown
byte-for-byte. Source spans are valid only for the exact snapshot that produced
them; edits made by another writer cause the action to fail closed and require a
refresh.
