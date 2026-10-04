# project steering

project-specific conventions for daily nine.

## commands

- `npm run lint`: eslint over all packages.
- `npm run typecheck`: tsc, no emit.
- `npm test`: vitest.
- `npm run batch -- 365`: generator health stats across many dates. run after changing generation or physics.
- `npm run dev`: vite on localhost:5173, courses generated on the fly.

## before every commit

- run lint, typecheck, and tests. write tests for the change first. the user will say if a change doesn't need them.

## tests

- colocated: `foo.test.ts` next to `foo.ts`. no separate test folders.

## branches

- never commit directly to main. every change happens on a branch named `<type>/<short-description>`, using the conventional commit type (e.g. `feat/putt-preview`, `fix/tree-clip`), and merges into main through a pull request.

## ci and deploy

- `.github/workflows/ci.yml` runs lint, typecheck, tests and build on every pull request and every push to main.
- only main deploys to github pages: on push (i.e. merging a pr), on the daily schedule after midnight utc (new course), and by manual dispatch (`gh workflow run ci.yml`). pull requests never deploy.
- changes to generation or physics change which holes get accepted, so published courses shift. that's expected.
