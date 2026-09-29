import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateCourse, isValidDate, GEN_VERSION, type Course } from '@golf/gen';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const cacheDir = path.join(root, 'data/courses');
const clientDist = path.join(root, 'packages/client/dist');
const PORT = Number(process.env.PORT ?? 8787);

/** The server's notion of "today": UTC, so everyone worldwide plays the same course. */
const todayUtc = () => new Date().toISOString().slice(0, 10);

const memory = new Map<string, Course>();
const pending = new Map<string, Promise<Course>>();

async function getCourse(date: string): Promise<Course> {
  const cached = memory.get(date);
  if (cached) return cached;
  const inflight = pending.get(date);
  if (inflight) return inflight;

  const p = (async () => {
    const file = path.join(cacheDir, `${GEN_VERSION}-${date}.json`);
    let course: Course;
    if (existsSync(file)) {
      course = JSON.parse(await readFile(file, 'utf8'));
    } else {
      course = generateCourse(date);
      await mkdir(cacheDir, { recursive: true });
      await writeFile(file, JSON.stringify(course));
    }
    memory.set(date, course);
    return course;
  })().finally(() => pending.delete(date));
  pending.set(date, p);
  return p;
}

const app = new Hono();

app.get('/api/today', (c) => c.json({ date: todayUtc() }));

app.get('/api/course/:date?', async (c) => {
  const today = todayUtc();
  const date = c.req.param('date') ?? today;
  if (!isValidDate(date)) return c.json({ error: 'Invalid date' }, 400);
  // No peeking at future courses.
  if (date > today) return c.json({ error: 'Not available yet' }, 404);
  const course = await getCourse(date);
  c.header('Cache-Control', date === today ? 'public, max-age=300' : 'public, max-age=86400');
  return c.json(course);
});

if (process.env.NODE_ENV === 'production' && existsSync(clientDist)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), clientDist) }));
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`golf server on http://localhost:${PORT} (today = ${todayUtc()})`);
  // Warm today's course so the first player doesn't wait.
  getCourse(todayUtc()).catch((e) => console.error(e));
});
