# Trace report artifacts

`scripts/verify/render-trace-report.mjs` derives deterministic JSON or Markdown
from a bundle that has already passed the exact-candidate evidence verifier.
Reports are derived artifacts: they are written outside the immutable bundle so
their own hash cannot create a manifest cycle.

Validate a bundle before rendering it:

```sh
node scripts/verify/verify-evidence.mjs \
  --repo . \
  --bundle release-evidence \
  --candidate-sha "$CANDIDATE_SHA" \
  --package-sha256 "$PACKAGE_SHA256"
```

The verifier reads `docs/parity/requirements.json` from the named commit with
Git object commands. The worktree copy is never an acceptance input. The bundle
must contain `manifest.json`, the indexed package, a resolved-requirements
overlay, records, and artifacts. The overlay must be semantically identical to
the committed requirement manifest after only its `evidence` arrays are reset
to empty.

Record types are `pure`, `vault`, `host`, `screenshot`, `keyboard`,
`accessibility`, `lifecycle`, `network/privacy`, `performance`, `package`, and
`manual`. Evidence IDs retain the accepted `UNIT`, `CONTRACT`, `INTEGRATION`,
`VAULT`, `SCREENSHOT`, `KEYBOARD`, `A11Y`, `LIFECYCLE`, `PACKAGE`, or `MANUAL`
kind rather than deriving a new identifier namespace from record types.

The JSON report has four identity fields at its root: schema version, full
candidate SHA, package SHA-256, and the hashes/paths of its source manifest,
Evidence Index, and resolved requirement overlay. `forward.requirements`
provides the complete `requirement -> test -> evidence -> artifact` path.
`reverse.tests`, `reverse.evidence`, and `reverse.artifacts` provide the inverse
paths without consulting mutable worktree files.

Generation is deterministic: entries retain the verifier's canonical lexical
ordering and no wall-clock generation timestamp is added. A report is valid
only while its source manifest, index, candidate object, and package hash still
match.
