# Decision: Markdown grammar and stable Plan Item identity

- Status: Accepted
- Date: 2026-08-28
- Ticket: [Decide: Obsidian Markdown grammar and stable Plan Item identity](https://github.com/oldwinter/obsidian-nautilus-log/issues/8)
- Functional baseline: upstream Nautilus Log v1.0.2 at
  [`973a041aa2f59f3b05bf31db8187efbfea07017a`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a)

## Decision summary

Nautilus Log recognizes planning input only inside an explicit, versioned pair of
Markdown comment markers. Grammar v1 reads direct unordered list items in source
order. Standard Markdown checkboxes replace Roam TODO/DONE macros; marker-free
items remain visible planning input so the v1.0.2 spiral behavior is not lost.
Only open checkbox items are eligible for Execution Layer task mutations.

Parsing is pure and read-only. A source span locates an item only in the exact
file snapshot that produced it. Durable identity is the value of a terminal
Obsidian block ID, unique across the vault. An existing unique block ID is used
as-is. When an anonymous Plan Item first receives an explicit action that needs
durable identity, the same atomic edit adds a generated `^nl-<uuid>` ID and
performs the action. There is no persisted side table.

The grammar version is stored in the opening marker. Unversioned, malformed, or
unsupported regions are not interpreted. A release must not assign new meaning
to existing v1 text; a semantic grammar change requires a new marker version and
an explicit, previewed migration.

## Scope and assumptions

This record settles Plan Region recognition, Plan Item syntax and status,
semantic-token precedence, source spans, durable identity, metadata write
authority, and grammar migration. It does not choose Daily Note path resolution,
LOGBOOK/CLOCK serialization, multi-file transaction recovery, or the final UI for
diagnostics. Those decisions consume this contract.

The following assumptions were accepted by the controller's delegated authority:

1. Obsidian-native Markdown syntax may replace Roam-only renderer and TODO/DONE
   macros while preserving their observable planning and execution roles.
2. Ordinary Daily Note content must not become planning input merely because it
   contains a task, time, tag, heading, or third-party field.
3. Visual planning needs no persistent identity. Any action that creates durable
   state does.
4. A durable identity guarantee without automatic writes, a source-carried ID,
   or a hidden database is impossible. Of those choices, source-carried metadata
   is the only one consistent with the product boundary.
5. The controller authorized the recommended answers in place of interactive
   grilling; the rejected alternatives below record the branches considered.

## Evidence used

The decision uses the linked research at its exact published commits, not branch
tips:

- [Observable behavior inventory](https://github.com/oldwinter/obsidian-nautilus-log/blob/254976ab0c92611e59b8c9bb88d946d7b155212b/docs/research/behavior-inventory.md)
  at `254976ab0c92611e59b8c9bb88d946d7b155212b`: direct-child ordering,
  marker-free spiral rows, token forms, label cleaning, references, and the
  Execution eligibility mismatch.
- [Scheduler and parser semantics](https://github.com/oldwinter/obsidian-nautilus-log/blob/d0d1c100f863a3cea43c0a37407670aa1a3997a4/docs/research/scheduler-semantics.md)
  at `d0d1c100f863a3cea43c0a37407670aa1a3997a4`: exact duration/time token
  grammar, first-token behavior, normalization, progress, and parser ordering.
- [Execution Layer state machines](https://github.com/oldwinter/obsidian-nautilus-log/blob/a43ae669a40799468e6473c6e8f8baac36143b1f/docs/research/execution-layer.md)
  at `a43ae669a40799468e6473c6e8f8baac36143b1f`: TODO/DONE action guards,
  identity-dependent rereads, CLOCK ownership, and failure boundaries.
- [Roam-to-Obsidian capability map](https://github.com/oldwinter/obsidian-nautilus-log/blob/d906db8ea949c36a9255116b5a535bc9d0afa211/docs/research/roam-obsidian-capability-map.md)
  at `d906db8ea949c36a9255116b5a535bc9d0afa211`: mutable Markdown positions,
  block IDs, metadata cache limits, link/embed choices, atomic write APIs, and
  the prohibition on a hidden task database.

## Domain model

The following terms are normative in this record:

- **Plan Region**: the source range between one valid pair of versioned plan
  markers in a resolved Daily Note.
- **Primary Plan**: the first recognized Plan Region in source order. It is the
  only region projected by grammar v1.
- **Plan Item candidate**: a direct unordered list item whose first physical line
  has a supported checkbox state or no checkbox.
- **Plan Item**: a candidate that yields a nonempty display label after owned
  syntax is removed and is classified as a Fixed Event or Flexible Task.
- **Plan Item status**: `plain`, `open`, or `done`, derived only from the canonical
  checkbox position.
- **Owned token**: source text whose meaning and source span are defined by this
  grammar: region markers, a supported checkbox, a scheduling token, or a
  terminal Plan Item ID.
- **Unowned text**: every byte not covered by an owned-token span. Parser and
  writer changes must preserve it.
- **Source Span**: a half-open location in one exact source snapshot. It is a
  mutation locator, never identity.
- **Plan Item ID**: a vault-scoped durable identity carried by a unique terminal
  Obsidian block ID.
- **Anonymous Plan Item**: a valid Plan Item without a Plan Item ID. It can be
  planned but has no durable identity promise.

## Grammar v1

### Plan Region

The exact markers are:

```markdown
<!-- nautilus-log:plan/v1 -->
<!-- /nautilus-log:plan -->
```

A versioned opening-marker candidate has the exact form
`<!-- nautilus-log:plan/vDIGITS -->`, where `DIGITS` is one or more ASCII digits
with no leading sign or surrounding whitespace. Grammar v1 supports only the
decimal version `1`. This broader candidate form lets the scanner distinguish an
unsupported declared version from an unrelated HTML comment.

A marker is recognized only when it begins at column zero, occurs outside a code
fence, and occupies the complete physical line apart from optional trailing
spaces or tabs and the line ending. A byte-order mark is allowed only at the
start of the file and is not part of a marker. Marker matching is ASCII
case-sensitive.

The opening marker's line is not part of the region content. The region content
starts after its line ending and ends before the closing marker's first byte.
The first recognized opening marker selects the Primary Plan:

1. Its version must be supported.
2. The next Nautilus plan marker must be the matching close marker.
3. A second opening marker before that close makes the Primary Plan malformed.
4. A missing close, nested marker, or unsupported version fails closed: there is
   no active plan, no heuristic fallback, and no write.
5. Later complete regions are ordinary Markdown for v1 and produce a duplicate
   region diagnostic. They are never merged with the Primary Plan.

No heading text, frontmatter field, filename, tag, task, or time range creates a
Plan Region. A user may type the markers manually. A future Initialize Plan
command may insert them only as the direct result of that explicit command.

### Eligible list structure

Within the Primary Plan, a Plan Item candidate is a direct unordered Markdown
list item. `-`, `+`, and `*` bullets are equivalent. Direct means the list item's
Markdown parent is the region fragment, not another list item, block quote,
callout, table, HTML block, or code block. Ordered list items are not candidates.

Only the first physical line of the list item supplies Plan Item text. Wrapped
continuation lines and nested children remain attached Markdown but do not
contribute title or scheduling tokens. Nested list items are not separate Plan
Items. Multiple direct lists separated by blank lines or prose are allowed and
retain total file source order.

Equivalent first-line structure:

```ebnf
ITEM       = INDENT, BULLET, SPACE, [ CHECKBOX, SPACE ], CONTENT,
             [ SPACE, BLOCK_ID ], TRAILING;
INDENT     = "" | " " | "  " | "   ";
BULLET     = "-" | "+" | "*";
CHECKBOX   = "[ ]" | "[x]" | "[X]";
BLOCK_ID   = "^", ID_CHAR, { ID_CHAR };
ID_CHAR    = ASCII_LETTER | DIGIT | "-";
TRAILING   = { SPACE | TAB };
```

The Markdown parser, rather than indentation arithmetic alone, is authoritative
for the direct-parent test. `BLOCK_ID` is recognized only as the terminal token
before optional trailing horizontal whitespace on the first line. The space
before it is required. Trailing whitespace remains unowned, including two spaces
whose Markdown meaning is a hard line break.

Checkbox status is exact:

| Source prefix after bullet | Status | Planning | Execution task actions |
| --- | --- | --- | --- |
| no checkbox | `plain` | Fixed Event or Flexible Task | disabled |
| `[ ]` | `open` | Fixed Event or Flexible Task | enabled only for Flexible Task |
| `[x]` or `[X]` | `done` | historical/completed projection | disabled |
| any other single-character checkbox | foreign Markdown | not a Plan Item | disabled |

The `plain` state deliberately preserves the v1.0.2 visual planner's marker-free
rows. Requiring `open` for Clock In and Complete preserves the baseline's
explicit task-action guard while preventing an action from inventing a checkbox
state. Roam `{{TODO}}`, `{{DONE}}`, `{{[[TODO]]}}`, and `{{[[DONE]]}}` strings
have no status meaning in grammar v1; without a Markdown checkbox they are
unowned text on a `plain` item.

A foreign checkbox does not invalidate the Plan Region. It remains ordinary
Markdown and may be reported as unsupported. The plugin must not infer the
meaning of custom Tasks statuses.

### Inline projection and escaping

The parser creates a semantic text view with a source-offset map. Tokens can be
recognized only inside participating text nodes and cannot cross an excluded
node boundary.

| Markdown construct | Display projection | Scheduling-token participation |
| --- | --- | --- |
| plain text, emphasis, strong, highlight | visible text | yes |
| Markdown link | visible label, destination omitted | label only |
| wiki link | alias when present, otherwise target text | visible label only |
| Markdown image | alt text | no |
| Obsidian embed `![[...]]` | alias or target text, never expanded | no |
| inline code | code text | no |
| HTML/comment | no rendered label text | no |
| tag | literal visible tag | yes, but has no built-in meaning |

Inline code is the canonical escape for text that resembles Nautilus syntax:
`` `30m` `` displays `30m` but does not set Duration. A backslash is not a
Nautilus escape; it participates in the ordinary token boundary rules and is
preserved in the display text.

Links and embeds are never dereferenced for parsing. In particular, an Obsidian
block link or embed does not borrow the target's status, tokens, children, or
identity. This intentionally removes the v1.0.2 wrapper/source ownership split:
the list line containing the link is the only possible Plan Item and write
target.

Tasks emoji/text, Dataview inline fields, tags, aliases, and unknown suffixes
have no special v1 meaning. They remain unowned display text and must survive
every write byte-for-byte. The absence or presence of Tasks, Dataview, or another
plugin cannot change parsing.

### Scheduling tokens

All scheduling token matching is ASCII case-insensitive unless a rule below says
otherwise. A token boundary is the start/end of one participating text node or
Unicode whitespace in that node. Punctuation is not a token boundary.

#### Duration

```ebnf
DIGITS       = DIGIT, { DIGIT };
MINUTE_UNIT  = "m" | "min";
DURATION     = DIGITS, "h", [ DIGITS, MINUTE_UNIT ]
             | DIGITS, MINUTE_UNIT;
```

Search left to right and own only the first matching Duration token. It means
`hours * 60 + minutes`; the minute suffix is not limited to 59, so `1h90m` is
150 minutes. `0m` is valid. Decimals, punctuation-wrapped forms, and spaced
composites such as `1h 30m` are not one token. In the last example, `1h` wins and
`30m` remains unowned display text.

If no Duration matches, the configured default duration applies. A valid
Duration on a Fixed Event is parsed and omitted from the display label for v1
parity, but event start/end, not Duration, reserve the timeline. A zero-duration
Flexible Task remains a Plan Item but creates neither a Planned Slot nor
Overflow. The validated fallback is an integer from 5 through 60 minutes;
missing, noninteger, or out-of-range values resolve to 15. The settings surface
offers `5, 10, 15, 20, 25, 30, 45, 60`.

#### Time range

```ebnf
CLOCK       = DIGIT, [ DIGIT ], [ ":", DIGIT, [ DIGIT ] ], WS,
              [ "am" | "pm" ];
SEPARATOR   = "-" | "–" | "až" | "to";
TIME_RANGE  = CLOCK, WS, SEPARATOR, WS, CLOCK;
WS          = { Unicode whitespace };
```

Search left to right for the first syntactically matching Time Range. Parse the
end before the start. If the end has AM/PM and the start does not, the start
inherits it; there is no forward inheritance. Minutes must be 0..59. A 24-hour
hour must be 0..23 and an AM/PM hour must be 1..12. Written `24:00` is invalid.
The ASCII text `az` is not the supported Czech separator; `až` is.

The first syntactic match is authoritative even when its clock values are
invalid. An invalid first match yields `invalid-time-range`, is not removed, and
does not allow a later range to take over. The item then follows Flexible Task
classification.

For a valid range:

- `end > start`: keep both minutes.
- `end == start`: keep a zero-length Fixed Event and emit `same-time`.
- `end < start` and written end is not 00:00: set end to 24:00 and emit
  `overnight-truncated`.
- `end < start` and written end is 00:00: set end to 24:00 without that warning.

These are the frozen v1.0.2 day semantics; grammar v1 does not silently adopt
the later upstream true-overnight behavior.

#### Progress and completion anchor

Progress is the first boundary-delimited `dNNN%` token, where `NNN` is one to
three digits. Matching is ASCII case-insensitive; values above 100 clamp to 100.
Every surface computes remaining Duration once as
`round(duration * (100 - progress) / 100)`, with nonnegative half values rounded
up. This deliberately uses the shared Execution projection rule and removes the
v1.0.2 renderer-versus-Execution floor/round disagreement.

After Progress is removed, a `done` Flexible Task may use the first v1.0.2
completion anchor matching case-sensitive `dH`, `dHH`, `dH:M`, `dH:MM`,
`dHH:M`, or `dHH:MM`. As in the baseline, it is a substring match without token
boundaries or clock-range validation. It supplies only the historical fallback
end anchor; it never schedules pending work. An `open` or `plain` item does not
recognize a completion anchor.

#### Urgent trigger

The setting layer removes all whitespace from the configured urgent trigger. If
the resulting value is nonempty, its first boundary-delimited, case-sensitive
occurrence flags a Flexible Task as urgent. It is unowned, remains in the display
label, and changes color only. It never changes source order, Duration,
scheduling priority, identity, or write eligibility.

### Parse and classification precedence

For each candidate, grammar v1 applies this sequence:

1. Capture the exact source snapshot and structural spans.
2. Read a terminal block ID, then the canonical checkbox. Neither contributes to
   semantic text.
3. Build the inline semantic view without dereferencing links or embeds.
4. Find and validate the first Time Range.
5. Remove a valid Time Range from the semantic view; leave an invalid first
   range untouched.
6. Find and remove the first Duration, or apply the configured default.
7. Find and remove the first Progress token.
8. For a `done` Flexible Task only, find and remove the completion anchor.
9. Detect but do not remove the urgent trigger.
10. Render Markdown label text, remove literal `---`, collapse display
    whitespace, and trim.
11. Omit an empty label with an `empty-plan-item` diagnostic.
12. Classify as Fixed Event if and only if step 4 produced a valid range;
    otherwise classify as Flexible Task.

Time Range therefore wins when a line also has Duration, Progress, or a
checkbox. Status controls current versus completed projection; it does not
change type. A Fixed Event's range wins over Duration. A completed Fixed Event
retains its explicit range for historical/event totals. A completed Flexible
Task may use CLOCK Actual or its completion anchor under the separately defined
history policy.

All token removals are projection-only. Parsing never edits source. Owned source
spans allow a later explicit writer to change only the intended token.

## Source spans and snapshots

Every parse result carries:

```text
SourceSnapshot = {
  file, contentDigest, contentLength
}

SourceSpan = {
  fromOffset, toOffset, fromLine, fromColumn, toLine, toColumn
}
```

Offsets are half-open UTF-16 code-unit offsets into the exact JavaScript string
whose SHA-256 digest is `contentDigest`. Line and column values are derived from
that same string. The parser records spans for the Plan Region, complete list
item, first line, semantic content, checkbox, each recognized token, and terminal
block ID.

A Source Span is valid only while its snapshot is current. Editor/vault changes
cause reparsing and replacement spans. A writer must reread and reparse; a cached
line number, offset, path, title, or text fragment is never mutation authority.
For an Anonymous Plan Item, the exact file object/path, source span, first-line
text, and digest form a short-lived **locator**. If any part is stale at action
time, the action makes no write and asks for a refreshed user intent. It must not
search for the nearest or first equal text.

## Stable identity

### Identity source and format

A Plan Item ID is the exact, case-sensitive value of a terminal Obsidian block
ID on the first physical line, provided that value occurs exactly once across
all Markdown files in the vault. The ID is vault-scoped; path and Daily Note date
are attributes, not identity.

Examples:

```markdown
- [ ] Draft the proposal 45m ^proposal-draft
- [ ] Review the proposal 30m ^nl-9f4de6a0-4d94-4b44-a7c4-c41127068e83
```

An existing valid, vault-unique block ID such as `^proposal-draft` is adopted
without rewriting it. A generated ID is:

```text
nl- + lowercase RFC 4122 UUID v4 in 8-4-4-4-12 form
```

Generation uses a cryptographically secure random source and retries on any
vault collision. The `nl-` prefix expresses ownership but has no scheduling
meaning. A disposable in-memory index may accelerate lookup; it must be fully
reconstructible from Markdown and is not canonical storage.

### Materialization rule

Opening the planner, parsing, refreshing, changing settings, navigating, and
unloading never create IDs. An ID may be materialized only from an explicit user
action that needs durable identity, including Clock In, Complete, or an explicit
Assign/Repair Identity command.

For an Anonymous Plan Item, that action must:

1. Reread and reparse the authoritative file.
2. Prove the same candidate still occupies the intended structural span and has
   the expected unowned text/status.
3. Generate a collision-free ID.
4. Insert ` ^nl-<uuid>` after every existing unowned suffix and immediately
   before any trailing horizontal whitespace on the first line.
5. Apply the requested same-file action in the same Editor transaction or
   `Vault.process` transform.
6. Reparse the result and require one eligible Plan Item with that ID.

Identity insertion is not allowed to succeed as an unrelated preparatory write
when the requested action fails validation. Cross-file atomicity and recovery
after an underlying API failure remain governed by the timing-write decision.

### Survival and collision behavior

| User operation | Result |
| --- | --- |
| edit title, tokens, checkbox, or nested detail while retaining ID | same Plan Item ID |
| reorder item | same Plan Item ID; new Source Span |
| rename or move the Daily Note | same Plan Item ID |
| move item to another valid Plan Region | same ID and item; date/plan membership changes |
| move item outside a valid Plan Region | ID remains Markdown, but there is no current Plan Item |
| reload plugin or Obsidian | index rebuilds from Markdown; same ID |
| duplicate text without copying an ID | distinct anonymous item; no false identity merge |
| duplicate a line including its ID | collision; neither occurrence is writable by that ID |
| delete or change the ID manually | old identity disappears; the edited item is anonymous or has a new ID |

On a duplicate ID, the visual planner may still render both occurrences from
their current spans, but every identity-dependent action fails closed and names
all known locations. The plugin never selects a winner by path, date, source
order, modification time, or text similarity. An explicit Repair Identity action
may target one revalidated occurrence and replace its terminal ID with a fresh
generated ID. Unknown or unresolved collisions keep actions disabled.

## Metadata and write ownership

Grammar v1 authorizes only two kinds of source metadata:

1. Plan Region markers, inserted by an explicit Initialize/Migrate Plan action.
2. A terminal block ID, inserted by an explicit identity-requiring or identity
   repair action.

The parser and visual plan are always read-only. There is no automatic eager ID
assignment, marker repair, progress cleanup, checkbox normalization, block-ID
deduplication, or migration. An explicit Complete action may own its requested
status/progress change, but the general write transaction, LOGBOOK children,
partial failure, external writer, and recovery policy are downstream decisions.

Every writer must preserve bullet style, indentation, line ending, links, tags,
Tasks/Dataview fields, aliases, formatting, custom suffixes, nested children, and
all other unowned text byte-for-byte. A writer changes only revalidated owned
spans named by the explicit action.

## Grammar versioning and migration

The `/v1` marker versions the source grammar, not the plugin package or data
schema. The following are semantic changes and require `/v2` or later:

- changing region selection or eligible Markdown structures;
- adding a new checkbox interpretation or scheduling token;
- changing token boundaries, precedence, normalization, or classification;
- expanding links/embeds or importing another plugin's semantics;
- changing the identity carrier or collision rule.

Refactoring and fixes that make an implementation conform to this record do not
change the grammar version. Each published grammar version has a locked fixture
suite. A plugin update dispatches by marker version and must never parse an old
region with the newest parser as a fallback.

Migration is explicit and source-visible:

1. Parse the unchanged source with its declared old grammar.
2. Parse a proposed transformed snapshot with the target grammar.
3. Preview every changed classification, status, owned token, label, identity,
   and ignored line.
4. Require confirmation.
5. Revalidate the original snapshot and apply one file transaction.
6. Change the opening marker only when the target parse succeeds.
7. Reparse and report the target version; on conflict, make no write.

An unsupported version remains ordinary Markdown with a diagnostic. Removing an
old parser is a breaking product decision and cannot rewrite or reinterpret its
notes automatically.

## Examples

### Valid Primary Plan

```markdown
## Today

<!-- nautilus-log:plan/v1 -->
- [ ] 09:00-10:00 Stand-up ^stand-up
- [ ] Deep work 1h30m d25%
- Lunch 12-1pm
- [x] Draft release note 45m d17:05 ^nl-9f4de6a0-4d94-4b44-a7c4-c41127068e83
- [ ] Discuss `30m` syntax 20m [due:: 2026-08-29] #writing
  - [ ] Nested follow-up 15m
- [>] Waiting on review 30m
<!-- /nautilus-log:plan -->
```

Expected results:

| Line | Result |
| --- | --- |
| Stand-up | open Fixed Event `[540,600)`, ID `stand-up`; no task execution action |
| Deep work | open Flexible Task, Duration 90, Progress 25, remaining 68 after rounding |
| Lunch | plain Fixed Event `[720,780)`; visual only |
| Draft release note | done Flexible Task, Duration 45, historical anchor 17:05, durable generated ID |
| Discuss syntax | open Flexible Task, escaped `30m` ignored, Duration 20; Dataview field and tag unowned |
| Nested follow-up | ignored because it is nested |
| Waiting on review | foreign checkbox, ordinary Markdown rather than a Plan Item |

### Precedence and failure cases

| Source content after bullet/status | Result |
| --- | --- |
| `Write 30m then 45m` | Flexible Task, Duration 30; `45m` remains in label |
| `Write 1h 30m` | Flexible Task, Duration 60; `30m` remains in label |
| `Meet 9-10pm 30m` | Fixed Event `[1260,1320)`; Duration parsed but ignored for reservation |
| `Late 23:00-01:00` | Fixed Event `[1380,1440)`, `overnight-truncated` |
| `Boundary 23:00-00:00` | Fixed Event `[1380,1440)`, no overnight warning |
| `Zero 09:00-09:00` | zero-length Fixed Event, `same-time` |
| `Bad 24:00-01:00 then 9-10` | Flexible Task, `invalid-time-range`; later range cannot win |
| `[Thirty](https://example.test/30m) 20m` | link destination ignored; Duration 20 |
| `[30m](https://example.test)` | link label participates; Duration 30 |
| `![[Template with 45m]] 15m` | embed not expanded or scanned; Duration 15 |
| ``Explain `9-10` 25m`` | code span escapes range; Flexible Task, Duration 25 |

### Identity collision

```markdown
- [ ] First copy 30m ^nl-9f4de6a0-4d94-4b44-a7c4-c41127068e83
- [ ] Second copy 30m ^nl-9f4de6a0-4d94-4b44-a7c4-c41127068e83
```

Both render from current spans. Neither can Clock In, Complete, or receive a
LOGBOOK mutation until an explicit repair assigns one occurrence a new ID.

## Rejected options

### Parse every task in a Daily Note

Rejected because it silently turns ordinary tasks, meeting notes, and third-party
syntax into planning input. A Plan Region is explicit, bounded, and versioned.

### Select a heading or frontmatter flag without a versioned boundary

Rejected because heading text is localizable and commonly reused, while a
whole-note frontmatter flag gives no precise eligible range. Neither prevents a
future parser from silently reinterpreting old text.

### Require an ID before an item can appear

Rejected because visual planning is a pure projection and needs no durable
state. Requiring IDs up front would force source churn merely to look at a plan.

### Assign IDs automatically while scanning

Rejected because opening a view would mutate canonical notes, create sync and
undo noise, and violate the explicit-action boundary.

### Use path plus line number

Rejected because insertion, deletion, reorder, rename, and move change the key.
It is a locator, not identity.

### Use normalized text or a content hash

Rejected because normal edits change the key and duplicate text aliases distinct
items. Adding occurrence ordinals merely disguises position identity.

### Store IDs in plugin data or a sidecar file

Rejected because the mapping becomes a hidden second task database with its own
rename, move, sync, backup, and conflict behavior. It cannot remain authoritative
when Markdown is copied outside the plugin.

### Expand Obsidian links or embeds

Rejected because expansion introduces cross-file I/O, cycles, cache timing,
wrapper-versus-source ownership, and ambiguous writes. The frozen Roam reference
projection already demonstrates that visible source borrowing without mutation
ownership is unsafe.

### Infer Tasks or Dataview semantics

Rejected because their status and field vocabularies are separately configured
and may change independently. Recognition would create a de facto dependency.
Their text remains valid, preserved Markdown.

### Silently upgrade old or unversioned notes

Rejected because new token or precedence rules could change schedules without a
source diff. Unsupported text remains ordinary Markdown until explicit migration.

## Testable invariants

An implementation is conformant only if automated fixtures prove all of these:

1. A note without an exact supported marker pair yields no Primary Plan.
2. Unsupported, unclosed, and nested markers fail closed without writes.
3. Only the first valid Plan Region is Primary; later regions are diagnosed and
   ignored.
4. Parsing the same source and settings twice yields byte-identical domain
   output and performs zero writes.
5. Direct unordered items retain total source order; ordered, nested, quoted,
   code, table, and foreign-checkbox items are not Plan Items.
6. Marker-free rows remain visual Fixed Events or Flexible Tasks but never gain
   Execution task actions.
7. Only `[ ]` Flexible Tasks are Clock In/Complete candidates; `[x]` and `[X]`
   are done.
8. Token matching never reads link destinations, image/embed targets, inline
   code, HTML, continuation lines, or nested children.
9. The first syntactic Time Range is authoritative, including invalid-first and
   valid-later input.
10. A valid Time Range always wins Fixed Event classification over Duration,
    Progress, checkbox, or label text.
11. Duration, time normalization, `0m`, progress rounding, completion-anchor,
    and warning examples above match exactly.
12. Unknown fields, tags, formatting, links, suffixes, bullets, indentation,
    line endings, and children survive every explicit write byte-for-byte.
13. Every Source Span resolves only against its recorded digest and half-open
    UTF-16 offsets; stale anonymous locators never fall back to text search.
14. A unique terminal block ID is the only durable Plan Item ID.
15. Retaining that ID preserves identity through text edits, reorder, file
    rename/move, region move, and reload.
16. Equal text without IDs never aliases identity. Equal IDs always produce a
    collision regardless of text or path.
17. No colliding occurrence can receive an identity-dependent write, and no
    deterministic winner is selected implicitly.
18. First identity materialization occurs only inside the explicitly requested,
    revalidated transaction and leaves no orphan ID when that action is rejected
    before commit.
19. The identity index can be deleted and rebuilt exclusively from Markdown with
    identical results.
20. The parser selected for `/v1` does not change when a newer grammar ships;
    unsupported versions are never parsed by fallback.

## Consequences for downstream tickets

- The timing-write contract receives an exact mutation target: a unique Plan
  Item ID plus newly parsed owned spans. It must define failure recovery, not
  identity guessing.
- The planner prototype must round-trip the marker pair, direct items, arbitrary
  unowned suffixes, nested children, CRLF/LF files, and duplicate IDs.
- The architecture needs a pure version-dispatched parser, a disposable
  vault-wide block-ID index, and separate anonymous locator versus durable ID
  types.
- Parity fixtures should record the deliberate native mappings: standard
  checkboxes, explicit Plan Region, no link/embed expansion, and shared progress
  rounding.
