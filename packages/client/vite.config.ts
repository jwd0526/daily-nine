import { defineConfig, type Plugin } from 'vite';

/** In dev, serve courses/<date>.json by generating on the fly (production uses pre-built files). */
function devCourses(): Plugin {
  return {
    name: 'dev-courses',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/\/courses\/(\d{4}-\d{2}-\d{2})\.json$/);
        if (!m) return next();
        // loaded through vite on each request so generator edits apply without a restart
        const { generateCourse, isValidDate } = (await server.ssrLoadModule('@golf/gen')) as typeof import('@golf/gen');
        if (!isValidDate(m[1])) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(generateCourse(m[1])));
      });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any path (e.g. GitHub Pages at /<repo>/).
  base: './',
  plugins: [devCourses()],
  server: { port: 5173 },
});
