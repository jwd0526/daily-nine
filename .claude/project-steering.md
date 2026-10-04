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

## deploy

- `.github/workflows/deploy.yml` runs on a daily schedule (new course after midnight utc) and by manual dispatch. never on push, so commits and history rewrites don't trigger it.
- changes to generation or physics change which holes get accepted, so published courses shift. that's expected.
