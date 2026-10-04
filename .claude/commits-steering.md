# commits steering

## standard

follow the conventional commits spec: https://www.conventionalcommits.org/en/v1.0.0/

format: `type(scope): description`

- `type` is required.
- `scope` is optional, at most one word, only when it meaningfully narrows the change.
- `description` is required, imperative mood, lowercase, no trailing period.
- breaking changes are marked with `!` after the type or scope (e.g. `feat!:`, `refactor(api)!:`).

## types

use the standard set:

- `feat`: new user-facing capability
- `fix`: bug fix
- `docs`: documentation only
- `style`: formatting, whitespace, no logic change
- `refactor`: code change that neither fixes a bug nor adds a feature
- `perf`: performance improvement
- `test`: adding or correcting tests
- `build`: build system or dependencies
- `ci`: ci config and scripts
- `chore`: housekeeping that does not fit elsewhere
- `revert`: reverts a prior commit

## sizing

- header stays under 10 words. if it does not fit, the scope of the commit is probably too large.
- no commit body. the header must carry the change. if it cannot, split the commit.
- soft target: a commit touches under ~200 lines of meaningful change. this is guidance, not a hard limit. if a single logical change genuinely needs more, that is fine. if a commit crosses ~200 lines because it bundles unrelated work, split it.
- one logical change per commit. mixed-purpose commits ("feat + unrelated fix") get split.

## before committing

- run the project's test command. failing tests block the commit.
- run the project's lint or vet command if one exists. failures block the commit.
- never bypass hooks or signing (`--no-verify`, `--no-gpg-sign`) unless the user explicitly asks. if a hook fails, fix the underlying issue.

## authorship

- commits are authored by the user (their local git config).
- do not add `Co-Authored-By: Claude` trailers.
- do not add "Generated with Claude Code" or any similar attribution.
- do not modify the user's git config.

## when to commit

- only commit when the user explicitly asks. do not commit proactively even after a clean task.
- when committing, always create a new commit. do not amend a prior commit unless the user asks.
- never force-push, reset --hard, or run other destructive git commands without explicit approval.

## message examples

good:

- `feat(engine): add match label and expression selector`
- `fix(matcher): handle missing key in In and NotIn operators`
- `refactor: split policy applicability into own file`
- `docs: sync roadmap with spec`
- `test(selector): cover missing-key cases for all four operators`
- `feat!: rename matches to Matches for external callers`

bad:

- `feat: added a whole bunch of stuff including the new selector matcher and some tests and also fixed a bug in the applicability filter` (too long, mixed scope)
- `Fix bug.` (uppercase, period, no context)
- `WIP` (no type)
- `feat: :sparkles: add selector` (emoji)
