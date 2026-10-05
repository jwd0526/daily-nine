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

## rendering

- the renderer caches the static scene (terrain, fade) and only repaints it when the view changes. anything that changes terrain pixels has to be part of `sceneCurrent` in `render.ts`, or it goes stale. per-frame things (pin, aim, trail, ball) belong in `drawForeground`.
- the cache keys on camera values, so the camera has to settle exactly (`stepCamera` snaps once the move is sub-pixel).
- phones are the slow case. canvas density is capped at 2x (`MAX_DPR` in `game.ts`) and the ui avoids `backdrop-filter`, since both cost a lot of fill rate on phones for little visible gain.
- check render changes at phone size and 3x density with a throttled cpu, not just the laptop at full speed.

## branches

- never commit directly to main. every change happens on a branch named `<type>/<short-description>`, using the conventional commit type (e.g. `feat/putt-preview`, `fix/tree-clip`), and merges into main through a pull request.

## ci and deploy

- `.github/workflows/ci.yml` runs lint, typecheck, tests and build on every pull request and every push to main.
- only main deploys to github pages: on push (i.e. merging a pr), on the daily schedule after midnight utc (new course), and by manual dispatch (`gh workflow run ci.yml`). pull requests never deploy.
- changes to generation or physics change which holes get accepted, so published courses shift. that's expected.
