# docs steering

covers project docs written by (or with) claude: specs, plans, steering, and any findings notes.

## location

- all project docs live in `.claude/`.
- exception: the repo-root `CLAUDE.md` and the standard `README.md`. everything else goes under `.claude/`.

## naming

- `<descriptive-title>-spec.md`
- `<descriptive-title>-plan.md`
- `<descriptive-title>-steering.md`
- `<descriptive-title>-notes.md` for ad-hoc findings that do not yet fit the above

titles are kebab-case, descriptive, and specific. `engine-spec.md` is fine. `stuff.md` is not.

## doc types (use the right one)

three distinct roles. do not blur them.

### spec

- answers *what* and *why*.
- product intent, domain semantics, hard constraints, decisions made (with rationale), decisions still open.
- long-lived. changes when the product understanding changes, not when the code changes.
- one spec per coherent surface. do not fold implementation sequencing into it.

### plan

- answers *how* and *when*.
- sequenced steps, status per step, checkpoints, dependencies between steps.
- updated as work progresses. retire (delete or archive) when the work is complete.
- a plan references its spec; it does not restate it.

### steering

- enduring rules and preferences that outlast any single task.
- how to work: commits, comments, testing conventions, review conventions, collaboration norms.
- rarely changes. when a new rule surfaces from user feedback, add it here so it survives sessions.

## principles

- do not over-engineer docs. objectives, scope, key decisions, open questions. no filler, no boilerplate sections just to look thorough.
- write like the comments steering says: lowercase, casual, brief, direct.
- no emojis. no em-dashes (u+2014) or double hyphens (`--`) as punctuation.
- link between docs by relative path (e.g. `see .claude/foo-spec.md`).
- when a fact appears in more than one doc, keep it in the spec and reference it from the plan.

## keeping docs current

- when a decision changes, update the spec in the same commit as the code change that reflects it.
- when a plan step completes, update its status in the same commit that completes it.
- when a user preference or rule surfaces mid-task, add it to the relevant steering file before ending the session.
- if a doc is wrong or stale and you notice it, fix it. do not leave it drifting.

## what does not belong here

- transient task state (use the harness task list).
- session summaries or activity logs.
- notes that duplicate what git history already tells you.
- personal memory about the user (that goes in the claude memory system, not `.claude/`).
