import { defineConfig, type Plugin } from 'vite';
import { generateCourse, isValidDate } from '@golf/gen';

/** In dev, serve courses/<date>.json by generating on the fly (production uses pre-built files). */
function devCourses(): Plugin {
  return {
    name: 'dev-courses',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/courses\/(\d{4}-\d{2}-\d{2})\.json$/);
        if (!m || !isValidDate(m[1])) return next();
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
