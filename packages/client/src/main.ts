import './style.css';
import type { Course } from '@golf/gen';
import { Game } from './game.ts';

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);

async function boot() {
  if (params.has('dev')) {
    // The dev viewer generates locally so you can scrub any date, including the future.
    const { DevViewer } = await import('./dev.ts');
    new DevViewer(app, params.get('date') ?? new Date().toISOString().slice(0, 10));
    return;
  }
  const date = params.get('date');
  try {
    const res = await fetch(date ? `/api/course/${date}` : '/api/course');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    const course: Course = await res.json();
    document.title = `Daily Nine · ${course.name}`;
    const game = new Game(app, course);
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  } catch (e) {
    app.innerHTML = `<div class="error">Couldn't load today's course.<br/><small>${(e as Error).message}</small></div>`;
  }
}

boot();
