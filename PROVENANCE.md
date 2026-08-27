# Spiral Day provenance

Spiral Day is an unofficial, independently maintained, clean-room Obsidian port
of the observable Roam Nautilus Log v1.0.2 workflow. This ledger is an
engineering provenance record, not legal advice.

The canonical behavior specification is the implementation dossier at commit
`f3dcf1a000624a705b8c868a4f681339fcd6bedd`. The fixed behavioral baseline is
`404KSG/roam-nautilus-log` v1.0.2 at
`973a041aa2f59f3b05bf31db8187efbfea07017a`.

## Validation policy

`npm run validate:provenance` parses the ledger below and fails unless every
file under `src/`, `styles/`, `tests/`, `benchmarks/`, release/verification
scripts, workflows, deviations, or trace reports has exactly one row with all
required fields. The same rule applies repository-wide to any text file carrying
an `@spiral-day-source` marker. A `copied` or `ported` row additionally requires
immutable repository, commit, path, blob, license, applicable notice,
modification, and covering-test data. Such a source file must also carry a short
`@spiral-day-source <40-character-commit>:<path>` header.

Notice identifiers resolve to verbatim, marker-delimited notices in
`THIRD_PARTY_NOTICES.md`. Production builds preserve every notice selected by a
`copied` or `ported` row in the generated `main.js` banner. Original and
behavioral-reimplementation rows do not manufacture a copied-code notice.

The machine-readable block is the source of truth for this foundation. Keep it
valid JSON and do not change its boundary markers.

<!-- provenance-ledger:begin -->
```json
{
  "schema_version": 1,
  "rows": [
    {
      "target_scope": "src/main.ts",
      "disposition": "behavioral-reimplementation",
      "source_repository": "https://github.com/oldwinter/obsidian-nautilus-log",
      "source_commit": "f3dcf1a000624a705b8c868a4f681339fcd6bedd",
      "source_path": "docs/implementation-dossier.md",
      "source_blob_sha": "b507a45f8bb1a3af09907535225c863f8f600d23",
      "creation_import_commit": "not-applicable: independently implemented for issue #17",
      "license": "MIT; target project license in LICENSE",
      "notice": [],
      "modifications": "Independent Obsidian TypeScript composition root with no product behavior or upstream source translation.",
      "covering_tests": [
        "FND-TYPE-001",
        "FND-LIFECYCLE-001",
        "FND-LOCAL-001",
        "FND-NOWRITE-001"
      ],
      "reviewer": "oldwinter, implementation owner for GitHub issue #17",
      "verified_on": "2026-08-28",
      "release_artifact_impact": "Bundled into main.js; contains no copied upstream or prototype source."
    },
    {
      "target_scope": "issue-13-prototype/**",
      "disposition": "excluded",
      "source_repository": "https://github.com/oldwinter/obsidian-nautilus-log",
      "source_commit": "5a2db368df31f6ded948a983fbceae38c455b611",
      "source_path": "prototype/",
      "source_blob_sha": "06b30761d28e933d62254b8516ff19db68945f55",
      "creation_import_commit": "not-applicable: excluded input",
      "license": "not-applicable: nothing copied or distributed",
      "notice": [],
      "modifications": "No source, package graph, CSS, fixture, screenshot, asset, or architecture was copied.",
      "covering_tests": [
        "FND-EXCLUSION-001"
      ],
      "reviewer": "oldwinter, implementation owner for GitHub issue #17",
      "verified_on": "2026-08-28",
      "release_artifact_impact": "None; the prototype tree is forbidden from source and release artifacts."
    }
  ]
}
```
<!-- provenance-ledger:end -->

## Independent toolchain

The target toolchain was selected independently from current Obsidian public
API guidance. All direct packages are development-only and exact-versioned:

| Package | Version | Purpose | License | Bundled at runtime |
| --- | --- | --- | --- | --- |
| `obsidian` | `1.13.1` | Public API types | MIT | No; external host API |
| `esbuild` | `0.28.2` | Deterministic bundling and validation | MIT | No |
| `typescript` | `7.0.2` | Static type checking | Apache-2.0 | No |

The exact transitive graph and integrity hashes are recorded in
`package-lock.json`. There are no production or native dependencies.

## Explicit exclusions

The repository and release artifacts must not contain the upstream generated
bundle, screenshot, package graph, build configuration, CSS, fonts, Blueprint
or host assets, or any Issue #13 prototype source, package file, CSS, fixture,
evidence asset, or architecture. Observable behavior and the accepted dossier
are specification inputs only.
