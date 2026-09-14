# Skill Registry — dm-gestion

Index of discoverable skill files at the time `sdd-init` ran. This is an index, not a
generated summary — read the full `SKILL.md` at the given path before relying on a skill.
No project-level skill directory exists (`.claude/skills/` here only has `settings.json`),
so every entry below is user-level, sourced from `~/.claude/skills/` and
`~/.claude/plugins/marketplaces/*/skills/`. `sdd-*`, `_shared`, and `skill-registry` are
excluded per scan rules.

| Name | Scope | Trigger (from description) | Path |
| --- | --- | --- | --- |
| branch-pr | user | Create Gentle AI pull requests with issue-first checks. Trigger: creating, opening, or preparing PRs for review. | `~/.claude/skills/branch-pr/SKILL.md` |
| capcut-editor | user | Edit videos in CapCut Desktop through the capcut-mcp server. | `~/.claude/skills/capcut-editor/SKILL.md` |
| chained-pr | user | Trigger: PRs over 400 lines, stacked PRs, review slices. | `~/.claude/skills/chained-pr/SKILL.md` |
| cognitive-doc-design | user | Design docs that reduce cognitive load. Trigger: guides, READMEs, RFCs, onboarding, architecture docs. | `~/.claude/skills/cognitive-doc-design/SKILL.md` |
| comment-writer | user | Write warm, direct collaboration comments. Trigger: PR feedback, issue replies, reviews. | `~/.claude/skills/comment-writer/SKILL.md` |
| gentle-ai-bench | user | Trigger: bench, journey, journeys, driven mode, gentle-ai-bench. | `~/.claude/skills/gentle-ai-bench/SKILL.md` |
| go-testing | user | Trigger: Go tests, go test coverage, Bubbletea teatest, golden files. (Not applicable — this project is TS, not Go.) | `~/.claude/skills/go-testing/SKILL.md` |
| issue-creation | user | Trigger: issue creation, bug reports, feature requests, or issue approval. | `~/.claude/skills/issue-creation/SKILL.md` |
| judgment-day | user | Trigger: judgment day, dual review, adversarial review, juzgar. | `~/.claude/skills/judgment-day/SKILL.md` |
| rdd-defect-workflow | user | Trigger: RDD, receipt-driven development, review authority, receipt/lineage, correction/recovery. | `~/.claude/skills/rdd-defect-workflow/SKILL.md` |
| skill-creator | user | Trigger: new skills, agent instructions. Create LLM-first skills with valid frontmatter. | `~/.claude/skills/skill-creator/SKILL.md` |
| skill-improver | user | Trigger: improve skills, audit skills, refactor skills, skill quality. | `~/.claude/skills/skill-improver/SKILL.md` |
| systemic-issue-triage | user | Trigger: new issue, bug report, triage, backlog, issue flood, root cause. | `~/.claude/skills/systemic-issue-triage/SKILL.md` |
| token-saver | user | Always-on token economy. Cuts input/output tokens on every request. | `~/.claude/skills/token-saver/SKILL.md` |
| work-unit-commits | user | Plan commits as reviewable work units. Trigger: implementation, commit splitting, chained PRs. | `~/.claude/skills/work-unit-commits/SKILL.md` |
| token-reducer | user | Reduce context bloat, lower token usage, FTS + embeddings retrieval, reranked chunk packets. | `~/.claude/plugins/marketplaces/Madhan230205-claude-token-reducer/skills/token-reducer/SKILL.md` |
| engram-architecture-guardrails | user | Architecture guardrails for Engram itself (local store, cloud sync, dashboard). Scoped to the Engram codebase, not dm-gestion. | `~/.claude/plugins/marketplaces/engram/skills/architecture-guardrails/SKILL.md` |
| engram-backlog-triage | user | Backlog triage protocol for Engram's own issues/PRs. | `~/.claude/plugins/marketplaces/engram/skills/backlog-triage/SKILL.md` |
| engram-branch-pr | user | PR creation workflow for Engram's own issue-first enforcement system. | `~/.claude/plugins/marketplaces/engram/skills/branch-pr/SKILL.md` |
| engram-business-rules | user | Product/business-rule guardrails for Engram's own codebase. | `~/.claude/plugins/marketplaces/engram/skills/business-rules/SKILL.md` |
| engram-commit-hygiene | user | Commit/branch naming standards for Engram contributors. | `~/.claude/plugins/marketplaces/engram/skills/commit-hygiene/SKILL.md` |
| engram-cultural-norms | user | Cultural/collaboration norms for Engram contributors. | `~/.claude/plugins/marketplaces/engram/skills/cultural-norms/SKILL.md` |
| engram-dashboard-htmx | user | HTMX/templ interaction rules for the Engram dashboard. | `~/.claude/plugins/marketplaces/engram/skills/dashboard-htmx/SKILL.md` |
| engram-docs-alignment | user | Documentation alignment rules for Engram's own docs. | `~/.claude/plugins/marketplaces/engram/skills/docs-alignment/SKILL.md` |
| gentleman-bubbletea | user | Bubbletea TUI patterns for Gentleman.Dots installer. | `~/.claude/plugins/marketplaces/engram/skills/gentleman-bubbletea/SKILL.md` |
| engram-issue-creation | user | Issue creation workflow for Engram's own repo. | `~/.claude/plugins/marketplaces/engram/skills/issue-creation/SKILL.md` |
| engram-memory-protocol | user | Persistent memory discipline for Engram contributors. | `~/.claude/plugins/marketplaces/engram/skills/memory-protocol/SKILL.md` |
| engram-plugin-thin | user | Adapter boundary rules for plugin integrations. | `~/.claude/plugins/marketplaces/engram/skills/plugin-thin/SKILL.md` |
| engram-pr-review-deep | user | Deep technical review protocol for Engram pull requests. | `~/.claude/plugins/marketplaces/engram/skills/pr-review-deep/SKILL.md` |
| engram-project-structure | user | Repository structure/placement rules for Engram's own repo. | `~/.claude/plugins/marketplaces/engram/skills/project-structure/SKILL.md` |
| engram-server-api | user | API contract guardrails for Engram server changes. | `~/.claude/plugins/marketplaces/engram/skills/server-api/SKILL.md` |
| engram-testing-coverage | user | TDD/coverage standards for Engram's own codebase. | `~/.claude/plugins/marketplaces/engram/skills/testing-coverage/SKILL.md` |
| engram-tui-quality | user | Bubbletea/Lipgloss quality rules for Engram's TUI. | `~/.claude/plugins/marketplaces/engram/skills/tui-quality/SKILL.md` |
| engram-ui-elements | user | Creation rules for Engram's own UI elements/pages/cards. | `~/.claude/plugins/marketplaces/engram/skills/ui-elements/SKILL.md` |
| engram-visual-language | user | Visual language rules for Engram's own dashboard styling. | `~/.claude/plugins/marketplaces/engram/skills/visual-language/SKILL.md` |

## Notes for this project

Most `engram-*` and `gentleman-bubbletea` entries govern the Engram/Gentleman.Dots codebases
themselves (Go/Bubbletea TUI, their own dashboard) — they do not apply to dm-gestion
(Electron + React + TypeScript). Kept in the index per the scan rule (index everything
discoverable, exclude only `sdd-*`/`_shared`/`skill-registry`); a phase agent should still
check applicability before following one.

Convention files scanned: none found at the workspace root (no `AGENTS.md`, `agents.md`,
`.cursorrules`, `GEMINI.md`, `copilot-instructions.md`). A project-level `CLAUDE.md` exists
(`CLAUDE.md`, 4 lines — efficiency norms, not architecture) and is already picked up by the
harness directly.
