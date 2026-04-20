// Ecosystem Collapse Diorama
// Interactive procedural ecosystem — watch it evolve, then add your own organisms

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CFG = {
  plant:     { max: 160, growRate: 0.028, size: 5 },
  herbivore: { init: 22, maxSpeed: 1.1, senseRadius: 70, eatRadius: 9, hungerTick: 0.003, repro: 0.00022, size: 5 },
  predator:  { init: 5,  maxSpeed: 1.5, senseRadius: 100, killRadius: 11, hungerTick: 0.002, repro: 0.00010, size: 7 },
  milestone: 5 * 60,   // seconds between reports (5 minutes = 300s)
};

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
  return { x, y, age: rng() * 30, size: CFG.plant.size * (0.5 + rng() * 0.8), kind: 'plant' };
}

function mkHerbivore(x, y) {
  return {
    x, y,
    vx: (rng() - 0.5) * CFG.herbivore.maxSpeed,
    vy: (rng() - 0.5) * CFG.herbivore.maxSpeed,
    hunger: rng() * 0.4,
    age: 0,
    kind: 'herbivore',
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
function generateOrganismSpec(name, description) {
  const desc = description.toLowerCase();

  // Size cues
  let size = 6;
  if (/giant|huge|massive|large|big/.test(desc)) size = 11;
  else if (/tiny|small|micro|mini/.test(desc)) size = 3;
  else if (/medium|mid/.test(desc)) size = 6;

  // Speed cues
  let maxSpeed = 1.2;
  if (/fast|quick|swift|rapid|speedy|dash/.test(desc)) maxSpeed = 2.2;
  else if (/slow|sluggish|crawl|plod/.test(desc)) maxSpeed = 0.5;
  else if (/medium|moderate/.test(desc)) maxSpeed = 1.2;

  // Diet / trophic role
  let eats = 'plants'; // default herbivore
  if (/eat.*predator|hunt.*predator|kill.*predator|apex|super.?predator/.test(desc)) eats = 'predators';
  else if (/eat.*herb|hunt.*herb|hunt.*rabbit|hunt.*prey|carnivore|predator|hunter|wolf|fox|hawk|eagle|lion|tiger/.test(desc)) eats = 'herbivores';
  else if (/omnivore|eat.*everything|eat.*all|eat.*both/.test(desc)) eats = 'omnivore';
  else if (/plant|herb|grass|leaf|vegan|vegetar/.test(desc)) eats = 'plants';
  else if (/parasite|drain|leech/.test(desc)) eats = 'herbivores';

  // Hunger / metabolism
  let hungerTick = 0.0028;
  if (/hungry|starv|metabolism|fast-burn|high.?energy/.test(desc)) hungerTick = 0.005;
  else if (/efficient|slow.?burn|low.?energy|patient/.test(desc)) hungerTick = 0.0015;

  // Reproduction
  let repro = 0.00015;
  if (/breed|prolific|rapid.?repro|multiply|swarm|colony/.test(desc)) repro = 0.0004;
  else if (/rare|solitary|slow.?repro|lone/.test(desc)) repro = 0.00006;

  // Sense radius
  let senseRadius = 75;
  if (/blind|near.?sighted|tunnel.?vision/.test(desc)) senseRadius = 25;
  else if (/keen|eagle.?eye|sharp|detect|sense|aware/.test(desc)) senseRadius = 130;

  // Max population
  let maxPop = 30;
  if (/swarm|horde|colony|herd/.test(desc)) maxPop = 60;
  else if (/solitary|lone|rare/.test(desc)) maxPop = 8;

  // Color — pick from vivid hues based on keywords
  let color = '#e07020';
  const colorMap = [
    [/red|fire|flame|blood/, '#e82020'],
    [/blue|ocean|water|ice/, '#2060e8'],
    [/green|forest|fern|moss/, '#20a830'],
    [/purple|violet|mystic|magic/, '#9020e0'],
    [/yellow|gold|sun|bright/, '#e0c020'],
    [/cyan|teal|aqua/, '#20c8c8'],
    [/pink|rose|fuchsia/, '#e040a0'],
    [/white|pale|ghost|bright/, '#d0d0d0'],
    [/black|dark|shadow|night/, '#404040'],
    [/orange|amber|rust/, '#e07020'],
  ];
  for (const [re, c] of colorMap) {
    if (re.test(desc)) { color = c; break; }
  }

  // Shape — simple polygon type
  let shape = 'circle';
  if (/spike|spiky|angular|sharp|crystal|star/.test(desc)) shape = 'star';
  else if (/square|box|cube|block/.test(desc)) shape = 'square';
  else if (/diamond|rhombus/.test(desc)) shape = 'diamond';
  else if (/arrow|dart|swift|missile/.test(desc)) shape = 'arrow';

  // Kill/eat radius
  const eatRadius = Math.max(size, 8);

  return {
    name: name || 'Unknown',
    description,
    eats,
    size,
    maxSpeed,
    hungerTick,
    repro,
    senseRadius,
    eatRadius,
    maxPop,
    color,
    shape,
    lifespan: 1000 + rng() * 500,
  };
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function initSim(seed) {
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

  for (let i = 0; i < CFG.plant.max * 0.65; i++)
    plants.push(mkPlant(rng() * W, rng() * H));
  for (let i = 0; i < CFG.herbivore.init; i++)
    herbivores.push(mkHerbivore(rng() * W, rng() * H));
  for (let i = 0; i < CFG.predator.init; i++)
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

// day/night cycle ~4 min per day
function tickDayNight(dt) {
  dayTimer += dt;
  const period = 240;
  const phase = (dayTimer % period) / period;
  skyBrightness = Math.max(0.1, Math.sin(phase * Math.PI * 2) * 0.5 + 0.6);
}

// ─── DIST ─────────────────────────────────────────────────────────────────────
function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function steer(entity, tx, ty, speed) {
  const dx = tx - entity.x, dy = ty - entity.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  entity.vx += (dx / d) * speed * 0.15;
  entity.vy += (dy / d) * speed * 0.15;
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

  // Plant growth — improved: guaranteed minimum growth, seeds spread more
  const growMod = weather === 'rain' ? 2.2 : weather === 'drought' ? 0.25 : weather === 'storm' ? 0.7 : 1;
  const growNight = 0.3 + skyBrightness * 0.7; // plants still grow a bit at night
  const maxGrowthRolls = Math.ceil(CFG.plant.max / 20);
  for (let i = 0; i < maxGrowthRolls; i++) {
    if (plants.length >= CFG.plant.max) break;
    if (rng() < CFG.plant.growRate * dt * 60 * growMod * growNight) {
      const parent = plants.length ? plants[Math.floor(rng() * plants.length)] : { x: rng() * W, y: rng() * H };
      plants.push(mkPlant(
        parent.x + (rng() - 0.5) * 50,
        parent.y + (rng() - 0.5) * 50
      ));
    }
  }

  // Herbivores
  const nextHerbs = [];
  for (const h of herbivores) {
    h.age += dt;
    const hungerMod = weather === 'storm' ? 1.4 : 1;
    h.hunger += CFG.herbivore.hungerTick * dt * 60 * hungerMod;

    let nearestPlant = null, nearestPDist = Infinity;
    for (const p of plants) {
      const d = dist(h, p);
      if (d < nearestPDist) { nearestPDist = d; nearestPlant = p; }
    }

    let flee = false;
    for (const pred of predators) {
      if (dist(h, pred) < CFG.herbivore.senseRadius) {
        steer(h, h.x - (pred.x - h.x), h.y - (pred.y - h.y), CFG.herbivore.maxSpeed * 1.5);
        flee = true;
      }
    }
    // also flee custom predators
    for (const co of customOrganisms) {
      if ((co.spec.eats === 'herbivores' || co.spec.eats === 'omnivore') && dist(h, co) < CFG.herbivore.senseRadius) {
        steer(h, h.x - (co.x - h.x), h.y - (co.y - h.y), CFG.herbivore.maxSpeed * 1.4);
        flee = true;
      }
    }

    if (!flee && nearestPlant && nearestPDist < CFG.herbivore.senseRadius) {
      steer(h, nearestPlant.x, nearestPlant.y, CFG.herbivore.maxSpeed);
    } else if (!flee) {
      h.vx += (rng() - 0.5) * 0.3;
      h.vy += (rng() - 0.5) * 0.3;
    }

    clampSpeed(h, CFG.herbivore.maxSpeed);
    h.x += h.vx; h.y += h.vy;
    wrap(h);

    if (nearestPlant && nearestPDist < CFG.herbivore.eatRadius) {
      plants.splice(plants.indexOf(nearestPlant), 1);
      h.hunger = Math.max(0, h.hunger - 0.55);
    }

    if (h.hunger >= 1 || h.age > 900) continue;

    if (h.hunger < 0.45 && herbivores.length < 80 && rng() < CFG.herbivore.repro * dt * 60)
      nextHerbs.push(mkHerbivore(h.x, h.y));

    nextHerbs.push(h);
  }

  if (herbivores.length > 0 && nextHerbs.length === 0)
    extinctionLog.push({ time: simTime, species: 'herbivore' });
  herbivores = nextHerbs;

  // Predators
  const nextPreds = [];
  for (const pred of predators) {
    pred.age += dt;
    pred.hunger += CFG.predator.hungerTick * dt * 60;

    let nearestH = null, nearestHDist = Infinity;
    for (const h of herbivores) {
      const d = dist(pred, h);
      if (d < nearestHDist) { nearestHDist = d; nearestH = h; }
    }

    if (nearestH && nearestHDist < CFG.predator.senseRadius) {
      steer(pred, nearestH.x, nearestH.y, CFG.predator.maxSpeed);
    } else {
      pred.vx += (rng() - 0.5) * 0.2;
      pred.vy += (rng() - 0.5) * 0.2;
    }

    clampSpeed(pred, CFG.predator.maxSpeed);
    pred.x += pred.vx; pred.y += pred.vy;
    wrap(pred);

    if (nearestH && nearestHDist < CFG.predator.killRadius) {
      const idx = herbivores.indexOf(nearestH);
      if (idx !== -1) herbivores.splice(idx, 1);
      pred.hunger = Math.max(0, pred.hunger - 0.75);
    }

    if (pred.hunger >= 1 || pred.age > 1200) continue;

    if (pred.hunger < 0.4 && predators.length < 20 && rng() < CFG.predator.repro * dt * 60)
      nextPreds.push(mkPredator(pred.x, pred.y));

    nextPreds.push(pred);
  }

  if (predators.length > 0 && nextPreds.length === 0)
    extinctionLog.push({ time: simTime, species: 'predator' });
  predators = nextPreds;

  // Custom organisms
  const nextCustom = [];
  for (const co of customOrganisms) {
    co.age += dt;
    co.hunger += co.spec.hungerTick * dt * 60;

    // Find prey based on diet
    let prey = null, preyDist = Infinity, preyList = [];
    if (co.spec.eats === 'plants') preyList = plants;
    else if (co.spec.eats === 'herbivores') preyList = herbivores;
    else if (co.spec.eats === 'predators') preyList = predators;
    else if (co.spec.eats === 'omnivore') preyList = [...herbivores, ...plants];

    for (const p of preyList) {
      const d = dist(co, p);
      if (d < preyDist) { preyDist = d; prey = p; }
    }

    if (prey && preyDist < co.spec.senseRadius) {
      steer(co, prey.x, prey.y, co.spec.maxSpeed);
    } else {
      co.vx += (rng() - 0.5) * 0.25;
      co.vy += (rng() - 0.5) * 0.25;
    }

    clampSpeed(co, co.spec.maxSpeed);
    co.x += co.vx; co.y += co.vy;
    wrap(co);

    // Eat prey
    if (prey && preyDist < co.spec.eatRadius) {
      if (co.spec.eats === 'plants') {
        const idx = plants.indexOf(prey);
        if (idx !== -1) { plants.splice(idx, 1); co.hunger = Math.max(0, co.hunger - 0.5); }
      } else if (co.spec.eats === 'herbivores') {
        const idx = herbivores.indexOf(prey);
        if (idx !== -1) { herbivores.splice(idx, 1); co.hunger = Math.max(0, co.hunger - 0.7); }
      } else if (co.spec.eats === 'predators') {
        const idx = predators.indexOf(prey);
        if (idx !== -1) { predators.splice(idx, 1); co.hunger = Math.max(0, co.hunger - 0.7); }
      } else if (co.spec.eats === 'omnivore') {
        const ih = herbivores.indexOf(prey);
        const ip = plants.indexOf(prey);
        if (ih !== -1) { herbivores.splice(ih, 1); co.hunger = Math.max(0, co.hunger - 0.65); }
        else if (ip !== -1) { plants.splice(ip, 1); co.hunger = Math.max(0, co.hunger - 0.4); }
      }
    }

    if (co.hunger >= 1 || co.age > co.spec.lifespan) continue;

    const sameSpecies = customOrganisms.filter(o => o.spec.name === co.spec.name);
    if (co.hunger < 0.4 && sameSpecies.length < co.spec.maxPop && rng() < co.spec.repro * dt * 60) {
      nextCustom.push(mkCustomOrganism(co.x + (rng() - 0.5) * 10, co.y + (rng() - 0.5) * 10, co.spec));
    }

    nextCustom.push(co);
  }
  customOrganisms = nextCustom;

  // HUD
  updatePopCounts();

  const milestoneIndex = Math.floor(simTime / CFG.milestone);
  if (milestoneIndex > lastMilestone) {
    lastMilestone = milestoneIndex;
    showReport(milestoneIndex);
  }
}

function updatePopCounts() {
  let txt = `🌿${plants.length} 🐇${herbivores.length} 🦊${predators.length}`;
  // group custom by species
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
  const elapsed = fmtT(simTime);

  document.getElementById('report-time').textContent = `T+${elapsed} · Report #${idx + 1}`;
  document.getElementById('report-title').textContent = title;
  document.getElementById('report-body').textContent = body;

  const overlay = document.getElementById('report-overlay');
  overlay.style.display = 'flex';
  paused = true;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('report-dismiss').addEventListener('click', () => {
    document.getElementById('report-overlay').style.display = 'none';
    paused = false;
  });
});

// ─── RENDER ───────────────────────────────────────────────────────────────────
function skyColor() {
  const t = skyBrightness;
  const r = Math.round(13 + (135 - 13) * t);
  const g = Math.round(27 + (206 - 27) * t);
  const b = Math.round(42 + (235 - 42) * t);
  return `rgb(${r},${g},${b})`;
}

function groundColor() {
  const t = skyBrightness;
  const r = Math.round(20 + (58 - 20) * t);
  const g = Math.round(30 + (107 - 30) * t);
  const b = Math.round(10 + (26 - 10) * t);
  return `rgb(${r},${g},${b})`;
}

// Parse hex color to rgb object
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function drawCustomOrganism(co) {
  const { x, y, spec } = co;
  const s = spec.size;
  const rgb = hexToRgb(spec.color);
  const hunger = co.hunger;
  const alpha = 0.85 + 0.15 * (1 - hunger);
  ctx.fillStyle = `rgba(${Math.round(rgb.r * (1 - hunger * 0.4))},${Math.round(rgb.g * (1 - hunger * 0.4))},${Math.round(rgb.b * (1 - hunger * 0.4))},${alpha})`;

  ctx.save();
  ctx.translate(x, y);
  const angle = Math.atan2(co.vy, co.vx);

  if (spec.shape === 'star') {
    ctx.rotate(angle);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r2 = i % 2 === 0 ? s * 1.4 : s * 0.6;
      if (i === 0) ctx.moveTo(Math.cos(a) * r2, Math.sin(a) * r2);
      else ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    }
    ctx.closePath();
    ctx.fill();
  } else if (spec.shape === 'square') {
    ctx.rotate(angle + Math.PI / 4);
    ctx.fillRect(-s, -s, s * 2, s * 2);
  } else if (spec.shape === 'diamond') {
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.4);
    ctx.lineTo(s, 0);
    ctx.lineTo(0, s * 1.4);
    ctx.lineTo(-s, 0);
    ctx.closePath();
    ctx.fill();
  } else if (spec.shape === 'arrow') {
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(s * 1.6, 0);
    ctx.lineTo(-s, -s * 0.8);
    ctx.lineTo(-s * 0.4, 0);
    ctx.lineTo(-s, s * 0.8);
    ctx.closePath();
    ctx.fill();
    // eye glint
    ctx.fillStyle = 'rgba(255,255,100,0.9)';
    ctx.beginPath();
    ctx.arc(s * 0.7, -s * 0.25, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // circle default
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fill();
    // highlight
    ctx.fillStyle = `rgba(255,255,255,0.25)`;
    ctx.beginPath();
    ctx.arc(-s * 0.25, -s * 0.25, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Name label (tiny, only shown if >3 of same species)
  const sameSpeciesCount = customOrganisms.filter(o => o.spec.name === spec.name).length;
  if (sameSpeciesCount <= 3) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `bold 9px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(spec.name.slice(0, 6), 0, -s - 3);
  }

  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  grad.addColorStop(0, skyColor());
  grad.addColorStop(1, groundColor());
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ground
  ctx.fillStyle = groundColor();
  ctx.fillRect(0, H * 0.55, W, H);

  // stars at night
  if (skyBrightness < 0.5) {
    const starAlpha = (0.5 - skyBrightness) * 1.5;
    ctx.fillStyle = `rgba(255,255,255,${starAlpha})`;
    // deterministic star positions using a fixed offset
    const starRng = mkRng(42);
    for (let i = 0; i < 60; i++) {
      const sx = starRng() * W;
      const sy = starRng() * H * 0.52;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // rain / storm particles
  if (weather === 'rain' || weather === 'storm') {
    ctx.strokeStyle = `rgba(150,190,230,${weather === 'storm' ? 0.5 : 0.3})`;
    ctx.lineWidth = 1;
    const drops = weather === 'storm' ? 60 : 30;
    for (let i = 0; i < drops; i++) {
      const x = ((rng() * W + simTime * 30) % W);
      const y = ((rng() * H + simTime * 60) % H);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 8);
      ctx.stroke();
    }
  }

  // drought haze
  if (weather === 'drought') {
    ctx.fillStyle = 'rgba(200,140,60,0.08)';
    ctx.fillRect(0, 0, W, H);
  }

  // Plants — improved visuals with stem
  for (const p of plants) {
    const glow = 0.55 + skyBrightness * 0.45;
    const g = Math.round(150 * glow);
    const r = Math.round(40 * glow);
    const b = Math.round(25 * glow);

    // stem
    ctx.strokeStyle = `rgba(${r},${g - 30},${b},0.7)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + p.size);
    ctx.lineTo(p.x, p.y + p.size * 2.5);
    ctx.stroke();

    // foliage — 3 overlapping lobes
    ctx.fillStyle = `rgba(${r},${g},${b},0.92)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${Math.round(r * 1.1)},${Math.round(g * 1.15)},${b},0.7)`;
    ctx.beginPath();
    ctx.arc(p.x - p.size * 0.65, p.y - p.size * 0.5, p.size * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x + p.size * 0.65, p.y - p.size * 0.5, p.size * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }

  // Herbivores — improved with better shading
  for (const h of herbivores) {
    const hungerPale = Math.round(215 - h.hunger * 90);
    const gFactor = Math.round(165 - h.hunger * 70);
    ctx.fillStyle = `rgba(${hungerPale},${gFactor},${Math.round(95 - h.hunger * 50)},0.95)`;
    // body shadow
    ctx.fillStyle = `rgba(0,0,0,0.2)`;
    ctx.beginPath();
    ctx.ellipse(h.x + 1, h.y + 2, CFG.herbivore.size, CFG.herbivore.size * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = `rgba(${hungerPale},${gFactor},${Math.round(95 - h.hunger * 50)},0.95)`;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, CFG.herbivore.size, CFG.herbivore.size * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.beginPath();
    ctx.ellipse(h.x - 2.5, h.y - CFG.herbivore.size - 2, 1.5, 4, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(h.x + 2.5, h.y - CFG.herbivore.size - 2, 1.5, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // eye
    ctx.fillStyle = 'rgba(30,20,10,0.9)';
    ctx.beginPath();
    ctx.arc(h.x + 3, h.y - 1, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Predators — improved with sharper form
  for (const pred of predators) {
    const hungerR = Math.round(175 - pred.hunger * 70);
    const s = CFG.predator.size;
    ctx.save();
    ctx.translate(pred.x, pred.y);
    const angle = Math.atan2(pred.vy, pred.vx);
    ctx.rotate(angle);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(s * 1.4 + 1, 1);
    ctx.lineTo(-s + 1, -s * 0.7 + 1);
    ctx.lineTo(-s * 0.5 + 1, 1);
    ctx.lineTo(-s + 1, s * 0.7 + 1);
    ctx.closePath();
    ctx.fill();
    // body
    ctx.fillStyle = `rgba(${hungerR},${Math.round(65 - pred.hunger * 35)},${Math.round(30 - pred.hunger * 20)},0.95)`;
    ctx.beginPath();
    ctx.moveTo(s * 1.4, 0);
    ctx.lineTo(-s, -s * 0.7);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(-s, s * 0.7);
    ctx.closePath();
    ctx.fill();
    // eye glint
    ctx.fillStyle = 'rgba(255,230,50,0.95)';
    ctx.beginPath();
    ctx.arc(s * 0.65, -s * 0.2, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Custom organisms
  for (const co of customOrganisms) {
    drawCustomOrganism(co);
  }

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
  const elapsed = fmtT(simTime);
  oc2.fillStyle = 'rgba(43,29,14,0.72)';
  oc2.fillRect(0, H - 64, W, 64);
  oc2.fillStyle = '#f5ede0';
  oc2.font = `bold ${Math.min(28, W / 14)}px "Special Elite", serif`;
  oc2.textAlign = 'center';
  oc2.fillText(title, W / 2, H - 36);
  oc2.font = `${Math.min(16, W / 24)}px monospace`;
  oc2.fillStyle = 'rgba(245,237,224,0.7)';
  oc2.fillText(`Ecosystem Collapse Diorama · T+${elapsed}`, W / 2, H - 14);
  return oc.toDataURL('image/png');
}

// ─── SHARE ────────────────────────────────────────────────────────────────────
function share() {
  if (navigator.share) {
    navigator.share({ title: 'Ecosystem Collapse Diorama', url: location.href });
  } else {
    navigator.clipboard.writeText(location.href)
      .then(() => alert('Link copied!'));
  }
}

// ─── ADD ORGANISM MODAL ───────────────────────────────────────────────────────
function openAddOrganism() {
  document.getElementById('add-organism-overlay').classList.add('open');
  document.getElementById('org-name-input').focus();
}

function closeAddOrganism() {
  document.getElementById('add-organism-overlay').classList.remove('open');
  document.getElementById('org-gen-result').style.display = 'none';
  document.getElementById('org-gen-result').textContent = '';
}

function generateAndPreview() {
  const name = document.getElementById('org-name-input').value.trim() || 'Mystery';
  const desc = document.getElementById('org-desc-input').value.trim();
  if (!desc) {
    document.getElementById('org-gen-result').style.display = 'block';
    document.getElementById('org-gen-result').textContent = 'Describe your organism first.';
    return null;
  }

  const spec = generateOrganismSpec(name, desc);

  // Show generated rules
  const dietLabel = { plants: 'herbivore (eats plants)', herbivores: 'predator (hunts herbivores)', predators: 'apex predator (hunts predators)', omnivore: 'omnivore (eats both)' };
  const speedLabel = spec.maxSpeed > 1.8 ? 'fast' : spec.maxSpeed < 0.7 ? 'slow' : 'medium';
  const sizeLabel = spec.size > 9 ? 'large' : spec.size < 4 ? 'tiny' : 'medium';
  document.getElementById('org-gen-result').style.display = 'block';
  document.getElementById('org-gen-result').innerHTML =
    `<strong>${spec.name}</strong> · ${dietLabel[spec.eats] || spec.eats}<br>` +
    `Size: ${sizeLabel} &nbsp;|&nbsp; Speed: ${speedLabel} &nbsp;|&nbsp; Color: <span style="display:inline-block;width:12px;height:12px;background:${spec.color};border:1px solid #fff;vertical-align:middle;border-radius:2px"></span><br>` +
    `Max pop: ${spec.maxPop} &nbsp;|&nbsp; Metabolism: ${spec.hungerTick < 0.002 ? 'efficient' : spec.hungerTick > 0.004 ? 'hungry' : 'normal'}`;

  return spec;
}

let _pendingSpec = null;

function confirmAddOrganism() {
  const spec = generateAndPreview();
  if (!spec) return;
  _pendingSpec = spec;
}

function releaseOrganism() {
  if (!_pendingSpec) {
    // Try generating first
    const spec = generateAndPreview();
    if (!spec) return;
    _pendingSpec = spec;
  }
  // Spawn 3 of them near the center
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

  initSim(Date.now());

  document.getElementById('btn-reset').addEventListener('click', () => {
    initSim(Date.now());
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
  document.getElementById('org-preview').addEventListener('click', () => {
    _pendingSpec = generateAndPreview();
  });
  document.getElementById('org-release').addEventListener('click', releaseOrganism);

  document.getElementById('add-organism-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddOrganism();
  });

  requestAnimationFrame(loop);
});
