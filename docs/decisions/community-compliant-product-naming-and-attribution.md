# Community-compliant product naming and attribution

Status: Accepted on 2026-08-28

Ticket: [Decide: Community-compliant product naming and attribution](https://github.com/oldwinter/obsidian-nautilus-log/issues/15)

Use **Spiral Day** as the project title, manifest display name, and Community
directory display name. Use **`spiral-day`** as the manifest ID and installed
plugin folder. Describe the project as an unofficial, independently maintained,
Obsidian-native parity port of Roam Nautilus Log v1.0.2; do not use `Nautilus
Log` or `Obsidian` as part of this product's name.

This replaces the earlier proposed `Nautilus Log for Obsidian` / `Nautilus Log`
split. Current Obsidian policy excludes `Obsidian` from plugin names and requires
every display name and ID to be unique. More importantly, the official registry
already assigns both `Nautilus Log` and `nautilus-log` to
`accessiblefish/obsidian-nautilus-log`. A distinct title and ID avoid a rejected
submission, installed-folder collision, and misleading implied continuity with
that separately maintained plugin.

## Fixed identity

| Surface | Decision |
| --- | --- |
| Project and documentation title | `Spiral Day` |
| `manifest.json` `name` | `Spiral Day` |
| Community directory display name | `Spiral Day` |
| `manifest.json` `id` | `spiral-day` |
| Installed folder | `.obsidian/plugins/spiral-day/` |
| Standard descriptor | `An unofficial Obsidian-native parity port of Roam Nautilus Log v1.0.2.` |
| Settings About title | `Spiral Day` |

The manifest author is the maintainer of this port. Upstream authors are
credited as contributors and sources; attribution must not imply that they or
Obsidian own, maintain, or endorse Spiral Day. `Obsidian` may be used
descriptively in prose with the unofficial/non-affiliation statement, but not in
the product name, plugin ID, logo, or icon.

`Spiral Day` is short, Basic Latin, descriptive of the spiral daily-planning
surface, and does not reuse an Obsidian core-feature name. Neither `Spiral Day`
nor `spiral-day` appeared in the official registry snapshot at the time of this
decision. Registry availability is time-sensitive and must be rechecked before
the first public or Community release.

## Attribution and notices

Keep human-readable credits separate from legal notices and source provenance:

1. `README.md` must call the project unofficial and independently maintained,
   then credit `404KSG` / Roam Nautilus Log, Tomas Baranek / Nautilus,
   `hopeserena` / Nautilus Enhanced, Matt Vogel / Roam Depot Render Template,
   and Jiayuan Zhang / Roam Logbook with links and roles.
2. The future settings About section must repeat the unofficial lineage in a
   compact form and link to the README, root `LICENSE`,
   `THIRD_PARTY_NOTICES.md`, and `PROVENANCE.md`. It must not present upstream
   authors as the manifest author.
3. Before copied or substantially ported upstream code lands, add a root
   `LICENSE` for this project, a `THIRD_PARTY_NOTICES.md` containing the
   applicable upstream notices verbatim, and a per-file `PROVENANCE.md` ledger.
   Preserve the Matt Vogel MIT notice for copied or substantially ported
   Nautilus-lineage code. Preserve Jiayuan Zhang's Roam Logbook MIT notice when
   timing source is copied or ported; behavioral compatibility alone receives
   a provenance credit rather than an invented source notice.
4. Because the Community installer downloads only `main.js`, `manifest.json`,
   and optional `styles.css`, any release containing copied or substantially
   ported code must also retain the applicable notice in a minifier-preserved
   `main.js` banner. Ship `LICENSE` and `THIRD_PARTY_NOTICES.md` with GitHub
   release assets and keep them in the source repository.
5. Do not reuse the upstream screenshot, an Obsidian logo-derived icon, or
   another project's visual identity. Create and record original release
   screenshots and product assets.

Credits acknowledge people and lineage; they do not replace copyright and
permission notices. `PROVENANCE.md` records the exact source commit, blob/path,
target scope, disposition, modifications, and covering parity test for every
copied or ported unit.

## Migration constraints

- Lock `spiral-day` before the first installable build. The manifest ID, plugin
  folder, release manifest, settings storage, and any persistent machine
  namespace must agree on it.
- Never rename the ID after Community publication. Obsidian documents that a
  published identifier cannot be changed in place; changing it resets download
  history and requires users to reinstall. A future ID change therefore means a
  separately published plugin plus an explicit, user-visible data/settings
  migration plan.
- A future display-name change is technically supported, but remains a product
  decision. Display text must not be used as a storage key or durable identity.
- This repository currently has no manifest, installable build, or released
  settings under `nautilus-log`, so this decision requires no local migration.
  If unpublished builds exist outside the repository, that assumption must be
  disproved and a migration plan added before release.
- Spiral Day is not an upgrade, replacement, or migration target for the
  separately registered `nautilus-log` plugin. It must not read, move, or
  overwrite `.obsidian/plugins/nautilus-log/` settings. The two IDs must be able
  to coexist at the installation layer.
- This identity decision does not choose or rename persisted Markdown grammar.
  The data-contract decision must not infer a syntax token from the display
  name.

## Community submission gate

A collision-free name does not by itself establish Community directory
eligibility. Current developer policies separately discourage duplicate
projects and require publicly verifiable approval for qualifying forks; a
divergent project must be independently implemented rather than inherit code
without explicit permission. The already-listed Nautilus Log port makes that
review concrete. Before Community submission, the project must demonstrate that
its implementation and product scope satisfy the then-current fork/duplication
policy or obtain the required publicly verifiable approval. MIT reuse rights
and directory acceptance are separate questions.

## Evidence and assumptions

Current policy was verified on 2026-08-28 against official Obsidian sources:

- [Manifest rules at official docs commit `c56c7e7`](https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/Manifest.md): IDs use lowercase letters/hyphens, cannot contain `obsidian` or end in `plugin`, should match the folder, and names must exclude Obsidian variants and be unique.
- [Developer policies at the same exact commit](https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Community%20directory/Developer%20policies.md): include a license, honor reused-code attribution, avoid trademark confusion, and satisfy the directory's fork rules.
- [Submission guide at the same exact commit](https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/Releasing/Submit%20your%20plugin.md): the submitted ID must be unique, and the Community installer downloads `main.js`, `manifest.json`, and optional `styles.css`.
- [Community FAQ at the same exact commit](https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Community%20directory/Frequently%20asked%20questions.md): published identifiers cannot be changed in place; a change resets downloads and requires reinstall.
- [Official registry at commit `57fb387`](https://github.com/obsidianmd/obsidian-releases/blob/57fb387689406dd7133935757d712dbcbc904c85/community-plugins.json): `Nautilus Log` / `nautilus-log` belongs to `accessiblefish/obsidian-nautilus-log`; no exact `Spiral Day` / `spiral-day` entry existed in that snapshot.
- [Obsidian brand guidelines](https://obsidian.md/brand): the Obsidian name, logo, and app icon are trademarks.

The linked research was read at its immutable artifacts:

- [Roam-to-Obsidian capability map at `d906db8`](https://github.com/oldwinter/obsidian-nautilus-log/blob/d906db8ea949c36a9255116b5a535bc9d0afa211/docs/research/roam-obsidian-capability-map.md)
- [License and provenance audit at `b240070`](https://github.com/oldwinter/obsidian-nautilus-log/blob/b2400709e7dea84a1080864a35974f6f2c23c582/docs/research/license-provenance.md)

Assumptions are deliberately conservative: no upstream or Obsidian endorsement
has been granted, no public release from this repository exists, and this is an
engineering provenance decision rather than a legal conclusion.

## Considered options

- **`Nautilus Log for Obsidian` everywhere:** rejected because `Obsidian` is not
  allowed in the plugin name and it creates first-party confusion.
- **Project title `Nautilus Log for Obsidian`, listing name `Nautilus Log`, ID
  `nautilus-log`:** rejected because both listing identifiers are already in the
  official registry and would conflate two independently maintained projects.
- **A suffixed Nautilus name:** rejected because a minimally differentiated name
  would remain confusing beside the existing listing and would carry the
  unresolved upstream-name question into the product identity.
- **`Spiral Day` / `spiral-day`:** accepted because it is compliant, distinct,
  meaningful for the product surface, and leaves upstream lineage in the place
  it belongs: credits, notices, and provenance.
