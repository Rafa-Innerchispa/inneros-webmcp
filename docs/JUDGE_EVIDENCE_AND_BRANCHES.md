# Judge Evidence and Branch Audit

This repository uses `main` as the canonical release/judge branch. Challenge-period branches are retained to preserve development and execution evidence, but historical branches are not merged into `main` merely because they still exist.

Audit snapshot: 2026-09-03, before submission freeze.

## Canonical release

| Branch | Audit result | Meaning |
| --- | --- | --- |
| `main` | canonical | Current public judge/release source. Audit base was `467a00eec32f48cfdfc8fa568e66dd814030674d`. |

## Branches fully contained in current `main`

These branches have **0 commits ahead of `main`**. Their implementation is already contained or superseded by the canonical branch.

| Branch | Relation to audited `main` |
| --- | --- |
| `cursor/webmcp-final-takeover-20260903` | behind by 1, ahead by 0 |
| `chatgpt/webmcp-unified-chat-history-20260903` | behind by 4, ahead by 0 |
| `chatgpt/webmcp-real-provider-bridge-20260902` | behind by 9, ahead by 0 |
| `chatgpt/webmcp-provider-bridge-api-20260902` | behind by 13, ahead by 0 |
| `chatgpt/webmcp-provider-bridge-final-20260902` | behind by 12, ahead by 0 |
| `chatgpt/webmcp-vslice` | behind by 22, ahead by 0 |
| `codex/webmcp-live-proof-20260902` | behind by 12, ahead by 0 |

## Evidence/config branches intentionally not blindly merged

### `cursor/webmcp-cursor-live-proof-20260902`

GitHub comparison against the audited `main` shows the branch diverged with one branch-only file:

- `docs/CURSOR_EXECUTION_PROOF.md`

That document explicitly says the branch exists as judge/demo evidence and was not intended to be deployed merely to prove Cursor execution. The branch is retained as evidence rather than merging an old base back into the release.

Evidence correlation: `webmcp-cursor-live-proof-20260902`.

### `chatgpt/webmcp-provider-execution-wire-20260903`

The branch is four commits behind the audited release and has one branch-only historical handoff file:

- `docs/WEBMCP_CONTINUITY_HANDOFF.md`

The handoff captured an intermediate state. Current release documentation supersedes it, so the old branch is retained for audit history rather than merged.

### `codex/webmcp-cloudflare-worker-20260902`

This branch contains a more deployment-specific Worker configuration than the audited `main`:

- custom route for `webmcp.creatorcore.ai/edge/attest*`
- `workers_dev = false`
- a regression asserting that the Worker does not proxy unrelated WebMCP routes

The public edge-attestation endpoint was independently verified live before freeze. The relevant narrow configuration/test can be ported onto the final release branch without merging the branch's old base.

## Merged pull-request evidence

The repository history also preserves the following merged PRs:

- PR #1: local Qwen Copilot and verifiable WebMCP execution proof
- PR #2: FastMCP dispatch envelope handling
- PR #3: serialized FastMCP result parsing
- PR #4: durable IDE dispatch ID recovery through nested FastMCP envelopes

## Release rule

Before Devpost submission:

1. update `main` with only current, tested release changes;
2. keep historical/proof branches as evidence;
3. do not force-push or merge obsolete bases;
4. verify public login, 11 WebMCP tools, local Copilot, explicit dispatch/trace, DMX, and Cloudflare edge;
5. freeze repository, live site, Devpost entry, and video after the submission deadline for the judging period.

This branch policy makes the repository easier for judges to understand: **`main` is the product; named branches are the audit trail.**
