# comments steering

## when to write a comment

default: do not write one. reach for a comment only when the *why* is non-obvious and a future reader would misunderstand or waste time without it.

good reasons to comment:

- a hidden constraint or invariant that is not visible from the code
- a workaround for a specific bug in an external system (link or name it)
- surprising behavior a careful reader would still get wrong
- a subtle ordering or timing dependency

bad reasons to comment:

- describing what the code does when the identifiers already say so
- referencing the current task, ticket, or pr ("added for issue #123", "used by the new flow")
- change history ("removed old handler", "was previously async"). that belongs in commits and git history
- restating a type signature in prose

## style

- casual tone.
- brief. one line whenever possible. never a multi-paragraph block.
- descriptive and helpful. the reader should walk away with the missing context, not more questions.
- no emojis.
- no em-dashes (u+2014) or double hyphens (`--`) as punctuation. use a period, a comma, or parentheses.
- match the surrounding file. if existing comments in the project have a particular voice, follow it.

## examples

good:

```go
// value in list
return slices.Contains(exp.Values, val)

// key absent means match; NotIn semantics per k8s docs
if !exists { return true }
```

bad:

```go
// This function checks if the expression matches the labels by iterating
// through the values and returning true or false based on the operator.
func matchesExpression(exp Expression, labels Label) bool { ... }

// TODO: added 2026-08-20 by claude for the selector refactor
func matches(...) { ... }

```

## docstrings and public api

- exported functions can have a one-line godoc-style comment when the name alone does not fully convey what they do or return.
- keep it to one line. no argument-by-argument breakdown unless a parameter genuinely surprises.
- same tone rules apply (lowercase, casual, brief).
