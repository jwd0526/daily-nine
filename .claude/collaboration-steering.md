# collaboration steering

how we work together. applies to every task.

## ask before assuming

- if scope, product intent, or a technical choice is ambiguous, ask before doing.
- prefer a small batch of pointed questions over a long clarification thread.
- if a task has a clear objective but multiple viable approaches, surface the tradeoff briefly and let the user pick.
- do not invent product decisions. reference the relevant spec, and if it does not answer the question, ask.

## do not over-engineer

- solve the task in front of you. no speculative abstractions, no "while we're here" refactors, no scaffolding for hypothetical future needs.
- three similar lines beats a premature helper.
- no error handling, validation, or fallbacks for cases that cannot happen. trust internal call sites and framework guarantees. validate only at real boundaries (user input, external services).
- no feature flags or backwards-compat shims when the code can just change.
- no half-finished implementations. if you cannot finish a slice, say so and stop.

## keep scope tight

- a bug fix does not need surrounding cleanup.
- a one-shot operation does not need a reusable helper.
- if you notice unrelated issues while working, note them for the user rather than fixing them silently.

## writing style (applies everywhere: comments, docs, specs, plans, commits, chat)

- no emojis in code, comments, logs, documentation, commit messages, or conversation replies.
- in the ui, emojis only where they carry meaning (e.g. the result share text). never decorative.
- no em-dashes (u+2014) or double hyphens (`--`) as punctuation. use a period, a comma, or parentheses instead.
- lowercase and casual is the default tone. formal capitalization is not required in docs or comments.
- brief and direct beats thorough and hedged.

## keep `.claude/` current

- when new findings, decisions, or user preferences come up during a session, update the appropriate file in `.claude/` before finishing.
- if a spec or plan becomes stale, update it in the same commit as the code change that made it stale.
- if a user preference or rule surfaces that belongs in a steering file, add it. do not just remember it in-session and let it die.

## verify before claiming done

- for code changes: run the project's test and lint commands before saying the task is complete.
- for ui or feature changes: exercise the feature end to end. if you cannot (no browser, no cluster, etc.), say so explicitly instead of claiming success.
- type-checks and unit tests verify correctness of the code, not correctness of the feature. do not conflate them.
