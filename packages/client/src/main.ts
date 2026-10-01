import './style.css';
import type { Course } from '@golf/gen';
import { Game } from './game.ts';

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);

/**
 * Tiempos Headline is licensed (Klim): drop the files into public/assets/fonts/tiempos/ to use it,
 * otherwise the CSS stack falls back to Source Serif 4. Loaded from JS so the URL is relative to
 * the page and works when the site is served from a subpath (e.g. GitHub Pages).
 */
function loadHeadlineFont() {
  const base = new URL('assets/fonts/tiempos/TiemposHeadline-Regular', document.baseURI).href;
  const face = new FontFace('Tiempos Headline', `url(${base}.woff2) format("woff2"), url(${base}.ttf) format("truetype")`);
  face.load().then(
    (f) => (document.fonts as unknown as Set<FontFace>).add(f),
    () => { /* not installed: use the fallback serif */ },
  );
}
loadHeadlineFont();

const utcDate = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function loadCourse(date: string): Promise<Course | undefined> {
  const res = await fetch(`courses/${date}.json`, { cache: 'no-cache' });
  return res.ok ? res.json() : undefined;
}

/** For an explicit ?date= that isn't published (e.g. opened from the dev viewer), build it here. */
async function generateLocally(date: string): Promise<Course | undefined> {
  const { generateCourse, isValidDate } = await import('@golf/gen');
  return isValidDate(date) ? generateCourse(date) : undefined;
}

async function boot() {
  if (params.has('dev')) {
    // The dev viewer generates locally so you can scrub any date, including the future.
    // (Enabled in hosted builds too, for now.)
    const { DevViewer } = await import('./dev.ts');
    new DevViewer(app, params.get('date') ?? utcDate());
    return;
  }
  const requested = params.get('date');
  try {
    // Everyone plays the course for today's UTC date. Right after midnight the new file may not be
    // published yet, so fall back to yesterday's course for a few minutes.
    const course = requested
      ? (await loadCourse(requested)) ?? (await generateLocally(requested))
      : (await loadCourse(utcDate())) ?? (await loadCourse(utcDate(-1)));
    if (!course) throw new Error(requested ? `No course for ${requested}` : 'Course not available yet');
    document.title = `Daily Nine · ${course.name}`;
    const game = new Game(app, course);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  } catch (e) {
    app.innerHTML = `<div class="error">Couldn't load today's course.<br/><small>${(e as Error).message}</small></div>`;
  }
}

boot();
