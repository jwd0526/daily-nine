import type { Biome } from './types.ts';
import type { Rng } from './rng.ts';

const PREFIXES = [
  'Harrow', 'Ash', 'Bram', 'Wex', 'Thorn', 'Kings', 'Mill', 'Stan', 'Ock', 'Wick',
  'Hollin', 'Bel', 'Carrow', 'Dun', 'Elder', 'Fen', 'Glas', 'Haw', 'Kel', 'Lang',
  'Marl', 'Nether', 'Oak', 'Pen', 'Quarry', 'Rook', 'Sall', 'Tarn', 'Upper', 'Wych',
  'Alder', 'Birk', 'Cold', 'Red', 'Brack', 'Cress', 'Fox', 'Heron', 'Lark', 'Stone',
  'Blyth', 'Wren', 'Ember', 'Grey', 'Whit', 'Knock', 'Bally', 'Craig', 'Brook', 'Ellis',
] as const;

const SUFFIXES = [
  'combe', 'ford', 'ley', 'wick', 'mere', 'hurst', 'bury', 'ham', 'stead', 'ton',
  'field', 'wood', 'gate', 'brook', 'more', 'dale', 'well', 'by', 'thorpe', 'holme',
  'wold', 'stow', 'den', 'shaw', 'cliffe', 'haven', 'ridge', 'worth', 'mouth', 'burn',
] as const;

/** Combinations that read badly or collide awkwardly. */
const BLOCKLIST = [
  /(.)\1\1/i,         // triple letters
  /^(\w+)\1/i,        // stuttered syllables
  /wickwick|stonestone|brookbrook|burnburn/i,
  /ass|cum|tit|shit|fuk|fuck|cock|dick|nig|fag|piss|crap/i,
  /dendale|holmeham|bydale/i,
];

interface Vocab {
  types: string[];
  features: string[];
}

const VOCAB: Record<Biome, Vocab> = {
  links: {
    types: ['Links', 'Golf Links', 'Dunes', 'Strand', 'Golf Club'],
    features: ['Dunes', 'Machair', 'Headland', 'Shore', 'Point'],
  },
  parkland: {
    types: ['Park', 'Country Club', 'Golf Club', 'Manor', 'Estate'],
    features: ['Oaks', 'Elms', 'Manor', 'Lakes', 'Abbey'],
  },
  heath: {
    types: ['Heath', 'Downs', 'Common', 'Moor', 'Golf Club'],
    features: ['Heather', 'Gorse', 'Barrows', 'Commons', 'Moor'],
  },
  desert: {
    types: ['Mesa', 'Canyon', 'Springs', 'Wells', 'Country Club'],
    features: ['Canyon', 'Arroyo', 'Painted Rocks', 'Springs', 'Bluffs'],
  },
  alpine: {
    types: ['Ridge', 'Highlands', 'Crag', 'Fells', 'Golf Club'],
    features: ['Pines', 'Crag', 'Larches', 'Falls', 'Summit'],
  },
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isBlocked(s: string): boolean {
  return BLOCKLIST.some((re) => re.test(s.replace(/\s+/g, '')));
}

function placeName(rng: Rng): string {
  for (let i = 0; i < 50; i++) {
    const pre = rng.pick(PREFIXES);
    const suf = rng.pick(SUFFIXES);
    // Avoid doubled seam letters ("Ash" + "ham" is fine, "Brook" + "ham" fine, "Wick" + "combe" fine).
    const name = capitalize(pre.toLowerCase() + suf);
    if (pre.toLowerCase().endsWith(suf.charAt(0)) && pre.length > 3 && suf.length < 4) continue;
    if (!isBlocked(name)) return name;
  }
  return 'Ashcombe';
}

export function courseName(rng: Rng, biome: Biome): string {
  // The full name (not just the place) must pass the blocklist.
  for (let i = 0; i < 20; i++) {
    const name = composeName(rng, biome);
    if (!isBlocked(name)) return name;
  }
  return 'Ashcombe Golf Club';
}

function composeName(rng: Rng, biome: Biome): string {
  const vocab = VOCAB[biome];
  const place = placeName(rng);
  const template = rng.weighted<string>([
    ['{place} {type}', 6],
    ['The {feature} at {place}', 2],
    ['Royal {place} {type}', 1],
    ['{place} {feature}', 2],
    ['Old {place} {type}', 1],
  ]);
  let name = template
    .replace('{place}', place)
    .replace('{type}', rng.pick(vocab.types))
    .replace('{feature}', rng.pick(vocab.features));
  // "Royal X Golf Club" and similar are fine; avoid "Old X Country Club" double-adjective clunk.
  name = name.replace(/^Old (\w+) Country Club$/, '$1 Country Club');
  return name;
}
