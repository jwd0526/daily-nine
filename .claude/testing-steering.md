# testing steering

how tests get written, where they live, and when they run.

## when to write a test

- new feature: write tests alongside the code, in the same commit. no feature ships without at least one test that exercises its main path.
- bug fix: write the test *first*. it should fail against the broken code and pass against the fix. this is a regression test and it stays forever.
- refactor: existing tests must keep passing. if they don't, the refactor changed behavior. either the refactor is wrong or the tests are.
- exploratory or throwaway code: no tests required. delete when done.

## what to test

- behavior, not implementation. tests should survive an internal refactor.
- boundaries and edge cases: empty inputs, nil, zero, off-by-one, missing keys, unicode, negative values, max-size inputs.
- the case that just burned you. if a bug slipped through, the test that catches it is more valuable than three tests for the happy path.
- explicit failure modes: what does the code do when the input is invalid, and is that what the caller expects.

## what not to test

- language or framework internals.
- private implementation details unless they encode a real invariant that a caller depends on.
- getters, setters, or trivial one-line pass-throughs.

## layout

- colocate tests with the code under test when the language supports it (go: same directory, same package, `_test.go` suffix; javascript/typescript: `.test.ts` next to the source; python: `test_foo.py` alongside `foo.py` unless the project uses a top-level `tests/`).
- one test file per source file is a good default. split when the file gets unwieldy.
- follow the project's existing convention before inventing a new one.

## style

- table-driven tests when several inputs exercise the same code path. name each case so a failure message tells you which one broke.
- one behavior per test. do not chain unrelated assertions.
- assertions should say what is expected, not just that something is truthy. `got == want` beats `assert(x)`.
- shared fixtures built once and reused. assert on structure and specific expected members, not just length.
- deterministic. no wall-clock time, no unseeded randomness, no dependence on test execution order. inject clocks and rngs at the boundary.

## fakes, mocks, and real dependencies

- prefer the real thing when it is fast and deterministic (in-memory database, temp filesystem, local process).
- mock only at real system boundaries: external network calls, third-party apis, wall clock, randomness.
- do not mock the thing under test. do not mock so much that the test only proves the mocks agree with each other.
- integration tests hit real dependencies (real database, real process). unit tests do not need to.

## running tests

- tests must pass before every commit. see `.claude/commits-steering.md`.
- a failing test blocks the commit. do not delete or skip a failing test to unblock. investigate: is the code wrong, or is the test wrong. fix the actual problem.
- if a test is flaky (passes and fails on the same code), it is broken. fix the flake or delete the test. do not retry-loop around it.

## coverage

- coverage numbers are not the goal. covering the *right* lines is.
- if a change adds a new branch, the branch has a test. if it adds a new error path, the error path has a test.
- do not chase 100%. do not accept 0% on new code.
