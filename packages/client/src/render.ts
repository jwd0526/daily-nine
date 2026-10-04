import type { Biome, Hole, Poly, Vec, PathPoint, SceneryKind } from '@golf/gen';
import { frameAt, fairwaySegments, fairwayWidthAt, greenGradient, greenHeight, terrainGradient, terrainHeight, TEE_BOX, PUTT_RINGS, MAX_PUTTS, GREEN_APRON, geom } from '@golf/gen';

interface Palette {
  bg: string; rough: string; fairway: string; stripe: string; fringe: string; green: string;
  sand: string; sandEdge: string; waste: string; wasteDot: string; water: string; waterEdge: string; tree: string; treeLight: string;
  scenery: Record<SceneryKind, string>;
}

const BASE_SCENERY: Record<SceneryKind, string> = {
  sea: '#86b4c6', lake: '#93bfd2', rock: '#9aa3a6', dune: '#e2d9bd', scrub: '#c9b99a', forest: '#80987a',
};

export const PALETTES: Record<Biome, Palette> = {
  parkland: {
    bg: '#b4c3a9', rough: '#a9c395', fairway: '#c3dcab', stripe: '#cbe3b4', fringe: '#b4d79a', green: '#d5ecbd',
    sand: '#f0e6c8', sandEdge: '#d8c9a0', waste: '#d9cfab', wasteDot: '#9a9a6e', water: '#8fbcd2', waterEdge: '#d3e6ee', tree: '#4c6a4f', treeLight: '#7a9a73',
    scenery: BASE_SCENERY,
  },
  links: {
    bg: '#dcd6bf', rough: '#c3caa0', fairway: '#d0ddae', stripe: '#d7e3b7', fringe: '#c3d9a0', green: '#dbebc1',
    sand: '#f2e9cc', sandEdge: '#d9caa2', waste: '#ddd3b2', wasteDot: '#8f9a6c', water: '#7fb0c4', waterEdge: '#d6e8ee', tree: '#66775a', treeLight: '#8e9e7c',
    scenery: { ...BASE_SCENERY, dune: '#e8dfc2' },
  },
  heath: {
    bg: '#c2b5b9', rough: '#b6bf9a', fairway: '#cbdbae', stripe: '#d2e1b6', fringe: '#bcd59f', green: '#d6e9bf',
    sand: '#efe5c7', sandEdge: '#d4c49c', waste: '#d6c8ad', wasteDot: '#8c7484', water: '#8db6c9', waterEdge: '#d5e5ec', tree: '#56664c', treeLight: '#84937a',
    scenery: { ...BASE_SCENERY, scrub: '#a99099' },
  },
  desert: {
    bg: '#e5d1aa', rough: '#d8cb9f', fairway: '#c7d9a3', stripe: '#cfe0ac', fringe: '#bdd69c', green: '#d1e7b6',
    sand: '#f3e3c0', sandEdge: '#d9c193', waste: '#e6d2a6', wasteDot: '#8f9a64', water: '#86b9cc', waterEdge: '#d9ebef', tree: '#6c8a5a', treeLight: '#94ad80',
    scenery: { ...BASE_SCENERY, scrub: '#d6bd8f', rock: '#c39f7a' },
  },
  alpine: {
    bg: '#c9cecb', rough: '#a8ba9d', fairway: '#c0d6ac', stripe: '#c8ddb5', fringe: '#b2d39b', green: '#d3eabd',
    sand: '#ece4cc', sandEdge: '#cdc0a0', waste: '#d5cdb5', wasteDot: '#7d8a80', water: '#8db8cc', waterEdge: '#d8e8ee', tree: '#3d584a', treeLight: '#6a8676',
    scenery: { ...BASE_SCENERY, rock: '#8e979b' },
  },
};

export interface Camera { cx: number; cy: number; k: number }

export interface Overlay {
  ball?: Vec & { h?: number };
  trail?: PathPoint[];
  aim?: { from: Vec; heading: number; dist: number; cone?: { center: number; half: number }; locked?: boolean; spray?: number; wind?: Vec; label?: string; span?: [number, number] };
  debug?: boolean;
  /** Show the green's break: height shading and downhill arrows. */
  greenBreak?: boolean;
}

export function fitCamera(b: { minX: number; minY: number; maxX: number; maxY: number }, w: number, h: number, pad = 12): Camera {
  const bw = b.maxX - b.minX + pad * 2;
  const bh = b.maxY - b.minY + pad * 2;
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, k: Math.min(w / bw, h / bh) };
}

const BREAK_CELL = 0.75;
/** Height map color at the lowest point (fades to white at the highest). */
const LOW = [46, 112, 196];
const breakCache = new WeakMap<Hole, HTMLCanvasElement>();

/** Green height shading as a tiny image (one pixel per cell), cached per hole. */
function breakImage(hole: Hole): HTMLCanvasElement {
  const cached = breakCache.get(hole);
  if (cached) return cached;
  const cell = BREAK_CELL;
  const b = geom.bounds(hole.green.poly);
  const cols = Math.ceil((b.maxX - b.minX) / cell) + 1;
  const rows = Math.ceil((b.maxY - b.minY) / cell) + 1;
  const hs = new Float32Array(cols * rows);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // Row 0 is the top of the screen (highest y).
      const h = greenHeight(hole, { x: b.minX + i * cell, y: b.maxY - j * cell });
      hs[j * cols + i] = h;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
  }
  const span = hi - lo || 1;
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const octx = off.getContext('2d')!;
  const img = octx.createImageData(cols, rows);
  for (let n = 0; n < hs.length; n++) {
    // Lowest ground is blue, highest is white.
    const t = (hs[n] - lo) / span;
    img.data[n * 4] = Math.round(LOW[0] + (255 - LOW[0]) * t);
    img.data[n * 4 + 1] = Math.round(LOW[1] + (255 - LOW[1]) * t);
    img.data[n * 4 + 2] = Math.round(LOW[2] + (255 - LOW[2]) * t);
    img.data[n * 4 + 3] = 205;
  }
  octx.putImageData(img, 0, 0);
  breakCache.set(hole, off);
  return off;
}

interface ContourImages {
  b: { minX: number; minY: number; maxX: number; maxY: number };
  cell: number;
  /** soft light/dark hillshade, always drawn */
  shade: HTMLCanvasElement;
  /** blue (low) to white (high) height map for the eye overlay; transparent where flat */
  map: HTMLCanvasElement;
}
const CONTOUR_CELL = 1.5;
const contourCache = new WeakMap<Hole, ContourImages | null>();

/** fairway contour images over the area the contours cover (one pixel per cell), cached per hole */
function contourImages(hole: Hole): ContourImages | null {
  if (contourCache.has(hole)) return contourCache.get(hole)!;
  if (!hole.contours.length) {
    contourCache.set(hole, null);
    return null;
  }
  const reach = (b: Hole['contours'][number]) => 2.5 * b.r * Math.max(1, b.sx ?? 1);
  const b = {
    minX: Math.min(...hole.contours.map((q) => q.x - reach(q))),
    maxX: Math.max(...hole.contours.map((q) => q.x + reach(q))),
    minY: Math.min(...hole.contours.map((q) => q.y - reach(q))),
    maxY: Math.max(...hole.contours.map((q) => q.y + reach(q))),
  };
  const cell = CONTOUR_CELL;
  const cols = Math.ceil((b.maxX - b.minX) / cell) + 1;
  const rows = Math.ceil((b.maxY - b.minY) / cell) + 1;
  const hs = new Float32Array(cols * rows);
  let maxAbs = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // Row 0 is the top of the screen (highest y).
      const h = terrainHeight(hole, { x: b.minX + i * cell, y: b.maxY - j * cell });
      hs[j * cols + i] = h;
      maxAbs = Math.max(maxAbs, Math.abs(h));
    }
  }
  const canvas = () => {
    const cv = document.createElement('canvas');
    cv.width = cols;
    cv.height = rows;
    return cv;
  };
  const shade = canvas(), map = canvas();
  const sctx = shade.getContext('2d')!, mctx = map.getContext('2d')!;
  const simg = sctx.createImageData(cols, rows), mimg = mctx.createImageData(cols, rows);
  const at = (i: number, j: number) => hs[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = (j * cols + i) * 4;
      // slope in image space (x right, y down); light comes from the top-left
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
      const gy = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
      const lit = (gx - gy) * 0.707; // > 0 when the ground faces the light
      const a = Math.min(0.32, Math.abs(lit) * 9);
      simg.data[n] = simg.data[n + 1] = simg.data[n + 2] = lit > 0 ? 255 : 0;
      simg.data[n + 3] = Math.round(a * 255);
      const h = at(i, j);
      const t = maxAbs ? (h / maxAbs + 1) / 2 : 0.5; // 0 lowest .. 1 highest, flat ground in the middle
      mimg.data[n] = Math.round(LOW[0] + (255 - LOW[0]) * t);
      mimg.data[n + 1] = Math.round(LOW[1] + (255 - LOW[1]) * t);
      mimg.data[n + 2] = Math.round(LOW[2] + (255 - LOW[2]) * t);
      mimg.data[n + 3] = Math.round(Math.min(1, (Math.abs(h) / (maxAbs || 1)) * 1.6) * 190);
    }
  }
  sctx.putImageData(simg, 0, 0);
  mctx.putImageData(mimg, 0, 0);
  const out = { b, cell, shade, map };
  contourCache.set(hole, out);
  return out;
}

/** How far (yards) the course fades out beyond the out-of-bounds line. */
const FADE_YARDS = 30;
const FADE_LAYERS = 28;

/** Whether canvas `filter: blur()` actually works here (not every browser supports it). */
const CANVAS_BLUR = (() => {
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 9;
    const c = cv.getContext('2d')!;
    c.filter = 'blur(2px)';
    c.fillRect(4, 4, 1, 1);
    return c.getImageData(2, 4, 1, 1).data[3] > 0;
  } catch {
    return false;
  }
})();

export class Renderer {
  /** Page background the course fades into beyond out of bounds. */
  background = '#3a6648';
  private layers = new Map<string, CanvasRenderingContext2D>();

  constructor(public ctx: CanvasRenderingContext2D, public w: number, public h: number) {}

  /** An offscreen layer matching the main canvas size and transform, cleared. */
  private layer(name: string): CanvasRenderingContext2D {
    const main = this.ctx.canvas;
    let l = this.layers.get(name);
    if (!l || l.canvas.width !== main.width || l.canvas.height !== main.height) {
      const cv = document.createElement('canvas');
      cv.width = main.width;
      cv.height = main.height;
      l = cv.getContext('2d')!;
      this.layers.set(name, l);
    }
    l.setTransform(this.ctx.getTransform());
    l.globalCompositeOperation = 'source-over';
    l.globalAlpha = 1;
    l.clearRect(0, 0, this.w, this.h);
    return l;
  }

  /** The in-play area (corridor plus green apron), grown by `extra` yards. Adds to the current path. */
  private playArea(hole: Hole, extra: number) {
    const c = this.ctx;
    const k = this.cam.k;
    this.corridor(hole, (i) => hole.centerline.ob[i] + extra);
    const r = (GREEN_APRON + extra) * k;
    for (const p of hole.green.poly) {
      c.moveTo(this.sx(p) + r, this.sy(p));
      c.arc(this.sx(p), this.sy(p), r, 0, Math.PI * 2);
    }
    this.poly(hole.green.poly);
  }

  /** Mask that keeps the play area solid and fades everything beyond it to nothing. */
  private drawFadeMask(hole: Hole) {
    const c = this.ctx;
    const k = this.cam.k;
    c.fillStyle = '#fff';
    if (CANVAS_BLUR) {
      // A blurred copy of the area grown by half the fade gives a smooth falloff outside the line.
      const dpr = c.getTransform().a;
      c.filter = `blur(${(FADE_YARDS / 2) * k * dpr * 0.6}px)`;
      c.beginPath();
      this.playArea(hole, FADE_YARDS / 2);
      c.fill('nonzero');
      c.filter = 'none';
    } else {
      // Nested, progressively larger areas at low alpha build up the falloff.
      c.globalAlpha = 0.07;
      for (let j = 1; j <= FADE_LAYERS; j++) {
        c.beginPath();
        this.playArea(hole, (j / FADE_LAYERS) * FADE_YARDS);
        c.fill('nonzero');
      }
      c.globalAlpha = 1;
    }
    // The play area itself (and its boundary line) stays fully solid.
    c.beginPath();
    this.playArea(hole, 2 / k);
    c.fill('nonzero');
  }

  private cam: Camera = { cx: 0, cy: 0, k: 1 };

  sx(p: Vec) { return (p.x - this.cam.cx) * this.cam.k + this.w / 2; }
  sy(p: Vec) { return (this.cam.cy - p.y) * this.cam.k + this.h / 2; }
  toWorld(x: number, y: number): Vec {
    return { x: (x - this.w / 2) / this.cam.k + this.cam.cx, y: this.cam.cy - (y - this.h / 2) / this.cam.k };
  }

  private poly(p: Poly) {
    const c = this.ctx;
    c.moveTo(this.sx(p[0]), this.sy(p[0]));
    for (let i = 1; i < p.length; i++) c.lineTo(this.sx(p[i]), this.sy(p[i]));
    c.closePath();
  }

  /**
   * Union of capsules along the centerline: matches surfaceAt's distance test.
   * `offset` shifts the line sideways (positive = right), used for the meandering fairway.
   */
  private corridor(hole: Hole, width: (i: number) => number, s0 = -Infinity, s1 = Infinity, offset?: (i: number) => number) {
    const c = this.ctx;
    const { s } = hole.centerline;
    const k = this.cam.k;
    const pts = offset
      ? hole.centerline.pts.map((p, i) => {
          const f = frameAt(hole.centerline, s[i]);
          return { x: p.x + f.right.x * offset(i), y: p.y + f.right.y * offset(i) };
        })
      : hole.centerline.pts;
    for (let i = 0; i < pts.length; i++) {
      if (s[i] < s0 - 5 || s[i] > s1 + 5) continue;
      const r = width(i) * k;
      c.moveTo(this.sx(pts[i]) + r, this.sy(pts[i]));
      c.arc(this.sx(pts[i]), this.sy(pts[i]), r, 0, Math.PI * 2);
      if (i < pts.length - 1 && s[i + 1] <= s1 + 5) {
        const a = pts[i], b = pts[i + 1];
        const f = frameAt(hole.centerline, s[i]);
        const ra = width(i), rb = width(i + 1);
        const q = [
          { x: a.x + f.right.x * ra, y: a.y + f.right.y * ra },
          { x: b.x + f.right.x * rb, y: b.y + f.right.y * rb },
          { x: b.x - f.right.x * rb, y: b.y - f.right.y * rb },
          { x: a.x - f.right.x * ra, y: a.y - f.right.y * ra },
        ];
        this.poly(q);
      }
    }
  }

  draw(hole: Hole, biome: Biome, cam: Camera, o: Overlay = {}) {
    this.cam = cam;
    const main = this.ctx;
    const P = PALETTES[biome];
    const k = cam.k;
    const { centerline: cl } = hole;
    const L = cl.s[cl.s.length - 1];

    // Terrain goes on an offscreen layer so it can be faded out beyond out of bounds.
    const scene = this.layer('scene');
    this.ctx = scene;
    const c = scene;
    c.save();
    c.fillStyle = P.bg;
    c.fillRect(0, 0, this.w, this.h);

    // Scenery (decor outside the corridor).
    for (const sc of hole.scenery) {
      c.beginPath();
      this.poly(sc.poly);
      c.fillStyle = P.scenery[sc.kind];
      c.fill();
      if (sc.kind === 'sea' || sc.kind === 'lake') {
        c.strokeStyle = 'rgba(255,255,255,0.55)';
        c.lineWidth = Math.max(1, 1.2 * k);
        c.stroke();
      }
    }

    // Tint everything out of bounds toward the surround so it sinks in as it fades.
    c.fillStyle = 'rgba(58,102,72,0.5)';
    c.fillRect(0, 0, this.w, this.h);

    // Out-of-bounds line: a thin outline left by filling a slightly larger area underneath.
    c.beginPath();
    this.playArea(hole, 1.2 / k);
    c.fillStyle = 'rgba(238,243,234,0.3)';
    c.fill('nonzero');

    // Rough: everything in play.
    c.beginPath();
    this.playArea(hole, 0);
    c.fillStyle = P.rough;
    c.fill('nonzero');

    // Fairway with mowing stripes. It may meander off the centerline and have carry gaps.
    const segs = fairwaySegments(hole);
    if (segs.length) {
      c.save();
      // Width tapers to a rounded nose at each end of a fairway segment, matching surfaceAt.
      c.beginPath();
      this.corridor(hole, (i) => fairwayWidthAt(hole, cl.s[i], cl.w[i]), hole.fairwayStart, hole.fairwayEnd, (i) => cl.fo?.[i] ?? 0);
      c.fillStyle = P.fairway;
      c.fill('nonzero');
      c.clip('nonzero');
      c.fillStyle = P.stripe;
      for (let s = hole.fairwayStart, n = 0; s < hole.fairwayEnd; s += 14, n++) {
        if (n % 2) continue;
        const a = frameAt(cl, s), b = frameAt(cl, s + 14);
        const r = 60;
        c.beginPath();
        this.poly([
          { x: a.p.x + a.right.x * r, y: a.p.y + a.right.y * r },
          { x: b.p.x + b.right.x * r, y: b.p.y + b.right.y * r },
          { x: b.p.x - b.right.x * r, y: b.p.y - b.right.y * r },
          { x: a.p.x - a.right.x * r, y: a.p.y - a.right.y * r },
        ]);
        c.fill();
      }
      c.restore();
    }

    // Fairway contours: soft hillshade so slopes read at a glance (eye overlay adds the full map).
    const contours = contourImages(hole);
    if (contours) {
      c.save();
      c.beginPath();
      this.playArea(hole, 0);
      c.clip('nonzero');
      c.imageSmoothingEnabled = true;
      c.drawImage(contours.shade, this.sx({ x: contours.b.minX, y: 0 }), this.sy({ x: 0, y: contours.b.maxY }), (contours.shade.width - 1) * contours.cell * k, (contours.shade.height - 1) * contours.cell * k);
      c.restore();
    }

    // Water (with island cut-outs).
    for (const w of hole.water) {
      c.beginPath();
      this.poly(w.outer);
      for (const hl of w.holes ?? []) this.poly(hl);
      c.fillStyle = P.water;
      c.fill('evenodd');
      c.strokeStyle = P.waterEdge;
      c.lineWidth = Math.max(1, 1.5 * k);
      c.stroke();
    }
    // Island land.
    for (const w of hole.water) {
      for (const hl of w.holes ?? []) {
        c.beginPath();
        this.poly(hl);
        c.fillStyle = P.rough;
        c.fill();
      }
    }

    // Waste areas: sandy scrub with tufts.
    for (const w of hole.waste ?? []) {
      c.beginPath();
      this.poly(w);
      c.fillStyle = P.waste;
      c.fill();
      c.strokeStyle = 'rgba(120,110,80,0.35)';
      c.lineWidth = Math.max(1, 0.6 * k);
      c.stroke();
      c.save();
      c.clip();
      c.fillStyle = P.wasteDot;
      const wb = geom.bounds(w);
      // Deterministic tufts on a jittered grid.
      for (let x = wb.minX; x <= wb.maxX; x += 3.2) {
        for (let y = wb.minY; y <= wb.maxY; y += 3.2) {
          const hsh = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
          const j = hsh - Math.floor(hsh);
          if (j < 0.45) continue;
          const p = { x: x + j * 2.4, y: y + (1 - j) * 2.4 };
          c.beginPath();
          c.arc(this.sx(p), this.sy(p), Math.max(0.6, (0.35 + 0.35 * j) * k), 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    }

    // Bunkers.
    for (const b of hole.bunkers) {
      c.beginPath();
      this.poly(b);
      c.fillStyle = P.sand;
      c.fill();
      c.strokeStyle = P.sandEdge;
      c.lineWidth = Math.max(1, 0.9 * k);
      c.stroke();
    }

    // Fringe + green.
    c.save();
    c.lineJoin = 'round';
    c.beginPath();
    this.poly(hole.green.poly);
    c.lineWidth = 2 * hole.fringeWidth * k;
    c.strokeStyle = P.fringe;
    c.stroke();
    c.fillStyle = P.green;
    c.fill();
    c.restore();

    if (o.greenBreak) {
      this.drawContourBreak(hole);
      this.drawBreak(hole);
    }
    this.drawPuttRings(hole);

    // Tee box.
    c.save();
    c.translate(this.sx(hole.tee), this.sy(hole.tee));
    c.rotate(hole.teeHeading);
    c.fillStyle = P.fairway;
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = Math.max(1, 0.5 * k);
    c.beginPath();
    c.roundRect(-TEE_BOX.hw * k, -TEE_BOX.hl * k, TEE_BOX.hw * 2 * k, TEE_BOX.hl * 2 * k, 2 * k);
    c.fill();
    c.stroke();
    c.restore();

    // Yardage markers (to green center).
    c.font = `500 ${Math.max(9, Math.min(13, 4.5 * k))}px Inter, system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const d of [100, 150, 200]) {
      const s = L - d;
      if (s < 30) continue;
      const p = frameAt(cl, s).p;
      c.fillStyle = 'rgba(70,90,72,0.45)';
      c.fillText(String(d), this.sx(p), this.sy(p));
    }

    // Trees, back to front so nearer canopies overlap.
    const trees = hole.trees.slice().sort((a, b) => b.y - a.y);
    for (const t of trees) {
      const x = this.sx(t), y = this.sy(t), r = t.r * k;
      if (x < -r * 2 || x > this.w + r * 2 || y < -r * 2 || y > this.h + r * 2) continue;
      c.fillStyle = 'rgba(30,45,32,0.22)';
      c.beginPath();
      c.ellipse(x + r * 0.35, y + r * 0.35, r, r * 0.9, 0, 0, Math.PI * 2);
      c.fill();
      const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, P.treeLight);
      g.addColorStop(1, P.tree);
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }

    c.restore();

    // Fade the terrain out beyond out of bounds, then composite onto the page background.
    const mask = this.layer('mask');
    this.ctx = mask;
    this.drawFadeMask(hole);
    scene.save();
    scene.setTransform(1, 0, 0, 1, 0, 0);
    scene.globalCompositeOperation = 'destination-in';
    scene.drawImage(mask.canvas, 0, 0);
    scene.restore();

    this.ctx = main;
    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.fillStyle = this.background;
    main.fillRect(0, 0, main.canvas.width, main.canvas.height);
    main.drawImage(scene.canvas, 0, 0);
    main.restore();

    this.drawForeground(hole, o);
  }

  /** Pin, aim, ball and debug marks: drawn on top, never faded. */
  private drawForeground(hole: Hole, o: Overlay) {
    const c = this.ctx;
    const k = this.cam.k;
    c.save();
    // Pin.
    const px = this.sx(hole.pin), py = this.sy(hole.pin);
    c.fillStyle = '#141a16';
    c.beginPath();
    c.arc(px, py, Math.max(2.2, 0.25 * k), 0, Math.PI * 2);
    c.fill();
    const pole = Math.max(18, Math.min(40, 6 * k));
    c.strokeStyle = '#f2efe6';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px, py - pole);
    c.stroke();
    c.fillStyle = '#d9533f';
    c.beginPath();
    c.moveTo(px, py - pole);
    c.lineTo(px + pole * 0.5, py - pole * 0.82);
    c.lineTo(px, py - pole * 0.64);
    c.fill();

    if (o.debug) this.drawDebug(hole);
    if (o.aim) this.drawAim(o.aim);
    if (o.trail && o.trail.length > 1) {
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(this.sx(o.trail[0]), this.sy(o.trail[0]) - o.trail[0].h * k * 0.6);
      for (const p of o.trail) c.lineTo(this.sx(p), this.sy(p) - p.h * k * 0.6);
      c.stroke();
    }
    if (o.ball) this.drawBall(o.ball);
    c.restore();
  }

  /** Green break: blue (low) to white (high) height map, with arrows pointing downhill. */
  private drawBreak(hole: Hole) {
    const c = this.ctx;
    const k = this.cam.k;
    const b = geom.bounds(hole.green.poly);
    c.save();
    c.beginPath();
    this.poly(hole.green.poly);
    c.clip();

    // Height shading, normalized to this green's range: one pixel per cell on an
    // offscreen canvas, scaled up with smoothing so it reads as a soft gradient.
    const cell = BREAK_CELL;
    const off = breakImage(hole);
    const cols = off.width, rows = off.height;
    c.imageSmoothingEnabled = true;
    c.drawImage(off, this.sx({ x: b.minX, y: 0 }), this.sy({ x: 0, y: b.maxY }), (cols - 1) * cell * k, (rows - 1) * cell * k);

    this.drawArrows(b, (p) => (geom.pointInPoly(p, hole.green.poly) ? greenGradient(hole, p) : null), 0.035);
    c.restore();
  }

  /**
   * Downhill arrows on a grid over `b`; longer means steeper (full length at `steep`).
   * `gradientAt` returns null where no arrow belongs.
   */
  private drawArrows(b: { minX: number; minY: number; maxX: number; maxY: number }, gradientAt: (p: Vec) => Vec | null, steep: number) {
    const c = this.ctx;
    const k = this.cam.k;
    const step = Math.max(1.5, 26 / k);
    c.strokeStyle = 'rgba(35,70,45,0.6)';
    c.fillStyle = 'rgba(35,70,45,0.6)';
    c.lineWidth = 1.4;
    for (let x = b.minX + step / 2; x <= b.maxX; x += step) {
      for (let y = b.minY + step / 2; y <= b.maxY; y += step) {
        const p = { x, y };
        const g = gradientAt(p);
        if (!g) continue;
        const m = Math.hypot(g.x, g.y);
        if (m < steep * 0.15) continue;
        const l = (0.3 + 0.7 * Math.min(1, m / steep)) * step * 0.75 * k;
        // Screen y is flipped, so downhill (-g) is (-g.x, +g.y) on screen.
        const ux = -g.x / m, uy = g.y / m;
        const x0 = this.sx(p) - (ux * l) / 2, y0 = this.sy(p) - (uy * l) / 2;
        const x1 = x0 + ux * l, y1 = y0 + uy * l;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
        const hd = Math.min(6, l * 0.35);
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x1 - ux * hd - uy * hd * 0.6, y1 - uy * hd + ux * hd * 0.6);
        c.lineTo(x1 - ux * hd + uy * hd * 0.6, y1 - uy * hd - ux * hd * 0.6);
        c.closePath();
        c.fill();
      }
    }
  }

  /** eye overlay for fairway contours: blue (low) to white (high) map plus downhill arrows, off the green */
  private drawContourBreak(hole: Hole) {
    const img = contourImages(hole);
    if (!img) return;
    const c = this.ctx;
    const k = this.cam.k;
    c.save();
    c.beginPath();
    this.playArea(hole, 0);
    c.clip('nonzero');
    c.imageSmoothingEnabled = true;
    c.drawImage(img.map, this.sx({ x: img.b.minX, y: 0 }), this.sy({ x: 0, y: img.b.maxY }), (img.map.width - 1) * img.cell * k, (img.map.height - 1) * img.cell * k);
    this.drawArrows(img.b, (p) => (geom.pointInPoly(p, hole.green.poly) ? null : terrainGradient(hole, p)), 0.12);
    c.restore();
  }

  /** Putt rings around the pin, clipped to the green: where the ball stops decides the putts. */
  private drawPuttRings(hole: Hole) {
    const c = this.ctx;
    const k = this.cam.k;
    const px = this.sx(hole.pin), py = this.sy(hole.pin);
    c.save();
    c.beginPath();
    this.poly(hole.green.poly);
    c.clip();
    const radii = PUTT_RINGS.map((r) => r.r);
    // Inner rings are tinted a little deeper.
    for (let i = radii.length - 1; i >= 0; i--) {
      c.beginPath();
      c.arc(px, py, radii[i] * k, 0, Math.PI * 2);
      c.fillStyle = i === 0 ? 'rgba(80,140,90,0.18)' : 'rgba(80,140,90,0.09)';
      c.fill();
      c.setLineDash([3, 4]);
      c.strokeStyle = 'rgba(60,100,70,0.55)';
      c.lineWidth = 1.2;
      c.stroke();
      c.setLineDash([]);
    }
    if (k > 4) {
      c.font = `600 ${Math.min(12, 2.2 * k)}px Inter, system-ui, sans-serif`;
      c.fillStyle = 'rgba(50,85,60,0.75)';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const labels = [...PUTT_RINGS.map((r) => r.putts), MAX_PUTTS];
      const at = [radii[0] * 0.55, (radii[0] + radii[1]) / 2, radii[1] + 2.5];
      labels.forEach((n, i) => c.fillText(`+${n}`, px, py + at[i] * k));
    }
    c.restore();
  }

  private drawAim(a: NonNullable<Overlay['aim']>) {
    const c = this.ctx;
    const k = this.cam.k;
    const dir = { x: Math.sin(a.heading), y: Math.cos(a.heading) };
    const end = { x: a.from.x + dir.x * a.dist, y: a.from.y + dir.y * a.dist };
    if (a.cone && !a.locked) this.drawCone(a.from, a.cone.center, a.cone.half, a.dist);
    if (a.wind) this.drawWindTrail(a.from, a.locked || !a.cone ? a.heading : a.cone.center, a.dist, a.wind);
    c.strokeStyle = a.locked ? '#b5532f' : '#c08a2e';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(this.sx(a.from), this.sy(a.from));
    c.lineTo(this.sx(end), this.sy(end));
    c.stroke();
    if (a.span && a.span[0] < 1) this.drawLieSpan(a.from, dir, a.dist, a.span);
    // Reticle: a dashed ring marking where a full swing can randomly land, a center dot,
    // and four short ticks that cross the ring at each quarter.
    const x = this.sx(end), y = this.sy(end);
    const r = Math.max(5, (a.spray ?? 4) * k);
    const t = Math.max(3, Math.min(6, r * 0.35)); // tick half-length either side of the ring
    c.save();
    c.globalAlpha = 0.6;
    c.lineCap = 'round';
    const ticks = () => {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        c.moveTo(x + dx * (r - t), y + dy * (r - t));
        c.lineTo(x + dx * (r + t), y + dy * (r + t));
      }
    };
    // Light halo under dark ink so it reads on any ground.
    for (const [color, width] of [['rgba(255,255,255,0.35)', 3.5], ['rgba(22,32,26,0.95)', 1.6]] as const) {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      ticks();
      c.stroke();
    }
    c.fillStyle = 'rgba(22,32,26,0.95)';
    c.beginPath();
    c.arc(x, y, 2, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    const arm = r + t;
    // Shot distance beside the reticle (animates when the club changes).
    if (a.label) {
      c.font = '600 12px Inter, system-ui, sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(20,38,28,0.8)';
      c.strokeText(a.label, x + arm + 5, y);
      c.fillStyle = '#eef3ea';
      c.fillText(a.label, x + arm + 5, y);
    }
    c.restore();
  }

  /** Faint dotted curve off the center line, fading as it goes, showing roughly how the wind bends a full swing. */
  private drawWindTrail(from: Vec, heading: number, dist: number, drift: Vec) {
    if (Math.hypot(drift.x, drift.y) < 0.75) return;
    const c = this.ctx;
    const dir = { x: Math.sin(heading), y: Math.cos(heading) };
    // Drift grows with the square of progress, matching the ball's flight.
    const at = (u: number) => {
      const p = { x: from.x + dir.x * dist * u + drift.x * u * u, y: from.y + dir.y * dist * u + drift.y * u * u };
      return { x: this.sx(p), y: this.sy(p) };
    };
    // One dot per few yards of flight: longer shots get more dots, and zoom never changes the count.
    const YARDS_PER_DOT = 8;
    const DOTS = Math.max(8, Math.round(dist / YARDS_PER_DOT));
    c.save();
    c.fillStyle = 'rgb(40,50,44)';
    for (let i = 1; i <= DOTS; i++) {
      const u = i / DOTS;
      const p = at(u);
      // Fades evenly over the whole line, from the ball to the end of the flight.
      // Fades all the way out by the end of the flight.
      c.globalAlpha = 0.55 * (1 - u);
      c.beginPath();
      // Dots grow gently along the line (radius in screen px).
      c.arc(p.x, p.y, 0.8 + 1.1 * u, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /** bracket on the aim line from a bad lie: the stretch a full swing can actually land in */
  private drawLieSpan(from: Vec, dir: Vec, dist: number, [lo, hi]: [number, number]) {
    const c = this.ctx;
    const at = (f: number) => {
      const p = { x: from.x + dir.x * dist * f, y: from.y + dir.y * dist * f };
      return { x: this.sx(p), y: this.sy(p) };
    };
    const a = at(lo), b = at(hi);
    // screen-space perpendicular (screen y is flipped)
    const nx = dir.y, ny = dir.x;
    c.save();
    c.lineCap = 'butt';
    c.strokeStyle = 'rgba(226,201,126,0.45)';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.strokeStyle = 'rgba(226,201,126,0.95)';
    c.lineWidth = 2;
    c.beginPath();
    for (const p of [a, b]) {
      c.moveTo(p.x - nx * 7, p.y - ny * 7);
      c.lineTo(p.x + nx * 7, p.y + ny * 7);
    }
    c.stroke();
    c.restore();
  }

  private drawCone(from: Vec, center: number, half: number, dist: number) {
    const c = this.ctx;
    const ray = (h: number) => {
      const e = { x: from.x + Math.sin(h) * dist, y: from.y + Math.cos(h) * dist };
      c.beginPath();
      c.moveTo(this.sx(from), this.sy(from));
      c.lineTo(this.sx(e), this.sy(e));
      c.stroke();
    };
    // Solid edges.
    c.strokeStyle = 'rgba(40,50,44,0.5)';
    c.lineWidth = 1.2;
    ray(center - half);
    ray(center + half);
    // Center line: solid but fainter than the edges.
    c.strokeStyle = 'rgba(40,50,44,0.32)';
    ray(center);
  }

  private drawBall(b: Vec & { h?: number }) {
    const c = this.ctx;
    const k = this.cam.k;
    const h = b.h ?? 0;
    const x = this.sx(b), y = this.sy(b);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(x + h * k * 0.15, y + 1, 3.5, 2.2, 0, 0, Math.PI * 2);
    c.fill();
    const r = 3.8 + Math.min(4, h * 0.12);
    const yy = y - h * k * 0.6;
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#2a332d';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, yy, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }

  private drawDebug(hole: Hole) {
    const c = this.ctx;
    c.strokeStyle = 'rgba(200,40,40,0.7)';
    c.lineWidth = 1;
    c.beginPath();
    hole.skeleton.forEach((p, i) => (i ? c.lineTo(this.sx(p), this.sy(p)) : c.moveTo(this.sx(p), this.sy(p))));
    c.stroke();
    c.fillStyle = 'rgba(200,40,40,0.9)';
    for (const p of hole.skeleton.slice(1, -1)) {
      c.beginPath();
      c.arc(this.sx(p), this.sy(p), 4, 0, Math.PI * 2);
      c.fill();
    }
    if (hole.dropZone) {
      c.strokeStyle = 'rgba(40,40,200,0.8)';
      c.beginPath();
      c.arc(this.sx(hole.dropZone), this.sy(hole.dropZone), 5, 0, Math.PI * 2);
      c.stroke();
    }
  }
}
