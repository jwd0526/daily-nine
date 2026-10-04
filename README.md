# daily nine

a daily golf game. every day (utc) everyone plays the same procedurally generated nine-hole course.

## develop

```
npm install
npm run dev          # http://localhost:5173, courses generated on the fly
```

- `?dev`: generation viewer, all nine holes for any date (works locally and on the hosted site). its "play" link opens that date. unpublished dates are generated in the browser.
- `npm run lint`, `npm run typecheck`, `npm test`
- `npm run batch -- 365`: generator health stats across many dates.

## hosting

the site is fully static. courses are deterministic, so they're pre-generated as `courses/YYYY-MM-DD.json` and the client loads today's file.

`npm run build` builds the client into `packages/client/dist` and writes the last 30 days of courses into `dist/courses`.

### github pages

1. in the repo: settings, pages, build and deployment, source: github actions.
2. the `Deploy` workflow runs daily at 00:05 utc to publish the new course. run it by hand from the actions tab to deploy changes. it does not run on push.

github pauses scheduled workflows after 60 days with no repo activity. re-enable it in the actions tab if that happens.

## layout

- `packages/gen`: deterministic course generator, physics, validator bot (shared).
- `packages/client`: vite + canvas game.
- `packages/tools`: batch stats and the static course builder.
