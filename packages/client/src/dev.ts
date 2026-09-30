// Dev viewer: render all nine holes of any date with design overlays (skeleton, landing zones).

import { generateCourse, validateHole, Rng } from '@golf/gen';
import { Renderer, fitCamera } from './render.ts';

export class DevViewer {
  constructor(private root: HTMLElement, private date: string) {
    root.classList.add('dev');
    this.render();
  }

  private shift(days: number) {
    const d = new Date(`${this.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    this.date = d.toISOString().slice(0, 10);
    history.replaceState(null, '', `?dev&date=${this.date}`);
    this.render();
  }

  private render() {
    const t = performance.now();
    const course = generateCourse(this.date);
    const ms = Math.round(performance.now() - t);
    this.root.innerHTML = '';

    const bar = document.createElement('div');
    bar.className = 'dev-bar';
    const prev = Object.assign(document.createElement('button'), { textContent: '← prev' });
    const next = Object.assign(document.createElement('button'), { textContent: 'next →' });
    const input = Object.assign(document.createElement('input'), { type: 'date', value: this.date });
    prev.onclick = () => this.shift(-1);
    next.onclick = () => this.shift(1);
    input.onchange = () => { this.date = input.value; this.shift(0); };
    const info = document.createElement('span');
    info.innerHTML = `<b>${course.name}</b> · ${course.biome} · ${course.style.theme} · par ${course.par} · ${ms}ms`;
    const play = Object.assign(document.createElement('a'), { href: `?date=${this.date}`, textContent: 'play' });
    bar.append(prev, input, next, info, play);
    this.root.append(bar);

    const grid = document.createElement('div');
    grid.className = 'dev-grid';
    this.root.append(grid);

    for (const hole of course.holes) {
      const cell = document.createElement('div');
      cell.className = 'dev-hole';
      const canvas = document.createElement('canvas');
      const meta = document.createElement('div');
      meta.className = 'meta';
      const v = validateHole(hole, new Rng(`dev|${this.date}|${hole.number}`));
      meta.innerHTML =
        `<b>#${hole.number}</b> ${hole.archetype ?? ''} · par ${hole.par} · ${hole.yards}y · d${hole.difficulty} · ` +
        `try ${hole.attempts || 'fallback'} · bot ${v.mean?.toFixed(2) ?? `(re-check: ${v.reasons[0]})`}<br/>` +
        `${hole.features.join(', ') || 'no features'} · wind ${hole.wind.mph}mph · ${hole.trees.length} trees`;
      cell.append(canvas, meta);
      grid.append(cell);

      requestAnimationFrame(() => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const r = new Renderer(ctx, rect.width, rect.height);
        r.draw(hole, course.biome, fitCamera(hole.bounds, rect.width, rect.height, 0), { debug: true });
      });
    }
  }
}
