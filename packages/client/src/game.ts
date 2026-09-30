import {
  CLUBS, clubForDistance, sprayRadius, windDrift, lieCarryFactor, nearestOnCenterline, puttsFor, resolveShot, simulateShot, surfaceAt,
  geom, type Club, type Course, type Hole, type ShotResult, type Surface, type Vec,
} from '@golf/gen';
import { Renderer, fitCamera, type Camera } from './render.ts';

type Phase = 'aim' | 'power' | 'flight' | 'holed' | 'done';

interface Saved {
  holeIdx: number;
  scores: (number | null)[];
  ball: Vec;
  strokes: number;
}

const MAX_POWER = 1.1;

// Power meter motion: nearly constant speed up to 95%, a sharp ramp over the last 5%,
// then considerably faster through the overswing zone (and the same curve back down).
const POWER_HALF_PERIOD = 0.95; // seconds for 0 → max
const FLAT_START = 0.95; // speed multiplier at 0%
const FLAT_END = 1.05; // speed multiplier at 95%
const RAMP_FROM = 0.95; // where the sharp ramp begins
const OVER_SPEED = 1.8; // speed multiplier past 100%

function powerSpeed(p: number): number {
  if (p < RAMP_FROM) return FLAT_START + (FLAT_END - FLAT_START) * (p / RAMP_FROM);
  if (p < 1) {
    const u = (p - RAMP_FROM) / (1 - RAMP_FROM);
    return FLAT_END + (OVER_SPEED - FLAT_END) * u * u;
  }
  return OVER_SPEED;
}

/** Power as a function of time over one 0 → max trip, precomputed by integrating powerSpeed. */
const POWER_TABLE: number[] = (() => {
  const steps: { t: number; p: number }[] = [{ t: 0, p: 0 }];
  for (let p = 0, t = 0, dp = 0.0005; p < MAX_POWER; ) {
    t += dp / powerSpeed(p + dp / 2);
    p = Math.min(MAX_POWER, p + dp);
    steps.push({ t, p });
  }
  const total = steps[steps.length - 1].t;
  const N = 600;
  const table: number[] = [];
  for (let i = 0, j = 0; i <= N; i++) {
    const t = (i / N) * total;
    while (j < steps.length - 1 && steps[j + 1].t < t) j++;
    const a = steps[j], b = steps[Math.min(j + 1, steps.length - 1)];
    table.push(a.p + (b.p - a.p) * ((t - a.t) / (b.t - a.t || 1)));
  }
  return table;
})();
const LIE_NAMES: Record<Surface, string> = {
  tee: 'Tee', fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker', waste: 'Waste area', water: 'Water',
  green: 'Green', fringe: 'Fringe', trees: 'Trees', ob: 'Out of bounds',
};

function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  return ({ [-3]: 'Albatross!', [-2]: 'Eagle!', [-1]: 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' } as Record<number, string>)[d] ?? `+${d}`;
}

const toPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

export class Game {
  private holeIdx = 0;
  private scores: (number | null)[] = Array(9).fill(null);
  private ball: Vec = { x: 0, y: 0 };
  private strokes = 0;
  private phase: Phase = 'aim';
  private club: Club = CLUBS[0];

  private aimCenter = 0;
  /** Sweep phase in radians, advanced every frame so re-aiming or changing clubs never restarts it. */
  private aimPhase = Math.PI / 2;
  /** Cone center as drawn: eases toward aimCenter so clicking a new spot glides instead of snapping. */
  private aimCenterShown = 0;
  private lastFrame = 0;
  /** Shot length and reticle size as drawn: they ease toward the club's values so switching clubs animates. */
  private shownDist = 0;
  private shownSpray = 0;
  private lockedHeading = 0;
  private powerStart = 0;
  private power = 0;

  private shot?: { result: ShotResult; start: number; from: Vec };
  private ballHeight = 0;
  /** True while the pointer is held down on the course, steering the aim. */
  private aiming = false;
  /** Shot view: zoomed in on the current shot. Off shows the whole hole. */
  private shotView = false;

  private cam: Camera = { cx: 0, cy: 0, k: 1 };
  private camTarget: Camera = { cx: 0, cy: 0, k: 1 };

  // DOM
  private canvas!: HTMLCanvasElement;
  private renderer!: Renderer;
  private stage!: HTMLDivElement;
  private els: Record<string, HTMLElement> = {};
  private clubButtons = new Map<string, HTMLButtonElement>();
  private toastTimer = 0;

  constructor(private root: HTMLElement, private course: Course) {
    this.buildDom();
    this.restore();
    this.startShot(true);
    this.resize();
    this.cam = { ...this.camTarget };
    new ResizeObserver(() => this.resize()).observe(this.stage);
    requestAnimationFrame(this.frame);
  }

  private get hole(): Hole { return this.course.holes[this.holeIdx]; }
  private get storageKey() { return `daily-nine:${this.course.version}:${this.course.date}`; }

  // ---------------------------------------------------------------- persistence

  private restore() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) { this.ball = { ...this.hole.tee }; return; }
      const s: Saved = JSON.parse(raw);
      this.holeIdx = s.holeIdx;
      this.scores = s.scores;
      this.ball = s.ball;
      this.strokes = s.strokes;
      if (this.scores.every((x) => x !== null)) this.phase = 'done';
      else if (this.scores[this.holeIdx] !== null) {
        // Reloaded on the "hole complete" screen: move on to the next hole.
        this.holeIdx++;
        this.strokes = 0;
        this.ball = { ...this.hole.tee };
      }
    } catch {
      this.ball = { ...this.hole.tee };
    }
  }

  private save() {
    try {
      const s: Saved = { holeIdx: this.holeIdx, scores: this.scores, ball: this.ball, strokes: this.strokes };
      localStorage.setItem(this.storageKey, JSON.stringify(s));
    } catch { /* storage unavailable: progress just isn't kept */ }
  }

  // ---------------------------------------------------------------- DOM

  private buildDom() {
    const r = this.root;
    r.innerHTML = '';
    const header = h('div', 'header');
    header.append(h('h1', '', 'Daily Nine'), (this.els.course = h('div', 'course', this.course.name)), (this.els.total = h('div', 'total', 'E')));
    r.append(header);

    const card = h('div', 'card');
    this.els.card = card;
    r.append(card);

    this.stage = h('div', 'stage');
    this.canvas = h('canvas');
    this.stage.append(this.canvas);
    this.els.tl = h('div', 'hud tl');
    this.els.tr = h('div', 'hud tr');
    this.els.bl = h('div', 'hud bl');
    this.els.toast = h('div', 'toast');
    this.stage.append(this.els.tl, this.els.tr, this.els.bl, this.els.toast);
    r.append(this.stage);

    const controls = h('div', 'controls');
    const clubs = h('div', 'clubs');
    for (const c of CLUBS) {
      const b = h('button', 'club', `<div class="id">${c.id}</div><div class="yd"></div>`);
      b.onclick = () => this.selectClub(c);
      this.clubButtons.set(c.id, b);
      clubs.append(b);
    }
    const meter = h('div', 'meter');
    meter.append(
      (this.els.fill = h('div', 'fill')),
      (this.els.over = h('div', 'over')),
      (this.els.pinMark = h('div', 'pin')),
      (this.els.needle = h('div', 'needle')),
    );
    const labels = h('div', 'meter-labels', '<span class="ease-label">EASE</span><span class="pin-label">PIN</span><span class="over-label">OVER</span>');
    this.els.pinLabel = labels.querySelector('.pin-label')!;
    this.els.easeLabel = labels.querySelector('.ease-label')!;
    this.els.overLabel = labels.querySelector('.over-label')!;
    const swing = h('button', 'swing', 'Set line');
    swing.onclick = () => this.action();
    this.els.swing = swing;
    this.els.hint = h('div', 'hint');
    controls.append(clubs, meter, labels, swing, this.els.hint);
    r.append(controls);

    this.renderer = new Renderer(this.canvas.getContext('2d')!, 1, 1);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
  }

  private resize() {
    const rect = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.w = rect.width;
    this.renderer.h = rect.height;
    this.updateCamera();
  }

  private renderCard() {
    const card = this.els.card;
    card.innerHTML = '';
    this.course.holes.forEach((hole, i) => {
      const s = this.scores[i];
      const cls = s === null ? '' : s < hole.par ? 'under' : s > hole.par ? 'over' : '';
      const cell = h('div', `cell${i === this.holeIdx && this.phase !== 'done' ? ' current' : ''}`,
        `<div class="num">${i + 1}</div><div class="score ${cls}">${s ?? '·'}</div><div class="par">${hole.par}</div>`);
      card.append(cell);
    });
    let diff = 0;
    this.scores.forEach((s, i) => { if (s !== null) diff += s - this.course.holes[i].par; });
    this.els.total.textContent = toPar(diff);
  }

  private renderHud() {
    const hole = this.hole;
    const lie = surfaceAt(hole, this.ball);
    const toPin = Math.round(geom.dist(this.ball, hole.pin));
    const chips = hole.tags.map((t) => `<span class="chip">${t}</span>`).join('');
    this.els.tl.innerHTML =
      `<div class="label">Hole ${hole.number} · Par ${hole.par}</div>` +
      `<div class="big">${hole.yards} <small>YDS</small></div>` +
      (chips ? `<div class="chips">${chips}</div>` : '');
    const deg = (hole.wind.dir * 180) / Math.PI;
    this.els.tr.innerHTML =
      `<div class="label">Wind</div><div class="big wind">` +
      (hole.wind.mph > 0
        ? `<svg viewBox="0 0 24 24" style="transform: rotate(${deg}deg)"><path d="M12 3 L12 21 M12 3 L6 9 M12 3 L18 9" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`
        : '') +
      `${hole.wind.mph} <small>MPH</small></div>`;
    this.els.bl.innerHTML =
      `<div class="label">${LIE_NAMES[lie]} · Shot ${this.strokes + 1}</div>` +
      `<div class="big">${toPin} <small>YDS TO PIN</small></div>`;
  }

  private renderClubs() {
    const lie = surfaceAt(this.hole, this.ball);
    for (const c of CLUBS) {
      const b = this.clubButtons.get(c.id)!;
      b.classList.toggle('selected', c.id === this.club.id);
      b.disabled = this.phase !== 'aim';
      const yd = Math.round(c.carry * lieCarryFactor(lie, c));
      (b.querySelector('.yd') as HTMLElement).textContent = String(yd);
    }
  }

  private toast(text: string, sub = '', ms = 1600) {
    const t = this.els.toast;
    t.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- shot flow

  /** Distance a 100% swing of the current club travels from this lie. */
  private targetDistance(club = this.club) {
    return club.carry * lieCarryFactor(surfaceAt(this.hole, this.ball), club);
  }

  private startShot(autoClub: boolean) {
    if (this.phase === 'done') { this.showDone(); this.renderCard(); return; }
    const hole = this.hole;
    const lie = surfaceAt(hole, this.ball);
    const toPin = geom.dist(this.ball, hole.pin);
    if (autoClub) {
      if (lie === 'tee' && hole.par > 3) this.club = CLUBS[0];
      else this.club = clubForDistance(toPin * 0.97, lieCarryFactor(lie, CLUBS[0]));
    }
    this.aimCenter = this.defaultAim();
    this.aimCenterShown = this.aimCenter;
    this.aimPhase = Math.PI / 2;
    // A new shot snaps to the club's numbers; only club switches animate.
    this.shownDist = this.targetDistance();
    this.shownSpray = sprayRadius(this.club, geom.dist(this.ball, this.hole.pin));
    this.phase = 'aim';
    // Tee shots show the whole hole; every shot after that zooms in on the shot.
    this.shotView = this.strokes > 0;
    this.renderHud();
    this.renderCard();
    this.renderClubs();
    this.updateControls();
    this.updateCamera();
  }

  /** Aim at the pin if this club gets there, else at the next landing zone. */
  private defaultAim(): number {
    const hole = this.hole;
    const reach = this.targetDistance() + 25;
    let target = hole.pin;
    if (geom.dist(this.ball, hole.pin) > reach) {
      const sBall = nearestOnCenterline(hole.centerline, this.ball).s;
      target = hole.skeleton.slice(1, -1).find((p) => nearestOnCenterline(hole.centerline, p).s > sBall + 30) ?? hole.pin;
    }
    return geom.headingOf(geom.sub(target, this.ball));
  }

  private selectClub(c: Club) {
    if (this.phase !== 'aim') return;
    this.club = c;
    this.renderClubs();
    this.updateControls();
    this.updateCamera();
  }

  private coneHalf() {
    return (this.club.cone * Math.PI) / 180;
  }

  private aimHeading() {
    const half = this.coneHalf();
    return this.aimCenterShown + half * Math.sin(this.aimPhase);
  }

  private powerAt(now: number) {
    // Ping-pong: mirror the second half so the return trip is the same curve.
    let t = ((now - this.powerStart) / 1000) % (2 * POWER_HALF_PERIOD);
    if (t > POWER_HALF_PERIOD) t = 2 * POWER_HALF_PERIOD - t;
    const x = (t / POWER_HALF_PERIOD) * (POWER_TABLE.length - 1);
    const i = Math.min(POWER_TABLE.length - 2, Math.floor(x));
    return POWER_TABLE[i] + (POWER_TABLE[i + 1] - POWER_TABLE[i]) * (x - i);
  }

  /** The meter fraction that sends the ball to the pin. */
  private pinFraction() {
    const d = geom.dist(this.ball, this.hole.pin);
    return d / (this.targetDistance() * (1 + this.club.roll * 0.6));
  }

  private action() {
    const now = performance.now();
    if (this.phase === 'aim') {
      this.lockedHeading = this.aimHeading();
      this.phase = 'power';
      this.powerStart = now;
      this.updateControls();
      this.renderClubs();
    } else if (this.phase === 'power') {
      this.power = this.powerAt(now);
      this.hit();
    }
  }

  private hit() {
    const from = { ...this.ball };
    const result = simulateShot(this.hole, {
      from, heading: this.lockedHeading, club: this.club, power: this.power,
    });
    this.shot = { result, start: performance.now(), from };
    this.phase = 'flight';
    this.updateControls();
  }

  private finishShot() {
    const { result, from } = this.shot!;
    this.shot = undefined;
    this.ballHeight = 0;
    this.strokes++;
    const hole = this.hole;

    if (result.outcome === 'holed') {
      this.ball = { ...hole.pin };
      this.completeHole(this.strokes);
      return;
    }
    const res = resolveShot(hole, from, result);
    this.strokes += res.penalty;
    this.ball = res.next;
    if (res.message) this.toast(res.message, `+${res.penalty} stroke`);
    else if (result.hitTree) this.toast('Clipped the trees');

    // On the green the putts are automatic: the ring the ball stopped in decides them.
    if (surfaceAt(hole, this.ball) === 'green') {
      const putts = puttsFor(hole, this.ball);
      this.strokes += putts;
      this.toast(putts === 1 ? 'One putt' : `${putts} putts`, `+${putts}`);
      this.completeHole(Math.min(this.strokes, hole.par + 4));
      return;
    }

    if (this.strokes >= hole.par + 4) {
      this.toast('Picked up', `Max score ${hole.par + 4}`);
      this.completeHole(hole.par + 4, true);
      return;
    }
    this.save();
    this.startShot(true);
  }

  private completeHole(score: number, pickedUp = false) {
    this.scores[this.holeIdx] = score;
    this.phase = 'holed';
    this.renderCard();
    this.updateControls();
    const name = pickedUp ? 'Picked up' : scoreName(score, this.hole.par);
    const last = this.holeIdx === 8;
    const ov = h('div', 'overlay',
      `<h2>${name}</h2><div class="result">${score}</div><p>HOLE ${this.hole.number} · PAR ${this.hole.par}</p>`);
    const next = h('button', '', last ? 'See scorecard' : `Hole ${this.hole.number + 1} →`);
    next.onclick = () => {
      ov.remove();
      if (last) {
        this.phase = 'done';
        this.save();
        this.startShot(false);
        return;
      }
      this.holeIdx++;
      this.strokes = 0;
      this.ball = { ...this.hole.tee };
      this.save();
      this.startShot(true);
      this.cam = { ...this.camTarget };
    };
    ov.append(next);
    this.stage.append(ov);
    this.save();
  }

  private showDone() {
    this.stage.querySelector('.overlay')?.remove();
    const total = this.scores.reduce<number>((a, b) => a + (b ?? 0), 0);
    const diff = total - this.course.par;
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const mins = Math.max(0, Math.round((next - now.getTime()) / 60000));
    const ov = h('div', 'overlay',
      `<p>${this.course.name.toUpperCase()}</p><h2>Round complete</h2>` +
      `<div class="result">${total} <span style="font-size:24px">(${toPar(diff)})</span></div>` +
      `<p>NEW COURSE IN ${Math.floor(mins / 60)}H ${mins % 60}M</p>`);
    const share = h('button', 'ghost', 'Copy result');
    share.onclick = async () => {
      const marks = this.scores.map((s, i) => {
        const d = (s ?? 0) - this.course.holes[i].par;
        return d < 0 ? '🟢' : d === 0 ? '⚪' : d === 1 ? '🟠' : '🔴';
      }).join('');
      const text = `Daily Nine · ${this.course.name} · ${this.course.date}\n${total} (${toPar(diff)}) ${marks}`;
      try { await navigator.clipboard.writeText(text); share.textContent = 'Copied!'; } catch { share.textContent = text; }
    };
    ov.append(share);
    this.stage.append(ov);
    this.updateControls();
  }

  private updateControls() {
    const swing = this.els.swing as HTMLButtonElement;
    const hint = this.els.hint;
    swing.disabled = this.phase !== 'aim' && this.phase !== 'power';
    swing.textContent = this.phase === 'power' ? 'Swing' : 'Set line';
    if (this.phase === 'aim') hint.textContent = 'Tap the course to aim · set the line on target';
    else if (this.phase === 'power') {
      const pf = this.pinFraction();
      hint.textContent = pf <= 1 ? `Stop at the pin marker (${Math.round(pf * 100)}%)` : 'Pin is out of range. Full power';
    } else hint.textContent = '';

    const pf = this.pinFraction();
    // Pin marker and label sit where the pin actually is, only if this club can reach it.
    const pinPct = (pf / MAX_POWER) * 100;
    const inRange = pf <= 1;
    this.els.pinMark.style.left = `calc(${pinPct}% - 1.5px)`;
    this.els.pinMark.style.display = inRange ? '' : 'none';
    this.els.pinLabel.style.left = `${pinPct}%`;
    this.els.pinLabel.style.display = inRange ? '' : 'none';
    // Make room for PIN when it sits near either end of the bar.
    this.els.easeLabel.style.visibility = inRange && pinPct < 14 ? 'hidden' : '';
    this.els.overLabel.style.visibility = inRange && pinPct > 80 ? 'hidden' : '';
    this.els.over.style.left = `${(1 / MAX_POWER) * 100}%`;
  }

  // ---------------------------------------------------------------- camera

  /**
   * Shot view off: the whole hole. Shot view on: either the whole aim cone (with its landing
   * zone) or the ball-to-pin view (with the green), whichever is tighter, plus some margin.
   */
  private updateCamera() {
    const hole = this.hole;
    const { w, h: hh } = this.renderer;
    if (w < 2) return;
    if (!this.shotView) {
      // Whole hole, with the bottom strip (labels) kept clear of the tee.
      const first = fitCamera(hole.bounds, w, hh, 4);
      this.camTarget = fitCamera({ ...hole.bounds, minY: hole.bounds.minY - 50 / first.k }, w, hh, 4);
      return;
    }
    const ball = this.ball;
    const MARGIN = 18; // yards around whatever is framed (clear of the HUD labels)
    const MIN_SPAN = 36; // never zoom in tighter than this many yards
    const BOTTOM_RESERVE_PX = 70;
    const TOP_RESERVE_PX = 45; // hole and wind labels

    const dist = this.targetDistance();
    const half = this.coneHalf();
    const along = (h: number) => geom.add(ball, geom.scale(geom.dirFromHeading(h), dist));
    const end = along(this.aimCenter);
    const spray = sprayRadius(this.club, geom.dist(ball, hole.pin));
    const conePts: Vec[] = [
      ball, along(this.aimCenter - half), along(this.aimCenter + half),
      { x: end.x - spray, y: end.y - spray }, { x: end.x + spray, y: end.y + spray },
    ];
    const pinPts: Vec[] = [ball, hole.pin, ...hole.green.poly];

    const frame = (pts: Vec[]) => {
      const b = geom.bounds(pts);
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      const hx = Math.max(MIN_SPAN / 2, (b.maxX - b.minX) / 2);
      const hy = Math.max(MIN_SPAN / 2, (b.maxY - b.minY) / 2);
      const box = { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy };
      // Keep the top and bottom strips (labels) clear of what's framed.
      const first = fitCamera(box, w, hh, MARGIN);
      return fitCamera({ ...box, minY: box.minY - BOTTOM_RESERVE_PX / first.k, maxY: box.maxY + TOP_RESERVE_PX / first.k }, w, hh, MARGIN);
    };
    const cone = frame(conePts), toPin = frame(pinPts);
    // Larger scale = tighter view.
    this.camTarget = cone.k >= toPin.k ? cone : toPin;
  }

  /**
   * During a shot, zoom out (never in) so a ball heading off screen stays visible,
   * unless it's out of bounds, which isn't worth chasing.
   */
  private keepBallInView(ball: Vec & { h?: number }) {
    if (surfaceAt(this.hole, ball) === 'ob') return;
    const { w, h } = this.renderer;
    const t = this.camTarget;
    const PAD_PX = 36;
    // The ball is drawn lifted by its height, so keep both the ball and its shadow in view.
    const lifted = { x: ball.x, y: ball.y + (ball.h ?? 0) * 0.6 };
    const halfW = w / (2 * t.k), halfH = h / (2 * t.k), pad = PAD_PX / t.k;
    const inView = (p: Vec) =>
      Math.abs(p.x - t.cx) <= halfW - pad && Math.abs(p.y - t.cy) <= halfH - pad;
    if (inView(ball) && inView(lifted)) return;
    const b = geom.bounds([
      { x: t.cx - halfW, y: t.cy - halfH }, { x: t.cx + halfW, y: t.cy + halfH }, ball, lifted,
    ]);
    const next = fitCamera(b, w, h, PAD_PX / t.k + 6);
    this.camTarget = { ...next, k: Math.min(next.k, t.k) };
  }

  // ---------------------------------------------------------------- input

  /** Clicking (or dragging) on the course points the center of the aim cone at that spot. */
  private aimAt(e: PointerEvent) {
    const p = this.renderer.toWorld(e.offsetX, e.offsetY);
    if (geom.dist(p, this.ball) > 0.5) this.aimCenter = geom.headingOf(geom.sub(p, this.ball));
  }

  private onDown = (e: PointerEvent) => {
    if (this.phase !== 'aim') return;
    this.aiming = true;
    this.aimAt(e);
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (this.aiming) this.aimAt(e);
  };

  private onUp = () => {
    if (!this.aiming) return;
    this.aiming = false;
    this.updateCamera();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.action(); return; }
    if (this.phase !== 'aim') return;
    if (e.key === 'ArrowLeft') this.aimCenter -= 0.02;
    if (e.key === 'ArrowRight') this.aimCenter += 0.02;
    const i = CLUBS.findIndex((c) => c.id === this.club.id);
    if (e.key === 'ArrowUp' && i > 0) this.selectClub(CLUBS[i - 1]);
    if (e.key === 'ArrowDown' && i < CLUBS.length - 1) this.selectClub(CLUBS[i + 1]);
  };

  // ---------------------------------------------------------------- loop

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    if (this.phase === 'aim' || this.phase === 'power') {
      // Ease the drawn shot length and reticle toward the selected club (~0.25s).
      const ease = 1 - Math.exp(-dt * 14);
      this.shownDist += (this.targetDistance() - this.shownDist) * ease;
      this.shownSpray += (sprayRadius(this.club, geom.dist(this.ball, this.hole.pin)) - this.shownSpray) * ease;
    }
    if (this.phase === 'aim') {
      this.aimPhase = (this.aimPhase + (2 * Math.PI * dt) / this.club.sweep) % (2 * Math.PI);
      const diff = Math.atan2(Math.sin(this.aimCenter - this.aimCenterShown), Math.cos(this.aimCenter - this.aimCenterShown));
      this.aimCenterShown += diff * (1 - Math.exp(-dt * 18));
    }

    // Ease camera toward its target (zoom in log space).
    const a = 0.12;
    this.cam.cx += (this.camTarget.cx - this.cam.cx) * a;
    this.cam.cy += (this.camTarget.cy - this.cam.cy) * a;
    this.cam.k = Math.exp(Math.log(this.cam.k) + (Math.log(this.camTarget.k) - Math.log(this.cam.k)) * a);

    let ball: Vec & { h?: number } = this.ball;
    let trail;
    if (this.shot) {
      const { result, start } = this.shot;
      const path = result.path;
      const flightEnd = path.findIndex((p, i) => i > 0 && p.h === 0);
      const tFlight = flightEnd > 0 ? path[flightEnd].t : 0;
      const elapsed = (now - start) / 1000;
      // Rolls play back faster than real time.
      const t = elapsed <= tFlight ? elapsed : tFlight + (elapsed - tFlight) * 1.8;
      let i = 1;
      while (i < path.length && path[i].t < t) i++;
      if (i >= path.length) {
        this.finishShot();
      } else {
        const p0 = path[i - 1], p1 = path[i];
        const u = (t - p0.t) / (p1.t - p0.t || 1);
        ball = { x: geom.lerp(p0.x, p1.x, u), y: geom.lerp(p0.y, p1.y, u), h: geom.lerp(p0.h, p1.h, u) };
        trail = path.slice(0, i).concat([{ ...ball, h: ball.h ?? 0, t }]);
        this.keepBallInView(ball);
      }
    }

    let aim;
    let powerNow = 0;
    if (this.phase === 'aim' || this.phase === 'power') {
      const heading = this.phase === 'aim' ? this.aimHeading() : this.lockedHeading;
      aim = {
        from: this.ball, heading, dist: this.shownDist,
        cone: { center: this.aimCenterShown, half: this.coneHalf() },
        locked: this.phase === 'power',
        spray: this.shownSpray,
        label: `${Math.round(this.shownDist)}`,
        // How the wind will move a full swing, drawn off the center line.
        wind: windDrift(this.hole, this.shownDist, this.club.apex),
      };
      if (this.phase === 'power') powerNow = this.powerAt(now);
    }
    this.renderer.draw(this.hole, this.course.biome, this.cam, { ball, trail, aim });

    const shown = this.phase === 'power' ? powerNow : this.phase === 'flight' ? this.power : 0;
    const pct = (shown / MAX_POWER) * 100;
    this.els.fill.style.width = `${pct}%`;
    this.els.needle.style.left = `calc(${pct}% - 1.5px)`;
    this.els.needle.style.display = this.phase === 'power' || this.phase === 'flight' ? '' : 'none';

    requestAnimationFrame(this.frame);
  };
}
