// Ecosystem Collapse Diorama
// Deterministic procedural ecosystem — no user input required

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CFG = {
  plant:     { max: 120, growRate: 0.018, size: 5 },
  herbivore: { init: 22, maxSpeed: 0.9, senseRadius: 60, eatRadius: 8, hungerTick: 0.004, repro: 0.00018, size: 5 },
  predator:  { init: 5,  maxSpeed: 1.3, senseRadius: 90, killRadius: 10, hungerTick: 0.0025, repro: 0.00008, size: 7 },
  milestone: 5 * 60,   // seconds between reports (5 minutes = 300s)
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let canvas, ctx, W, H;
let plants = [], herbivores = [], predators = [];
let simTime = 0;         // seconds elapsed in simulation
let realTime = 0;        // wall-clock seconds for HUD
let lastMilestone = -1;
let speed = 1;
let paused = false;
let weather = 'clear';   // clear | rain | drought | storm
let weatherTimer = 0;
let weatherDuration = 0;
let skyBrightness = 1;   // 0=night, 1=day
let dayTimer = 0;
let extinctionLog = [];  // { time, species }
let rng;                 // seeded random for reproducibility within a session

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
    hunger: rng() * 0.5,
    age: 0,
    kind: 'herbivore',
  };
}

function mkPredator(x, y) {
  return {
    x, y,
    vx: (rng() - 0.5) * CFG.predator.maxSpeed,
    vy: (rng() - 0.5) * CFG.predator.maxSpeed,
    hunger: rng() * 0.4,
    age: 0,
    kind: 'predator',
  };
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function initSim(seed) {
  rng = mkRng(seed >>> 0);
  plants = [];
  herbivores = [];
  predators = [];
  extinctionLog = [];
  simTime = 0;
  realTime = 0;
  lastMilestone = -1;
  weatherTimer = 0;
  weatherDuration = 30 + rng() * 60;
  weather = 'clear';
  skyBrightness = 1;
  dayTimer = 0;

  for (let i = 0; i < CFG.plant.max * 0.6; i++)
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
    const prev = weather;
    // weighted: mostly clear, some rain, rare drought/storm
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
  const period = 240; // seconds per full day
  const phase = (dayTimer % period) / period; // 0–1
  // sine: 0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight
  skyBrightness = Math.max(0, Math.sin(phase * Math.PI * 2) * 0.5 + 0.6);
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

  // Plant growth
  const growMod = weather === 'rain' ? 2 : weather === 'drought' ? 0.2 : weather === 'storm' ? 0.6 : 1;
  // slower at night
  const growNight = skyBrightness;
  if (plants.length < CFG.plant.max && rng() < CFG.plant.growRate * dt * 60 * growMod * growNight) {
    const parent = plants.length ? plants[Math.floor(rng() * plants.length)] : { x: rng() * W, y: rng() * H };
    plants.push(mkPlant(
      parent.x + (rng() - 0.5) * 40,
      parent.y + (rng() - 0.5) * 40
    ));
  }

  // Herbivores
  const nextHerbs = [];
  for (const h of herbivores) {
    h.age += dt;
    const hungerMod = weather === 'storm' ? 1.4 : 1;
    h.hunger += CFG.herbivore.hungerTick * dt * 60 * hungerMod;

    // find nearest plant
    let nearestPlant = null, nearestPDist = Infinity;
    for (const p of plants) {
      const d = dist(h, p);
      if (d < nearestPDist) { nearestPDist = d; nearestPlant = p; }
    }

    // flee predators
    let flee = false;
    for (const pred of predators) {
      if (dist(h, pred) < CFG.herbivore.senseRadius) {
        steer(h, h.x - (pred.x - h.x), h.y - (pred.y - h.y), CFG.herbivore.maxSpeed * 1.5);
        flee = true;
      }
    }

    if (!flee && nearestPlant && nearestPDist < CFG.herbivore.senseRadius) {
      steer(h, nearestPlant.x, nearestPlant.y, CFG.herbivore.maxSpeed);
    } else {
      // wander
      h.vx += (rng() - 0.5) * 0.3;
      h.vy += (rng() - 0.5) * 0.3;
    }

    clampSpeed(h, CFG.herbivore.maxSpeed);
    h.x += h.vx; h.y += h.vy;
    wrap(h);

    // eat plant
    if (nearestPlant && nearestPDist < CFG.herbivore.eatRadius) {
      plants.splice(plants.indexOf(nearestPlant), 1);
      h.hunger = Math.max(0, h.hunger - 0.5);
    }

    // die of hunger or old age
    if (h.hunger >= 1 || h.age > 900) continue;

    // reproduce
    if (h.hunger < 0.4 && herbivores.length < 80 && rng() < CFG.herbivore.repro * dt * 60)
      nextHerbs.push(mkHerbivore(h.x, h.y));

    nextHerbs.push(h);
  }

  // track herbivore extinction
  if (herbivores.length > 0 && nextHerbs.length === 0)
    extinctionLog.push({ time: simTime, species: 'herbivore' });
  herbivores = nextHerbs;

  // Predators
  const nextPreds = [];
  for (const pred of predators) {
    pred.age += dt;
    pred.hunger += CFG.predator.hungerTick * dt * 60;

    // find nearest herbivore
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

    // kill herbivore
    if (nearestH && nearestHDist < CFG.predator.killRadius) {
      const idx = herbivores.indexOf(nearestH);
      if (idx !== -1) herbivores.splice(idx, 1);
      pred.hunger = Math.max(0, pred.hunger - 0.7);
    }

    if (pred.hunger >= 1 || pred.age > 1200) continue;

    if (pred.hunger < 0.35 && predators.length < 20 && rng() < CFG.predator.repro * dt * 60)
      nextPreds.push(mkPredator(pred.x, pred.y));

    nextPreds.push(pred);
  }

  if (predators.length > 0 && nextPreds.length === 0)
    extinctionLog.push({ time: simTime, species: 'predator' });
  predators = nextPreds;

  // HUD counts
  document.getElementById('pop-counts').textContent =
    `🌿${plants.length} 🐇${herbivores.length} 🦊${predators.length}`;

  // Milestone report every 5 sim-minutes
  const milestoneIndex = Math.floor(simTime / CFG.milestone);
  if (milestoneIndex > lastMilestone) {
    lastMilestone = milestoneIndex;
    showReport(milestoneIndex);
  }
}

// ─── STATE LABELS ─────────────────────────────────────────────────────────────
function classifyState() {
  const P = plants.length, H = herbivores.length, Pr = predators.length;
  const totalAnimals = H + Pr;
  const hExtinct = H === 0;
  const prExtinct = Pr === 0;
  const recentExtinctions = extinctionLog.filter(e => simTime - e.time < CFG.milestone * 2).length;

  if (hExtinct && prExtinct)
    return { title: 'Silent Spring', body: `All animals are gone. The land is still — only plants remain, spreading in silence. The last predator vanished ${fmtT(simTime - (extinctionLog.find(e => e.species === 'predator')?.time ?? simTime))} ago.` };

  if (hExtinct)
    return { title: 'The Last Hunter', body: `Herbivores are extinct. ${Pr} predator${Pr !== 1 ? 's' : ''} stalk an empty meadow, burning through their final reserves.` };

  if (prExtinct && H > 50)
    return { title: 'Rabbit Hegemony', body: `No predators remain. ${H} herbivores graze unchecked — the landscape is being stripped bare.` };

  if (prExtinct)
    return { title: 'Cautious Abundance', body: `Predators gone. ${H} herbivores roam freely among ${P} plants. Uneasy peace.` };

  if (Pr > H * 0.6 && H < 15)
    return { title: 'Predator Trap', body: `${Pr} predators, only ${H} prey. The hunters are racing toward their own starvation.` };

  if (H > 60 && Pr > 10)
    return { title: 'Productive Chaos', body: `A churning arms race: ${H} prey vs ${Pr} predators, ${P} plants regenerating. Energy cascades through every trophic level.` };

  if (recentExtinctions >= 2)
    return { title: 'Cascading Collapse', body: `Multiple extinctions in quick succession. The web is unraveling — ${totalAnimals} animals cling on among ${P} plants.` };

  if (weather === 'drought' && P < 20)
    return { title: 'Great Drying', body: `Drought has reduced plants to ${P}. Animals are pressed together in a shrinking green.` };

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
// Day sky colour
function skyColor() {
  const t = skyBrightness;
  // night: #0d1b2a  day: #87ceeb
  const r = Math.round(13 + (135 - 13) * t);
  const g = Math.round(27 + (206 - 27) * t);
  const b = Math.round(42 + (235 - 42) * t);
  return `rgb(${r},${g},${b})`;
}

function groundColor() {
  // dark night ground → lighter day ground
  const t = skyBrightness;
  const r = Math.round(20 + (58 - 20) * t);
  const g = Math.round(30 + (107 - 30) * t);
  const b = Math.round(10 + (26 - 10) * t);
  return `rgb(${r},${g},${b})`;
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

  // Plants
  for (const p of plants) {
    const glow = 0.6 + skyBrightness * 0.4;
    ctx.fillStyle = `rgba(${Math.round(45 * glow)},${Math.round(120 * glow)},${Math.round(30 * glow)},0.9)`;
    ctx.beginPath();
    // simple tuft — 3 circles
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${Math.round(60 * glow)},${Math.round(150 * glow)},${Math.round(40 * glow)},0.6)`;
    ctx.beginPath();
    ctx.arc(p.x - p.size * 0.6, p.y - p.size * 0.4, p.size * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x + p.size * 0.6, p.y - p.size * 0.4, p.size * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Herbivores (small warm blobs with ears)
  for (const h of herbivores) {
    const hungerPale = Math.round(200 - h.hunger * 80);
    ctx.fillStyle = `rgba(${hungerPale},${Math.round(160 - h.hunger * 60)},${Math.round(90 - h.hunger * 40)},0.95)`;
    // body
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, CFG.herbivore.size, CFG.herbivore.size * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.beginPath();
    ctx.ellipse(h.x - 2, h.y - CFG.herbivore.size - 2, 1.5, 3.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(h.x + 2, h.y - CFG.herbivore.size - 2, 1.5, 3.5, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Predators (angular, darker)
  for (const pred of predators) {
    const hungerR = Math.round(160 - pred.hunger * 60);
    ctx.fillStyle = `rgba(${hungerR},${Math.round(60 - pred.hunger * 30)},${Math.round(30 - pred.hunger * 20)},0.95)`;
    const s = CFG.predator.size;
    ctx.save();
    ctx.translate(pred.x, pred.y);
    const angle = Math.atan2(pred.vy, pred.vx);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(s * 1.4, 0);
    ctx.lineTo(-s, -s * 0.7);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(-s, s * 0.7);
    ctx.closePath();
    ctx.fill();
    // eye glint
    ctx.fillStyle = 'rgba(255,220,50,0.9)';
    ctx.beginPath();
    ctx.arc(s * 0.6, -s * 0.2, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // HUD clock (real elapsed wall time)
  const m = Math.floor(realTime / 60);
  const s = Math.floor(realTime % 60);
  document.getElementById('clock').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── SNAPSHOT ─────────────────────────────────────────────────────────────────
function snapshotCanvas() {
  // Draw the current frame into an offscreen canvas with a label overlay
  const oc = document.createElement('canvas');
  oc.width = W; oc.height = H;
  const oc2 = oc.getContext('2d');

  // copy the live canvas
  oc2.drawImage(canvas, 0, 0);

  // label overlay at bottom
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

// ─── LOOP ─────────────────────────────────────────────────────────────────────
let lastTs = null;

function loop(ts) {
  requestAnimationFrame(loop);
  if (!lastTs) { lastTs = ts; return; }
  const rawDt = Math.min((ts - lastTs) / 1000, 0.1); // cap at 100ms to avoid spirals
  lastTs = ts;

  if (!paused) {
    // run multiple sub-ticks per frame based on speed
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

  requestAnimationFrame(loop);
});
