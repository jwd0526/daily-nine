// The Course JSON contract shared by generator, server and client.
// Units: yards. Each hole lives in its own frame: tee near the origin, playing toward +Y.

export interface Vec { x: number; y: number }
export type Poly = Vec[];

/** A filled polygon with optional cut-outs (e.g. a lake with an island green in it). */
export interface Region { outer: Poly; holes?: Poly[] }

export type Surface =
  | 'tee' | 'fairway' | 'rough' | 'bunker' | 'waste' | 'water'
  | 'green' | 'fringe' | 'trees' | 'ob';

export type Biome = 'links' | 'parkland' | 'heath' | 'desert' | 'alpine';

export interface Wind {
  /** Heading the wind blows toward, in the hole frame (0 = down the hole, +π/2 = left-to-right). */
  dir: number;
  mph: number;
}

export interface Tree { x: number; y: number; r: number; h: number }

/** gaussian mound (h > 0) or hollow (h < 0): height h (yards) at center, falloff radius r; sx > 1 stretches it along heading `rot` */
export interface Bump { x: number; y: number; r: number; h: number; sx?: number; rot?: number }

export interface GreenSlope {
  /** Linear gradient of height (rise per yard). */
  gx: number;
  gy: number;
  /**
   * Gaussian mounds (h > 0) and hollows (h < 0): height h (yards) at center, falloff radius r.
   * sx > 1 stretches it along heading `rot` into a ridge or swale.
   */
  bumps: Bump[];
  /** Tiers: a smooth step of height h across a line through (x, y), rising toward heading `dir`, over width w. */
  tiers?: { x: number; y: number; dir: number; h: number; w: number }[];
  /** Gentle undulation: a·sin(kx·x + ky·y + ph). */
  waves?: { kx: number; ky: number; ph: number; a: number }[];
}

export interface Centerline {
  pts: Vec[];
  /** Arc length at each point. */
  s: number[];
  /** Fairway half-width at each point. */
  w: number[];
  /** Playable corridor half-width (beyond this is out of bounds). */
  ob: number[];
  /** Fairway center offset from the centerline (positive = right of travel), so fairways can meander. */
  fo?: number[];
}

export type SceneryKind = 'sea' | 'lake' | 'rock' | 'dune' | 'scrub' | 'forest';
export interface Scenery { kind: SceneryKind; poly: Poly }

export interface Hole {
  number: number;
  par: 3 | 4 | 5;
  yards: number;
  difficulty: number;
  /** Feature ids applied to this hole (e.g. "island", "burn"). */
  features: string[];
  /** Short UI chips, e.g. ["ISLAND"]. */
  tags: string[];
  tee: Vec;
  /** Initial heading off the tee, for orienting the tee box. */
  teeHeading: number;
  pin: Vec;
  /** Design waypoints: tee, landing zone(s), green center. */
  skeleton: Vec[];
  centerline: Centerline;
  /** Fairway covers centerline arc length [fairwayStart, fairwayEnd]... */
  fairwayStart: number;
  fairwayEnd: number;
  /** ...except these stretches of rough that must be carried. */
  fairwayGaps?: [number, number][];
  /** Hole shape, e.g. "dogleg4", "reachable5". */
  archetype?: string;
  green: { poly: Poly; center: Vec; slope: GreenSlope };
  fringeWidth: number;
  /** fairway and rough contours (mounds, swales, cambers) that move a rolling ball. none on the green. */
  contours: Bump[];
  bunkers: Poly[];
  /** Sandy scrub areas: play like a fairway bunker you can advance from. */
  waste?: Poly[];
  water: Region[];
  trees: Tree[];
  /** Where to drop after a water ball when the line of entry has no dry ground (island greens). */
  dropZone?: Vec;
  scenery: Scenery[];
  wind: Wind;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Generation attempts needed (1 = first try; 0 = fallback template). */
  attempts: number;
}

/** The day's personality: multipliers around the biome's norms. */
export interface CourseStyle {
  /** The day's character, e.g. "watery", "wooded", "open". */
  theme: string;
  water: number;
  sand: number;
  trees: number;
  width: number;
  /** -1 (short course) .. 1 (long course). */
  length: number;
}

export interface Course {
  version: string;
  date: string;
  name: string;
  biome: Biome;
  style: CourseStyle;
  par: number;
  holes: Hole[];
}
