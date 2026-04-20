// Ecosystem Collapse Diorama
// Interactive procedural ecosystem — watch it evolve, then add your own organisms

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CFG = {
  plant:     { max: 260, growRate: 0.07, size: 5 },
  herbivore: { init: 28, maxSpeed: 1.2, senseRadius: 100, eatRadius: 12, hungerTick: 0.0014, repro: 0.00035, size: 6 },
  predator:  { init: 4,  maxSpeed: 1.5, senseRadius: 120, killRadius: 14, hungerTick: 0.001, repro: 0.00012, size: 8 },
  milestone: 5 * 60,   // seconds between reports
};

// ─── PRESETS ──────────────────────────────────────────────────────────────────
const PRESETS = {
  forest: {
    label: '🌲 Forest',
    description: 'Dense canopy, many plants, balanced herbivores and predators.',
    plantMax: 300, plantGrowRate: 0.080,
    herbInit: 32, predInit: 5,
    herbHungerTick: 0.0013, predHungerTick: 0.0009,
    herbRepro: 0.00038, predRepro: 0.00013,
    skyColorDay: [100, 190, 130], skyColorNight: [10, 20, 15],
  },
  ocean: {
    label: '🌊 Ocean',
    description: 'Vast blue expanse — algae blooms fuel swarms of prey fish chased by predators.',
    plantMax: 340, plantGrowRate: 0.095,
    herbInit: 44, predInit: 6,
    herbHungerTick: 0.0015, predHungerTick: 0.0011,
    herbRepro: 0.00042, predRepro: 0.00013,
    skyColorDay: [20, 110, 210], skyColorNight: [5, 20, 60],
  },
  desert: {
    label: '🏜 Desert',
    description: 'Sparse scrub, scarce water — tough organisms eke out survival.',
    plantMax: 110, plantGrowRate: 0.038,
    herbInit: 16, predInit: 3,
    herbHungerTick: 0.0011, predHungerTick: 0.0008,
    herbRepro: 0.00025, predRepro: 0.00008,
    skyColorDay: [230, 190, 100], skyColorNight: [40, 25, 5],
  },
  arctic: {
    label: '🧊 Arctic',
    description: 'Frozen tundra, long nights — slow metabolism but brutal predators.',
    plantMax: 140, plantGrowRate: 0.045,
    herbInit: 24, predInit: 4,
    herbHungerTick: 0.001, predHungerTick: 0.0007,
    herbRepro: 0.00028, predRepro: 0.00009,
    skyColorDay: [200, 220, 240], skyColorNight: [10, 15, 40],
  },
};

let activePreset = null; // null = default

// ─── STATE ────────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let plants = [], herbivores = [], predators = [], customOrganisms = [];
let simTime = 0;
let realTime = 0;
let lastMilestone = -1;
let speed = 1;
let paused = false;
let weather = 'clear';
let weatherTimer = 0;
let weatherDuration = 0;
let skyBrightness = 1;
let dayTimer = 0;
let extinctionLog = [];
let rng;

// ─── SEEDED RNG ───────────────────────────────────────────────────────────────
function mkRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ─── ENTITY FACTORIES ─────────────────────────────────────────────────────────
function mkPlant(x, y) {
  return {
    x, y,
    age: rng() * 30,
    size: CFG.plant.size * (0.5 + rng() * 0.9),
    kind: 'plant',
    variant: Math.floor(rng() * 4),  // 0=bush 1=tall grass 2=flower 3=fern
  };
}

function mkHerbivore(x, y) {
  return {
    x, y,
    vx: (rng() - 0.5) * CFG.herbivore.maxSpeed,
    vy: (rng() - 0.5) * CFG.herbivore.maxSpeed,
    hunger: rng() * 0.3,
    age: 0,
    kind: 'herbivore',
    variant: Math.floor(rng() * 3), // 0=rabbit 1=deer 2=mouse
  };
}

function mkPredator(x, y) {
  return {
    x, y,
    vx: (rng() - 0.5) * CFG.predator.maxSpeed,
    vy: (rng() - 0.5) * CFG.predator.maxSpeed,
    hunger: rng() * 0.3,
    age: 0,
    kind: 'predator',
    variant: Math.floor(rng() * 3), // 0=wolf 1=hawk 2=fox
  };
}

// ─── CUSTOM ORGANISM FACTORY ──────────────────────────────────────────────────
function mkCustomOrganism(x, y, spec) {
  return {
    x, y,
    vx: (rng() - 0.5) * spec.maxSpeed,
    vy: (rng() - 0.5) * spec.maxSpeed,
    hunger: rng() * 0.3,
    age: 0,
    kind: 'custom',
    spec,
  };
}

// ─── RULE GENERATOR — interprets user description → organism parameters ───────
// Uses Claude API if available, otherwise falls back to local heuristics
async function generateOrganismSpecAI(name, description) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': window.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `You are an ecosystem simulator rule engine. Given a description of an organism, output ONLY a valid JSON object with these exact fields (no markdown, no explanation):

{
  "eats": "plants"|"herbivores"|"predators"|"omnivore",
  "size": number 3-14,
  "maxSpeed": number 0.3-2.8,
  "hungerTick": number 0.001-0.006,
  "repro": number 0.00004-0.0006,
  "senseRadius": number 20-160,
  "eatRadius": number 5-20,
  "maxPop": number 5-70,
  "color": "#rrggbb hex color",
  "shape": "circle"|"star"|"square"|"diamond"|"arrow"|"blob"|"spike"|"tri",
  "aggression": number 0.0-1.0,
  "flockRadius": number 0-80,
  "nocturnal": boolean,
  "lifespan": number 400-2000
}

Organism name: ${name}
Description: ${description}

Respond with ONLY the JSON.`
        }],
      }),
    });
    if (!res.ok) throw new Error('api_err');
    const data = await res.json();
    const text = data.content[0].text.trim();
    const spec = JSON.parse(text);
    spec.name = name || 'Mystery';
    spec.description = description;
    // clamp safety
    spec.size = Math.min(14, Math.max(3, spec.size || 6));
    spec.maxSpeed = Math.min(2.8, Math.max(0.3, spec.maxSpeed || 1.2));
    spec.eatRadius = Math.max(spec.size, spec.eatRadius || 9);
    spec.lifespan = spec.lifespan || 1000;
    spec.aggression = spec.aggression ?? 0.5;
    spec.flockRadius = spec.flockRadius ?? 0;
    spec.nocturnal = spec.nocturnal ?? false;
    return spec;
  } catch (e) {
    return null; // fallback to heuristics
  }
}

function generateOrganismSpecLocal(name, description) {
  const desc = description.toLowerCase();

  let size = 6;
  if (/giant|huge|massive|large|big/.test(desc)) size = 12;
  else if (/tiny|small|micro|mini/.test(desc)) size = 3;
  else if (/medium|mid/.test(desc)) size = 6;

  let maxSpeed = 1.2;
  if (/fast|quick|swift|rapid|speedy|dash/.test(desc)) maxSpeed = 2.4;
  else if (/slow|sluggish|crawl|plod/.test(desc)) maxSpeed = 0.45;

  let eats = 'plants';
  if (/eat.*predator|hunt.*predator|kill.*predator|apex|super.?predator/.test(desc)) eats = 'predators';
  else if (/eat.*herb|hunt.*herb|carnivore|predator|hunter|wolf|fox|hawk|eagle|lion|tiger|shark/.test(desc)) eats = 'herbivores';
  else if (/omnivore|eat.*everything|eat.*both|scavenge/.test(desc)) eats = 'omnivore';

  let hungerTick = 0.0025;
  if (/hungry|starv|fast.?burn|high.?energy/.test(desc)) hungerTick = 0.005;
  else if (/efficient|slow.?burn|low.?energy|patient/.test(desc)) hungerTick = 0.0013;

  let repro = 0.00016;
  if (/breed|prolific|rapid.?repro|multiply|swarm|colony/.test(desc)) repro = 0.0005;
  else if (/rare|solitary|slow.?repro|lone/.test(desc)) repro = 0.00005;

  let senseRadius = 80;
  if (/blind|near.?sighted/.test(desc)) senseRadius = 25;
  else if (/keen|eagle.?eye|sharp|aware|echolocation/.test(desc)) senseRadius = 145;

  let maxPop = 30;
  if (/swarm|horde|colony|herd/.test(desc)) maxPop = 65;
  else if (/solitary|lone|rare/.test(desc)) maxPop = 8;

  let aggression = 0.5;
  if (/aggressive|fierce|violent|brutal/.test(desc)) aggression = 0.9;
  else if (/passive|docile|peaceful|timid/.test(desc)) aggression = 0.1;

  let flockRadius = 0;
  if (/flock|school|herd|pack|swarm|colony/.test(desc)) flockRadius = 50;

  let nocturnal = /night|dark|nocturnal|dusk|moon/.test(desc);

  let color = '#e07020';
  const colorMap = [
    [/red|fire|flame|blood/, '#e82020'],
    [/blue|ocean|water|ice|arctic/, '#2060e8'],
    [/green|forest|fern|moss|jungle/, '#20a830'],
    [/purple|violet|mystic|magic/, '#9020e0'],
    [/yellow|gold|sun|bright/, '#e0c020'],
    [/cyan|teal|aqua/, '#20c8c8'],
    [/pink|rose|fuchsia/, '#e040a0'],
    [/white|pale|ghost|snow/, '#d0d0d0'],
    [/black|dark|shadow|night/, '#404040'],
    [/orange|amber|rust/, '#e07020'],
  ];
  for (const [re, c] of colorMap) {
    if (re.test(desc)) { color = c; break; }
  }

  let shape = 'circle';
  if (/spike|spiky|angular|sharp|crystal|star/.test(desc)) shape = 'spike';
  else if (/square|box|cube|block/.test(desc)) shape = 'square';
  else if (/diamond|rhombus/.test(desc)) shape = 'diamond';
  else if (/arrow|dart|swift|missile|fish/.test(desc)) shape = 'arrow';
  else if (/blob|jelly|amoeba|ooze/.test(desc)) shape = 'blob';
  else if (/tri|triangle|wedge/.test(desc)) shape = 'tri';

  return {
    name: name || 'Unknown',
    description,
    eats,
    size,
    maxSpeed,
    hungerTick,
    repro,
    senseRadius,
    eatRadius: Math.max(size, 9),
    maxPop,
    color,
    shape,
    aggression,
    flockRadius,
    nocturnal,
    lifespan: 800 + rng() * 600,
  };
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function initSim(seed, preset) {
  rng = mkRng(seed >>> 0);
  plants = [];
  herbivores = [];
  predators = [];
  customOrganisms = [];
  extinctionLog = [];
  simTime = 0;
  realTime = 0;
  lastMilestone = -1;
  weatherTimer = 0;
  weatherDuration = 30 + rng() * 60;
  weather = 'clear';
  skyBrightness = 1;
  dayTimer = 0;

  const p = preset || {};
  const plantMax = p.plantMax || CFG.plant.max;
  const herbInit = p.herbInit || CFG.herbivore.init;
  const predInit = p.predInit || CFG.predator.init;

  // Start with 85% of max plants so herbivores can immediately eat
  for (let i = 0; i < Math.floor(plantMax * 0.85); i++)
    plants.push(mkPlant(rng() * W, rng() * H));
  for (let i = 0; i < herbInit; i++)
    herbivores.push(mkHerbivore(rng() * W, rng() * H));
  for (let i = 0; i < predInit; i++)
    predators.push(mkPredator(rng() * W, rng() * H));
}

// ─── WEATHER ──────────────────────────────────────────────────────────────────
const WEATHERS = ['clear', 'rain', 'drought', 'storm'];
const WEATHER_LABELS = { clear: '☀ Clear', rain: '🌧 Rain', drought: '🌵 Drought', storm: '⛈ Storm' };

function tickWeather(dt) {
  weatherTimer += dt;
  if (weatherTimer >= weatherDuration) {
    weatherTimer = 0;
    weatherDuration = 40 + rng() * 80;
    const roll = rng();
    if (roll < 0.45) weather = 'clear';
    else if (roll < 0.72) weather = 'rain';
    else if (roll < 0.88) weather = 'drought';
    else weather = 'storm';
    document.getElementById('weather-label').textContent = WEATHER_LABELS[weather];
  }
}

function tickDayNight(dt) {
  dayTimer += dt;
  const period = 240;
  const phase = (dayTimer % period) / period;
  skyBrightness = Math.max(0.1, Math.sin(phase * Math.PI * 2) * 0.5 + 0.6);
}

// ─── DIST / STEER ─────────────────────────────────────────────────────────────
function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function steer(entity, tx, ty, speed) {
  const dx = tx - entity.x, dy = ty - entity.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  // Stronger steering factor (0.22) so organisms actually reach their targets
  entity.vx += (dx / d) * speed * 0.22;
  entity.vy += (dy / d) * speed * 0.22;
}

function clampSpeed(entity, maxSpd) {
  const spd = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
  if (spd > maxSpd) { entity.vx = entity.vx / spd * maxSpd; entity.vy = entity.vy / spd * maxSpd; }
}

function wrap(entity) {
  if (entity.x < 0) entity.x += W;
  if (entity.x > W) entity.x -= W;
  if (entity.y < 0) entity.y += H;
  if (entity.y > H) entity.y -= H;
}

// ─── SIM TICK ─────────────────────────────────────────────────────────────────
function tick(dt) {
  simTime += dt;
  realTime += dt;

  tickWeather(dt);
  tickDayNight(dt);

  const p = activePreset || {};
  const plantMax = p.plantMax || CFG.plant.max;
  const plantGrowRate = p.plantGrowRate || CFG.plant.growRate;

  // Plant growth — more rolls per tick, guaranteed minimum at low pop
  const growMod = weather === 'rain' ? 2.5 : weather === 'drought' ? 0.2 : weather === 'storm' ? 0.6 : 1;
  const growNight = 0.35 + skyBrightness * 0.65;
  // Bonus growth when plants are critically low to prevent total herbivore starvation
  const scarcityBonus = plants.length < 40 ? 4.0 : plants.length < 80 ? 2.0 : 1.0;
  const maxGrowthRolls = Math.ceil(plantMax / 10);
  for (let i = 0; i < maxGrowthRolls; i++) {
    if (plants.length >= plantMax) break;
    if (rng() < plantGrowRate * dt * 60 * growMod * growNight * scarcityBonus) {
      const parent = plants.length ? plants[Math.floor(rng() * plants.length)] : { x: rng() * W, y: rng() * H };
      plants.push(mkPlant(
        ((parent.x + (rng() - 0.5) * 60) + W) % W,
        ((parent.y + (rng() - 0.5) * 60) + H) % H
      ));
    }
  }

  const herbHungerTick = p.herbHungerTick || CFG.herbivore.hungerTick;
  const predHungerTick = p.predHungerTick || CFG.predator.hungerTick;
  const herbRepro = p.herbRepro || CFG.herbivore.repro;
  const predRepro = p.predRepro || CFG.predator.repro;

  // Herbivores
  const nextHerbs = [];
  for (const h of herbivores) {
    h.age += dt;
    const hungerMod = weather === 'storm' ? 1.3 : 1;
    h.hunger += herbHungerTick * dt * 60 * hungerMod;

    // Find nearest plant within sense radius (not global scan)
    let nearestPlant = null, nearestPDist = CFG.herbivore.senseRadius;
    for (const p of plants) {
      const d = dist(h, p);
      if (d < nearestPDist) { nearestPDist = d; nearestPlant = p; }
    }
    // When very hungry, extend search range to find food anywhere on screen
    if (!nearestPlant && h.hunger > 0.5) {
      for (const pl of plants) {
        const d = dist(h, pl);
        if (d < nearestPDist * 3) { nearestPDist = d; nearestPlant = pl; }
      }
    }

    let flee = false;
    for (const pred of predators) {
      if (dist(h, pred) < CFG.herbivore.senseRadius) {
        steer(h, h.x - (pred.x - h.x), h.y - (pred.y - h.y), CFG.herbivore.maxSpeed * 1.6);
        flee = true;
      }
    }
    for (const co of customOrganisms) {
      if ((co.spec.eats === 'herbivores' || co.spec.eats === 'omnivore') && dist(h, co) < CFG.herbivore.senseRadius) {
        steer(h, h.x - (co.x - h.x), h.y - (co.y - h.y), CFG.herbivore.maxSpeed * 1.5);
        flee = true;
      }
    }

    if (!flee && nearestPlant) {
      steer(h, nearestPlant.x, nearestPlant.y, CFG.herbivore.maxSpeed);
    } else if (!flee) {
      h.vx += (rng() - 0.5) * 0.3;
      h.vy += (rng() - 0.5) * 0.3;
    }

    clampSpeed(h, CFG.herbivore.maxSpeed);
    h.x += h.vx; h.y += h.vy;
    wrap(h);

    // Try to eat nearest plant
    if (nearestPlant && dist(h, nearestPlant) < CFG.herbivore.eatRadius) {
      plants.splice(plants.indexOf(nearestPlant), 1);
      h.hunger = Math.max(0, h.hunger - 0.6);
    }

    if (h.hunger >= 1 || h.age > 1100) continue;

    const maxHerbs = p.herbInit ? p.herbInit * 5 : 120;
    if (h.hunger < 0.55 && herbivores.length < maxHerbs && rng() < herbRepro * dt * 60)
      nextHerbs.push(mkHerbivore(h.x, h.y));

    nextHerbs.push(h);
  }

  if (herbivores.length > 0 && nextHerbs.length === 0)
    extinctionLog.push({ time: simTime, species: 'herbivore' });
  herbivores = nextHerbs;

  // Population rescue: if critically low (< 3) but not zero, inject a few survivors
  // so the ecosystem doesn't collapse into a boring static state too quickly.
  const herbInit = p.herbInit || CFG.herbivore.init;
  if (herbivores.length > 0 && herbivores.length < 3 && rng() < 0.004 * dt * 60) {
    for (let i = 0; i < 3; i++)
      herbivores.push(mkHerbivore(rng() * W, rng() * H));
  }

  // Predators
  const nextPreds = [];
  for (const pred of predators) {
    pred.age += dt;
    pred.hunger += predHungerTick * dt * 60;

    let nearestH = null, nearestHDist = CFG.predator.senseRadius;
    for (const h of herbivores) {
      const d = dist(pred, h);
      if (d < nearestHDist) { nearestHDist = d; nearestH = h; }
    }

    if (nearestH) {
      steer(pred, nearestH.x, nearestH.y, CFG.predator.maxSpeed);
    } else {
      pred.vx += (rng() - 0.5) * 0.22;
      pred.vy += (rng() - 0.5) * 0.22;
    }

    clampSpeed(pred, CFG.predator.maxSpeed);
    pred.x += pred.vx; pred.y += pred.vy;
    wrap(pred);

    if (nearestH && nearestHDist < CFG.predator.killRadius) {
      const idx = herbivores.indexOf(nearestH);
      if (idx !== -1) herbivores.splice(idx, 1);
      pred.hunger = Math.max(0, pred.hunger - 0.8);
    }

    if (pred.hunger >= 1 || pred.age > 1500) continue;

    const maxPreds = p.predInit ? p.predInit * 5 : 20;
    if (pred.hunger < 0.55 && predators.length < maxPreds && rng() < predRepro * dt * 60)
      nextPreds.push(mkPredator(pred.x, pred.y));

    nextPreds.push(pred);
  }

  if (predators.length > 0 && nextPreds.length === 0)
    extinctionLog.push({ time: simTime, species: 'predator' });
  predators = nextPreds;

  // Population rescue for predators: inject a lone predator when critically low
  // to maintain ecosystem tension longer
  if (predators.length > 0 && predators.length < 2 && herbivores.length > 8 && rng() < 0.003 * dt * 60) {
    predators.push(mkPredator(rng() * W, rng() * H));
  }

  // Custom organisms
  const nextCustom = [];
  for (const co of customOrganisms) {
    co.age += dt;
    const isActiveNow = co.spec.nocturnal ? skyBrightness < 0.45 : true;
    const speedMult = isActiveNow ? 1.0 : 0.3;
    co.hunger += co.spec.hungerTick * dt * 60 * (isActiveNow ? 1.0 : 0.4);

    let prey = null, preyDist = co.spec.senseRadius, preyList = [];
    if (co.spec.eats === 'plants') preyList = plants;
    else if (co.spec.eats === 'herbivores') preyList = herbivores;
    else if (co.spec.eats === 'predators') preyList = predators;
    else if (co.spec.eats === 'omnivore') preyList = [...herbivores, ...plants];

    for (const p of preyList) {
      const d = dist(co, p);
      if (d < preyDist) { preyDist = d; prey = p; }
    }

    // Flocking behavior
    if (co.spec.flockRadius > 0) {
      const neighbors = customOrganisms.filter(o => o !== co && o.spec.name === co.spec.name && dist(co, o) < co.spec.flockRadius);
      if (neighbors.length > 0) {
        const cx = neighbors.reduce((s, o) => s + o.x, 0) / neighbors.length;
        const cy = neighbors.reduce((s, o) => s + o.y, 0) / neighbors.length;
        steer(co, cx, cy, co.spec.maxSpeed * 0.3);
      }
    }

    if (prey) {
      steer(co, prey.x, prey.y, co.spec.maxSpeed * speedMult);
    } else {
      co.vx += (rng() - 0.5) * 0.28;
      co.vy += (rng() - 0.5) * 0.28;
    }

    clampSpeed(co, co.spec.maxSpeed * speedMult);
    co.x += co.vx; co.y += co.vy;
    wrap(co);

    if (prey && preyDist < co.spec.eatRadius) {
      if (co.spec.eats === 'plants') {
        const idx = plants.indexOf(prey);
        if (idx !== -1) { plants.splice(idx, 1); co.hunger = Math.max(0, co.hunger - 0.5); }
      } else if (co.spec.eats === 'herbivores') {
        const idx = herbivores.indexOf(prey);
        if (idx !== -1) { herbivores.splice(idx, 1); co.hunger = Math.max(0, co.hunger - 0.72); }
      } else if (co.spec.eats === 'predators') {
        const idx = predators.indexOf(prey);
        if (idx !== -1) { predators.splice(idx, 1); co.hunger = Math.max(0, co.hunger - 0.72); }
      } else if (co.spec.eats === 'omnivore') {
        const ih = herbivores.indexOf(prey);
        const ip = plants.indexOf(prey);
        if (ih !== -1) { herbivores.splice(ih, 1); co.hunger = Math.max(0, co.hunger - 0.65); }
        else if (ip !== -1) { plants.splice(ip, 1); co.hunger = Math.max(0, co.hunger - 0.4); }
      }
    }

    if (co.hunger >= 1 || co.age > co.spec.lifespan) continue;

    const sameSpecies = customOrganisms.filter(o => o.spec.name === co.spec.name);
    if (co.hunger < 0.45 && sameSpecies.length < co.spec.maxPop && rng() < co.spec.repro * dt * 60) {
      nextCustom.push(mkCustomOrganism(co.x + (rng() - 0.5) * 12, co.y + (rng() - 0.5) * 12, co.spec));
    }

    nextCustom.push(co);
  }
  customOrganisms = nextCustom;

  updatePopCounts();

  const milestoneIndex = Math.floor(simTime / CFG.milestone);
  if (milestoneIndex > lastMilestone) {
    lastMilestone = milestoneIndex;
    showReport(milestoneIndex);
  }
}

function updatePopCounts() {
  let txt = `🌿${plants.length} 🐇${herbivores.length} 🦊${predators.length}`;
  const specCounts = {};
  for (const co of customOrganisms) {
    specCounts[co.spec.name] = (specCounts[co.spec.name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(specCounts)) {
    txt += ` ✦${name.slice(0,6)}:${count}`;
  }
  document.getElementById('pop-counts').textContent = txt;
}

// ─── STATE LABELS ─────────────────────────────────────────────────────────────
function classifyState() {
  const P = plants.length, H = herbivores.length, Pr = predators.length;
  const totalAnimals = H + Pr + customOrganisms.length;
  const hExtinct = H === 0;
  const prExtinct = Pr === 0;
  const recentExtinctions = extinctionLog.filter(e => simTime - e.time < CFG.milestone * 2).length;

  if (customOrganisms.length > 20) {
    const spec = customOrganisms[0]?.spec;
    return { title: `${spec?.name || 'New Species'} Dominance`, body: `The introduced ${spec?.name || 'organism'} is thriving — ${customOrganisms.length} strong. The original ecosystem adjusts.` };
  }
  if (hExtinct && prExtinct && customOrganisms.length === 0)
    return { title: 'Silent Spring', body: `All animals are gone. The land is still — only plants remain, spreading in silence.` };
  if (hExtinct)
    return { title: 'The Last Hunter', body: `Herbivores are extinct. ${Pr} predator${Pr !== 1 ? 's' : ''} stalk an empty meadow, burning through their final reserves.` };
  if (prExtinct && H > 50)
    return { title: 'Rabbit Hegemony', body: `No predators remain. ${H} herbivores graze unchecked — the landscape is being stripped bare.` };
  if (prExtinct)
    return { title: 'Cautious Abundance', body: `Predators gone. ${H} herbivores roam freely among ${P} plants. Uneasy peace.` };
  if (Pr > H * 0.6 && H < 15)
    return { title: 'Predator Trap', body: `${Pr} predators, only ${H} prey. The hunters are racing toward their own starvation.` };
  if (H > 60 && Pr > 10)
    return { title: 'Productive Chaos', body: `A churning arms race: ${H} prey vs ${Pr} predators, ${P} plants regenerating.` };
  if (recentExtinctions >= 2)
    return { title: 'Cascading Collapse', body: `Multiple extinctions in quick succession. The web is unraveling — ${totalAnimals} animals remain.` };
  if (weather === 'drought' && P < 20)
    return { title: 'Great Drying', body: `Drought has reduced plants to ${P}. Animals press together in a shrinking green.` };
  if (weather === 'storm' && totalAnimals < 15)
    return { title: 'Storm Survivors', body: `Only ${totalAnimals} animals endure the storm. ${P} plants bend in the wind.` };
  if (Math.abs(H - Pr * 5) < 5 && H > 10)
    return { title: 'Precarious Balance', body: `${H} herbivores, ${Pr} predators, ${P} plants — a tenuous equilibrium that could tip at any moment.` };
  if (H < 8 && Pr < 3)
    return { title: 'Edge of Extinction', body: `Barely anything remains. ${H} herbivores, ${Pr} predators, ${P} plants. One bad season ends it.` };
  if (P > 100 && H < 10)
    return { title: 'Garden Without Gardeners', body: `Plants have reclaimed the land — ${P} of them — but only ${H} herbivores are left to browse.` };
  return { title: 'Field Notes: Ongoing', body: `${H} herbivores, ${Pr} predators, ${P} plants. The system hums along — for now.` };
}

function fmtT(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── REPORT OVERLAY ───────────────────────────────────────────────────────────
function showReport(idx) {
  const { title, body } = classifyState();
  document.getElementById('report-time').textContent = `T+${fmtT(simTime)} · Report #${idx + 1}`;
  document.getElementById('report-title').textContent = title;
  document.getElementById('report-body').textContent = body;
  document.getElementById('report-overlay').style.display = 'flex';
  paused = true;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('report-dismiss').addEventListener('click', () => {
    document.getElementById('report-overlay').style.display = 'none';
    paused = false;
  });
});

// ─── RENDER HELPERS ───────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function skyColor() {
  const t = skyBrightness;
  const p = activePreset;
  const dc = p ? p.skyColorDay : [135, 206, 235];
  const nc = p ? p.skyColorNight : [13, 27, 42];
  const r = Math.round(nc[0] + (dc[0] - nc[0]) * t);
  const g = Math.round(nc[1] + (dc[1] - nc[1]) * t);
  const b = Math.round(nc[2] + (dc[2] - nc[2]) * t);
  return `rgb(${r},${g},${b})`;
}

function groundColor() {
  const t = skyBrightness;
  const r = Math.round(20 + (58 - 20) * t);
  const g = Math.round(30 + (107 - 30) * t);
  const b = Math.round(10 + (26 - 10) * t);
  return `rgb(${r},${g},${b})`;
}

// ─── DRAW PLANTS ──────────────────────────────────────────────────────────────
function drawPlant(p) {
  const glow = 0.55 + skyBrightness * 0.45;
  const g = Math.round(155 * glow);
  const r = Math.round(38 * glow);
  const b = Math.round(22 * glow);
  const s = p.size;

  ctx.save();
  ctx.translate(p.x, p.y);

  if (p.variant === 1) {
    // Tall grass — 3 blades
    ctx.strokeStyle = `rgba(${r},${g + 20},${b},0.85)`;
    ctx.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 3, s * 2);
      ctx.quadraticCurveTo(i * 4 + (rng() - 0.5) * 2, 0, i * 2, -s * 2.2);
      ctx.stroke();
    }
  } else if (p.variant === 2) {
    // Flower — stem + petals
    ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, s * 2); ctx.lineTo(0, -s);
    ctx.stroke();
    // petals
    const petalColors = ['#e84', '#f6a', '#ffc', '#a8f'];
    ctx.fillStyle = petalColors[Math.floor(p.age % 4)] + 'cc';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * s * 0.9, -s + Math.sin(a) * s * 0.9, s * 0.5, s * 0.35, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(0, -s, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.variant === 3) {
    // Fern frond
    ctx.strokeStyle = `rgba(${r + 10},${g + 15},${b},0.8)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, s * 2); ctx.quadraticCurveTo(s * 0.8, 0, 0, -s * 2);
    ctx.stroke();
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const fy = (i / 4) * s * 1.5;
      const fl = s * (1 - Math.abs(i) / 5);
      ctx.beginPath();
      ctx.moveTo(0, fy);
      ctx.lineTo(i > 0 ? fl : -fl, fy - s * 0.5);
      ctx.stroke();
    }
  } else {
    // Default bush — 3 overlapping lobes
    ctx.fillStyle = `rgba(${r},${g},${b},0.92)`;
    ctx.strokeStyle = `rgba(${r - 10},${g - 20},${b},0.6)`;
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = `rgba(${r},${g - 30},${b},0.7)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, s * 2.5); ctx.lineTo(0, s * 0.5);
    ctx.stroke();
    ctx.fillStyle = `rgba(${r},${g},${b},0.92)`;
    ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(${Math.round(r * 1.1)},${Math.round(g * 1.15)},${b},0.7)`;
    ctx.beginPath(); ctx.arc(-s * 0.7, -s * 0.5, s * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.7, -s * 0.5, s * 0.75, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

// ─── DRAW HERBIVORES ──────────────────────────────────────────────────────────
function drawHerbivore(h) {
  const hungerPale = Math.round(215 - h.hunger * 90);
  const gFactor = Math.round(165 - h.hunger * 70);
  const bFactor = Math.round(95 - h.hunger * 50);
  const s = CFG.herbivore.size;
  const angle = Math.atan2(h.vy, h.vx);

  ctx.save();
  ctx.translate(h.x, h.y);

  if (h.variant === 1) {
    // Deer — elongated body, antlers
    ctx.rotate(angle);
    ctx.fillStyle = `rgba(${hungerPale},${gFactor - 20},${bFactor - 20},0.95)`;
    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.4, s * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    // neck + head
    ctx.beginPath();
    ctx.ellipse(s * 1.2, -s * 0.4, s * 0.5, s * 0.4, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // antlers
    ctx.strokeStyle = `rgba(${hungerPale - 30},${gFactor - 50},${bFactor - 30},0.8)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s * 1.4, -s * 0.8);
    ctx.lineTo(s * 1.1, -s * 1.6);
    ctx.lineTo(s * 0.8, -s * 1.2);
    ctx.moveTo(s * 1.1, -s * 1.6);
    ctx.lineTo(s * 1.4, -s * 1.9);
    ctx.stroke();
    // eye
    ctx.fillStyle = '#1a0f00cc';
    ctx.beginPath(); ctx.arc(s * 1.45, -s * 0.5, 1.2, 0, Math.PI * 2); ctx.fill();
    // legs (4 simple lines)
    ctx.strokeStyle = `rgba(${hungerPale - 20},${gFactor - 30},${bFactor - 20},0.7)`;
    ctx.lineWidth = 1.5;
    for (const lx of [-s * 0.6, -s * 0.1, s * 0.4, s * 0.9]) {
      ctx.beginPath();
      ctx.moveTo(lx, s * 0.6);
      ctx.lineTo(lx + (rng() - 0.5) * 2, s * 1.5);
      ctx.stroke();
    }
  } else if (h.variant === 2) {
    // Mouse — round body, long tail
    ctx.rotate(angle);
    ctx.fillStyle = `rgba(${hungerPale - 20},${gFactor - 20},${bFactor - 20},0.95)`;
    // body oval
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.1, s * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    // head
    ctx.beginPath();
    ctx.ellipse(s * 1.1, -s * 0.15, s * 0.55, s * 0.5, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.beginPath();
    ctx.ellipse(s * 0.9, -s * 0.75, s * 0.3, s * 0.45, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s * 1.25, -s * 0.7, s * 0.3, s * 0.45, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // tail
    ctx.strokeStyle = `rgba(${hungerPale - 30},${gFactor - 30},${bFactor - 30},0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.quadraticCurveTo(-s * 1.6, s * 0.8, -s * 0.5, s * 1.4);
    ctx.stroke();
    // eye
    ctx.fillStyle = '#1a0f00cc';
    ctx.beginPath(); ctx.arc(s * 1.4, -s * 0.2, 1, 0, Math.PI * 2); ctx.fill();
  } else {
    // Rabbit — default with improved detail
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(1, 2, s, s * 0.65, 0, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = `rgba(${hungerPale},${gFactor},${bFactor},0.95)`;
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.72, 0, 0, Math.PI * 2); ctx.fill();
    // highlight
    ctx.fillStyle = `rgba(255,255,255,0.18)`;
    ctx.beginPath(); ctx.ellipse(-s * 0.2, -s * 0.25, s * 0.45, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    // ears
    ctx.fillStyle = `rgba(${hungerPale},${gFactor},${bFactor},0.95)`;
    ctx.beginPath(); ctx.ellipse(-2.5, -s - 2, 1.6, 4.5, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(2.5, -s - 2, 1.6, 4.5, 0.2, 0, Math.PI * 2); ctx.fill();
    // inner ear pink
    ctx.fillStyle = `rgba(220,130,130,0.6)`;
    ctx.beginPath(); ctx.ellipse(-2.5, -s - 2, 0.7, 3, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(2.5, -s - 2, 0.7, 3, 0.2, 0, Math.PI * 2); ctx.fill();
    // eye
    ctx.fillStyle = 'rgba(30,20,10,0.9)';
    ctx.beginPath(); ctx.arc(s * 0.55, -s * 0.15, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(s * 0.65, -s * 0.25, 0.5, 0, Math.PI * 2); ctx.fill();
    // tail
    ctx.fillStyle = 'rgba(240,240,240,0.85)';
    ctx.beginPath(); ctx.arc(-s * 0.85, s * 0.2, s * 0.3, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

// ─── DRAW PREDATORS ───────────────────────────────────────────────────────────
function drawPredator(pred) {
  const hungerR = Math.round(175 - pred.hunger * 70);
  const s = CFG.predator.size;
  const angle = Math.atan2(pred.vy, pred.vx);

  ctx.save();
  ctx.translate(pred.x, pred.y);
  ctx.rotate(angle);

  if (pred.variant === 1) {
    // Hawk — bird silhouette with wings
    ctx.fillStyle = `rgba(${hungerR - 20},${Math.round(60 - pred.hunger * 30)},20,0.95)`;
    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.3, s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // wings swept back
    ctx.fillStyle = `rgba(${hungerR - 40},${Math.round(50 - pred.hunger * 25)},15,0.85)`;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, 0);
    ctx.lineTo(-s * 1.5, -s * 1.4);
    ctx.lineTo(-s * 0.8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.3, 0);
    ctx.lineTo(-s * 1.5, s * 1.4);
    ctx.lineTo(-s * 0.8, 0);
    ctx.closePath();
    ctx.fill();
    // head + beak
    ctx.fillStyle = `rgba(${hungerR},${Math.round(65 - pred.hunger * 35)},20,0.95)`;
    ctx.beginPath(); ctx.arc(s * 1.1, 0, s * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0c030';
    ctx.beginPath();
    ctx.moveTo(s * 1.55, -s * 0.1);
    ctx.lineTo(s * 2.0, 0);
    ctx.lineTo(s * 1.55, s * 0.1);
    ctx.closePath();
    ctx.fill();
    // eye
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.arc(s * 1.2, -s * 0.15, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(s * 1.2, -s * 0.15, 0.7, 0, Math.PI * 2); ctx.fill();
  } else if (pred.variant === 2) {
    // Fox — bushy tail + pointed snout
    ctx.fillStyle = `rgba(${hungerR + 20},${Math.round(80 - pred.hunger * 35)},20,0.95)`;
    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.4, s * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // head
    ctx.beginPath();
    ctx.ellipse(s * 1.35, -s * 0.2, s * 0.65, s * 0.55, 0.15, 0, Math.PI * 2);
    ctx.fill();
    // snout
    ctx.fillStyle = `rgba(${hungerR + 30},${Math.round(100 - pred.hunger * 40)},30,0.9)`;
    ctx.beginPath();
    ctx.moveTo(s * 2.1, -s * 0.05);
    ctx.lineTo(s * 1.65, -s * 0.3);
    ctx.lineTo(s * 1.65, s * 0.1);
    ctx.closePath();
    ctx.fill();
    // ears
    ctx.fillStyle = `rgba(${hungerR + 20},${Math.round(80 - pred.hunger * 35)},20,0.9)`;
    ctx.beginPath();
    ctx.moveTo(s * 1.1, -s * 0.75);
    ctx.lineTo(s * 1.4, -s * 1.45);
    ctx.lineTo(s * 1.7, -s * 0.75);
    ctx.closePath();
    ctx.fill();
    // tail
    ctx.fillStyle = `rgba(${hungerR + 20},${Math.round(80 - pred.hunger * 35)},20,0.8)`;
    ctx.beginPath();
    ctx.moveTo(-s * 1.0, 0);
    ctx.quadraticCurveTo(-s * 2.2, -s * 0.8, -s * 1.8, s * 0.6);
    ctx.closePath();
    ctx.fill();
    // white tail tip
    ctx.fillStyle = 'rgba(240,240,240,0.8)';
    ctx.beginPath(); ctx.ellipse(-s * 1.9, s * 0.4, s * 0.4, s * 0.35, 0.5, 0, Math.PI * 2); ctx.fill();
    // eye
    ctx.fillStyle = 'rgba(255,230,50,0.95)';
    ctx.beginPath(); ctx.arc(s * 1.6, -s * 0.3, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(s * 1.6, -s * 0.3, 0.7, 0, Math.PI * 2); ctx.fill();
  } else {
    // Wolf — default with improved detail
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(s * 1.4 + 1, 1); ctx.lineTo(-s + 1, -s * 0.7 + 1);
    ctx.lineTo(-s * 0.5 + 1, 1); ctx.lineTo(-s + 1, s * 0.7 + 1);
    ctx.closePath(); ctx.fill();
    // body
    ctx.fillStyle = `rgba(${hungerR},${Math.round(65 - pred.hunger * 35)},${Math.round(30 - pred.hunger * 20)},0.95)`;
    ctx.beginPath();
    ctx.moveTo(s * 1.4, 0); ctx.lineTo(-s, -s * 0.7);
    ctx.lineTo(-s * 0.5, 0); ctx.lineTo(-s, s * 0.7);
    ctx.closePath(); ctx.fill();
    // dorsal stripe
    ctx.fillStyle = `rgba(${hungerR - 30},${Math.round(40 - pred.hunger * 25)},${Math.round(18 - pred.hunger * 12)},0.5)`;
    ctx.beginPath();
    ctx.moveTo(s * 1.0, -s * 0.15); ctx.lineTo(-s * 0.7, -s * 0.45);
    ctx.lineTo(-s * 0.7, -s * 0.25); ctx.lineTo(s * 1.0, s * 0.05);
    ctx.closePath(); ctx.fill();
    // eye glint
    ctx.fillStyle = 'rgba(255,230,50,0.95)';
    ctx.beginPath(); ctx.arc(s * 0.65, -s * 0.2, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(s * 0.65, -s * 0.2, 0.85, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

// ─── DRAW CUSTOM ORGANISM ─────────────────────────────────────────────────────
function drawCustomOrganism(co) {
  const { x, y, spec } = co;
  const s = spec.size;
  const rgb = hexToRgb(spec.color);
  const hunger = co.hunger;
  const alpha = 0.85 + 0.15 * (1 - hunger);
  const darken = (1 - hunger * 0.35);
  const nocFade = (spec.nocturnal && skyBrightness > 0.55) ? 0.5 : 1;

  ctx.save();
  ctx.translate(x, y);
  const angle = Math.atan2(co.vy, co.vx);

  ctx.fillStyle = `rgba(${Math.round(rgb.r * darken)},${Math.round(rgb.g * darken)},${Math.round(rgb.b * darken)},${alpha * nocFade})`;
  ctx.strokeStyle = `rgba(255,255,255,${0.3 * nocFade})`;
  ctx.lineWidth = 0.8;

  if (spec.shape === 'spike') {
    ctx.rotate(angle);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r2 = i % 2 === 0 ? s * 1.5 : s * 0.5;
      if (i === 0) ctx.moveTo(Math.cos(a) * r2, Math.sin(a) * r2);
      else ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (spec.shape === 'star') {
    ctx.rotate(angle);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r2 = i % 2 === 0 ? s * 1.4 : s * 0.55;
      if (i === 0) ctx.moveTo(Math.cos(a) * r2, Math.sin(a) * r2);
      else ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (spec.shape === 'square') {
    ctx.rotate(angle + Math.PI / 4);
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.strokeRect(-s, -s, s * 2, s * 2);
  } else if (spec.shape === 'diamond') {
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.5); ctx.lineTo(s * 0.9, 0);
    ctx.lineTo(0, s * 1.5); ctx.lineTo(-s * 0.9, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (spec.shape === 'arrow') {
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(s * 1.7, 0);
    ctx.lineTo(-s, -s * 0.85);
    ctx.lineTo(-s * 0.4, 0);
    ctx.lineTo(-s, s * 0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,100,0.9)';
    ctx.beginPath(); ctx.arc(s * 0.75, -s * 0.28, 1.5, 0, Math.PI * 2); ctx.fill();
  } else if (spec.shape === 'blob') {
    // Wobbly blob using bezier
    ctx.rotate(angle);
    const wobble = simTime * 2;
    ctx.beginPath();
    ctx.moveTo(s * 1.3, 0);
    ctx.bezierCurveTo(
      s * 0.6, -s * (1.2 + Math.sin(wobble) * 0.2),
      -s * 0.6, -s * (1.1 + Math.cos(wobble * 1.3) * 0.2),
      -s * 1.2, 0
    );
    ctx.bezierCurveTo(
      -s * 0.6, s * (1.1 + Math.sin(wobble * 0.9) * 0.2),
      s * 0.6, s * (1.2 + Math.cos(wobble) * 0.2),
      s * 1.3, 0
    );
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // nucleus
    ctx.fillStyle = `rgba(255,255,255,0.25)`;
    ctx.beginPath(); ctx.arc(0, 0, s * 0.35, 0, Math.PI * 2); ctx.fill();
  } else if (spec.shape === 'tri') {
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(s * 1.6, 0);
    ctx.lineTo(-s * 0.9, -s * 1.1);
    ctx.lineTo(-s * 0.9, s * 1.1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,100,0.9)';
    ctx.beginPath(); ctx.arc(s * 0.6, -s * 0.25, 1.4, 0, Math.PI * 2); ctx.fill();
  } else {
    // circle with highlight + outline
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,0.28)`;
    ctx.beginPath();
    ctx.arc(-s * 0.3, -s * 0.3, s * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }

  // Name label (tiny, only when population ≤ 3)
  const sameSpeciesCount = customOrganisms.filter(o => o.spec.name === spec.name).length;
  if (sameSpeciesCount <= 3) {
    ctx.fillStyle = `rgba(255,255,255,${0.9 * nocFade})`;
    ctx.font = `bold 9px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(spec.name.slice(0, 8), 0, -s - 3);
  }

  ctx.restore();
}

// ─── DRAW ─────────────────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  // sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  grad.addColorStop(0, skyColor());
  grad.addColorStop(1, groundColor());
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = groundColor();
  ctx.fillRect(0, H * 0.55, W, H);

  // stars at night
  if (skyBrightness < 0.5) {
    const starAlpha = (0.5 - skyBrightness) * 1.5;
    ctx.fillStyle = `rgba(255,255,255,${starAlpha})`;
    const starRng = mkRng(42);
    for (let i = 0; i < 70; i++) {
      const sx = starRng() * W;
      const sy = starRng() * H * 0.52;
      const sr = 0.5 + starRng() * 1.0;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
  }

  // rain / storm particles
  if (weather === 'rain' || weather === 'storm') {
    ctx.strokeStyle = `rgba(150,190,230,${weather === 'storm' ? 0.5 : 0.3})`;
    ctx.lineWidth = 1;
    const drops = weather === 'storm' ? 70 : 35;
    for (let i = 0; i < drops; i++) {
      const x = ((rng() * W + simTime * 30) % W);
      const y = ((rng() * H + simTime * 65) % H);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 9); ctx.stroke();
    }
  }

  if (weather === 'drought') {
    ctx.fillStyle = 'rgba(200,140,60,0.09)';
    ctx.fillRect(0, 0, W, H);
  }

  for (const p of plants) drawPlant(p);
  for (const h of herbivores) drawHerbivore(h);
  for (const pred of predators) drawPredator(pred);
  for (const co of customOrganisms) drawCustomOrganism(co);

  // HUD clock
  const m = Math.floor(realTime / 60);
  const s = Math.floor(realTime % 60);
  document.getElementById('clock').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── SNAPSHOT ─────────────────────────────────────────────────────────────────
function snapshotCanvas() {
  const oc = document.createElement('canvas');
  oc.width = W; oc.height = H;
  const oc2 = oc.getContext('2d');
  oc2.drawImage(canvas, 0, 0);
  const { title } = classifyState();
  oc2.fillStyle = 'rgba(43,29,14,0.72)';
  oc2.fillRect(0, H - 64, W, 64);
  oc2.fillStyle = '#f5ede0';
  oc2.font = `bold ${Math.min(28, W / 14)}px "Special Elite", serif`;
  oc2.textAlign = 'center';
  oc2.fillText(title, W / 2, H - 36);
  oc2.font = `${Math.min(16, W / 24)}px monospace`;
  oc2.fillStyle = 'rgba(245,237,224,0.7)';
  oc2.fillText(`Ecosystem Collapse Diorama · T+${fmtT(simTime)}`, W / 2, H - 14);
  return oc.toDataURL('image/png');
}

function share() {
  if (navigator.share) {
    navigator.share({ title: 'Ecosystem Collapse Diorama', url: location.href });
  } else {
    navigator.clipboard.writeText(location.href).then(() => alert('Link copied!'));
  }
}

// ─── ADD ORGANISM MODAL ───────────────────────────────────────────────────────
function openAddOrganism() {
  document.getElementById('add-organism-overlay').classList.add('open');
  document.getElementById('org-name-input').focus();
  document.getElementById('org-gen-result').style.display = 'none';
  document.getElementById('org-release').disabled = false;
  _pendingSpec = null;
}

function closeAddOrganism() {
  document.getElementById('add-organism-overlay').classList.remove('open');
  document.getElementById('org-gen-result').style.display = 'none';
  document.getElementById('org-gen-result').textContent = '';
}

async function generateAndPreview() {
  const name = document.getElementById('org-name-input').value.trim() || 'Mystery';
  const desc = document.getElementById('org-desc-input').value.trim();
  if (!desc) {
    document.getElementById('org-gen-result').style.display = 'block';
    document.getElementById('org-gen-result').textContent = 'Describe your organism first.';
    return null;
  }

  const resultEl = document.getElementById('org-gen-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<em>Generating with AI…</em>';

  let spec = await generateOrganismSpecAI(name, desc);
  if (!spec) {
    spec = generateOrganismSpecLocal(name, desc);
    spec._source = 'local';
  } else {
    spec._source = 'ai';
  }

  const dietLabel = { plants: 'herbivore (eats plants)', herbivores: 'predator (hunts herbivores)', predators: 'apex predator (hunts predators)', omnivore: 'omnivore (eats both)' };
  const speedLabel = spec.maxSpeed > 1.9 ? 'fast' : spec.maxSpeed < 0.65 ? 'slow' : 'medium';
  const sizeLabel = spec.size > 10 ? 'large' : spec.size < 4 ? 'tiny' : 'medium';
  const metaLabel = spec.hungerTick < 0.002 ? 'efficient' : spec.hungerTick > 0.004 ? 'hungry' : 'normal';
  const aggrLabel = spec.aggression > 0.7 ? 'aggressive' : spec.aggression < 0.3 ? 'passive' : 'neutral';
  const sourceTag = spec._source === 'ai' ? '<span style="color:#4a8;font-size:11px">✓ AI-generated</span>' : '<span style="color:#a84;font-size:11px">heuristic</span>';

  resultEl.innerHTML =
    `<strong>${spec.name}</strong> · ${dietLabel[spec.eats] || spec.eats} ${sourceTag}<br>` +
    `Size: ${sizeLabel} &nbsp;|&nbsp; Speed: ${speedLabel} &nbsp;|&nbsp; Color: <span style="display:inline-block;width:12px;height:12px;background:${spec.color};border:1px solid #fff;vertical-align:middle;border-radius:2px"></span><br>` +
    `Max pop: ${spec.maxPop} &nbsp;|&nbsp; Metabolism: ${metaLabel}<br>` +
    `Aggression: ${aggrLabel} &nbsp;|&nbsp; Sense: ${spec.senseRadius}px &nbsp;|&nbsp; Flocks: ${spec.flockRadius > 0 ? 'yes' : 'no'}<br>` +
    `Nocturnal: ${spec.nocturnal ? 'yes' : 'no'} &nbsp;|&nbsp; Lifespan: ~${Math.round(spec.lifespan)}s &nbsp;|&nbsp; Shape: ${spec.shape}`;

  return spec;
}

let _pendingSpec = null;

async function confirmAddOrganism() {
  _pendingSpec = await generateAndPreview();
}

async function releaseOrganism() {
  if (!_pendingSpec) {
    const spec = await generateAndPreview();
    if (!spec) return;
    _pendingSpec = spec;
  }
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < 3; i++) {
    customOrganisms.push(mkCustomOrganism(
      cx + (rng() - 0.5) * 80,
      cy + (rng() - 0.5) * 80,
      _pendingSpec
    ));
  }
  closeAddOrganism();
  _pendingSpec = null;
}

// ─── PRESETS UI ───────────────────────────────────────────────────────────────
function buildPresetsUI() {
  const footer = document.getElementById('controls');
  const wrap = document.createElement('div');
  wrap.id = 'preset-wrap';
  wrap.innerHTML = `<span id="preset-label">Preset:</span>`;

  const defaultBtn = document.createElement('button');
  defaultBtn.id = 'preset-default';
  defaultBtn.textContent = '🌿 Default';
  defaultBtn.className = 'preset-btn active';
  defaultBtn.addEventListener('click', () => {
    activePreset = null;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    defaultBtn.classList.add('active');
    initSim(Date.now(), null);
    document.getElementById('report-overlay').style.display = 'none';
    paused = false;
  });
  wrap.appendChild(defaultBtn);

  for (const [key, preset] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.className = 'preset-btn';
    btn.title = preset.description;
    btn.addEventListener('click', () => {
      activePreset = preset;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      initSim(Date.now(), preset);
      document.getElementById('report-overlay').style.display = 'none';
      paused = false;
    });
    wrap.appendChild(btn);
  }

  footer.appendChild(wrap);
}

// ─── LOOP ─────────────────────────────────────────────────────────────────────
let lastTs = null;

function loop(ts) {
  requestAnimationFrame(loop);
  if (!lastTs) { lastTs = ts; return; }
  const rawDt = Math.min((ts - lastTs) / 1000, 0.1);
  lastTs = ts;

  if (!paused) {
    const steps = Math.max(1, Math.round(speed));
    const dt = rawDt * speed / steps;
    for (let i = 0; i < steps; i++) tick(dt);
  }

  draw();
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
function resize() {
  const wrap = document.getElementById('canvas-wrap');
  W = canvas.width = wrap.clientWidth;
  H = canvas.height = wrap.clientHeight;
}

document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('world');
  ctx = canvas.getContext('2d');

  resize();
  window.addEventListener('resize', () => { resize(); });

  buildPresetsUI();
  initSim(Date.now(), null);

  document.getElementById('btn-reset').addEventListener('click', () => {
    initSim(Date.now(), activePreset);
    document.getElementById('report-overlay').style.display = 'none';
    paused = false;
  });

  document.getElementById('speed-slider').addEventListener('input', e => {
    speed = parseFloat(e.target.value);
    document.getElementById('speed-val').textContent = speed + '×';
  });

  document.getElementById('btn-snapshot').addEventListener('click', () => {
    const dataURL = snapshotCanvas();
    const a = document.createElement('a');
    a.download = `ecosystem-report-${Date.now()}.png`;
    a.href = dataURL;
    a.click();
  });

  document.getElementById('btn-add-organism').addEventListener('click', openAddOrganism);

  document.getElementById('org-cancel').addEventListener('click', closeAddOrganism);
  document.getElementById('org-preview').addEventListener('click', async () => {
    _pendingSpec = await generateAndPreview();
  });
  document.getElementById('org-release').addEventListener('click', releaseOrganism);

  document.getElementById('add-organism-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddOrganism();
  });

  // Preset quick-access buttons in modal
  const presetHints = [
    { label: 'Giant Slow Predator', name: 'Behemoth', desc: 'Giant slow apex predator that hunts predators. Solitary, efficient metabolism, dark colored.' },
    { label: 'Swarm Herbivore', name: 'Gnathid', desc: 'Tiny fast blue herbivore that swarms in huge colonies. Prolific breeder, eats plants.' },
    { label: 'Nocturnal Hunter', name: 'Shadowmaw', desc: 'Medium nocturnal predator with keen senses. Hunts herbivores at night, black, arrow-shaped.' },
    { label: 'Omnivore Blob', name: 'Oozekin', desc: 'Slow green omnivore blob. Eats both plants and herbivores. Moderate population, efficient.' },
  ];

  const presetRow = document.createElement('div');
  presetRow.id = 'org-preset-hints';
  presetRow.innerHTML = '<div class="org-label" style="margin-top:12px">Quick presets:</div>';
  for (const ph of presetHints) {
    const btn = document.createElement('button');
    btn.className = 'org-hint-btn';
    btn.textContent = ph.label;
    btn.addEventListener('click', () => {
      document.getElementById('org-name-input').value = ph.name;
      document.getElementById('org-desc-input').value = ph.desc;
    });
    presetRow.appendChild(btn);
  }

  const orgActions = document.getElementById('org-actions');
  orgActions.parentNode.insertBefore(presetRow, orgActions);

  requestAnimationFrame(loop);
});
