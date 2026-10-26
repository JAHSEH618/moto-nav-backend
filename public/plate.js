// A plate derived from the name it is served under.
// Two engravings, pinned off-centre and turning opposite ways, interfere in the
// middle. The pointer retunes the pen. Everything is drawn; nothing is loaded.

const canvas = document.getElementById("plate");
const ctx = canvas.getContext("2d");
const hint = document.getElementById("hint");

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");

const HOST = (location.hostname || "doupaw.site").replace(/^www\./, "");
const SEED = hash32(HOST);
const EDITION = SEED.toString(16).toUpperCase().padStart(8, "0").slice(0, 6);

// The name decides the geometry: same domain, same plate, on every visit.
const LOBES_A = 7 + (SEED % 7);
const LOBES_B = LOBES_A + 3 + ((SEED >>> 17) % 3);
const DEPTH_A = 0.44 + ((SEED >>> 9) % 36) / 100;
const DENSE = Math.min(window.innerWidth, window.innerHeight) < 700;
const PASSES_A = DENSE ? 54 : 88;
const PASSES_B = DENSE ? 26 : 40;

const state = {
  depth: DEPTH_A,
  depthTarget: DEPTH_A,
  tilt: 0.5,
  tiltTarget: 0.5,
  push: 0.5,
  pushTarget: 0.5,
  angleA: 0,
  angleB: 0,
  tone: null,
  plates: { a: null, b: null },
  layout: null,
  paintedDepth: null,
};

document.getElementById("name").textContent = HOST;
document.getElementById("edition").textContent = `№ ${EDITION}`;

function hash32(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readTone() {
  const css = getComputedStyle(document.documentElement);
  const read = (name) => css.getPropertyValue(name).trim();
  return {
    bg: read("--bg"),
    a: read("--plate-a"),
    // Two inks only: the accent cuts the front plate, the ink lays the bed plate.
    b: read("--label"),
    dark: darkQuery.matches,
  };
}

/* ── geometry ─────────────────────────────────────────────── */

// Hypotrochoid: the lobe count never changes, the outer radius does. A family of
// passes nests into a cut band instead of re-tracing one outline.
function tracePass(target, { radius, lobes, depth, phase = 0 }) {
  const inner = radius / lobes;
  const pen = inner * depth;
  const laps = Math.PI * 2 * lobes;
  const steps = Math.max(360, Math.round(radius * 2.6));
  target.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * laps + phase;
    const x = (radius - inner) * Math.cos(t) + pen * Math.cos((lobes - 1) * t);
    const y = (radius - inner) * Math.sin(t) - pen * Math.sin((lobes - 1) * t);
    if (i === 0) target.moveTo(x, y);
    else target.lineTo(x, y);
  }
}

function paintPlate(size, { lobes, depth, color, passes, strength, furniture }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ss = 1;
  const pixels = Math.ceil(size * ss * dpr);
  const plate = document.createElement("canvas");
  plate.width = pixels;
  plate.height = pixels;
  const paint = plate.getContext("2d");
  paint.setTransform(pixels / size, 0, 0, pixels / size, pixels / 2, pixels / 2);

  // The outer ring sits at 0.94 of the canvas radius; furniture lives outside it.
  const radius = (size / 2) * 0.94;
  paint.lineCap = "round";
  paint.lineJoin = "round";
  paint.strokeStyle = color;

  for (let pass = 0; pass < passes; pass += 1) {
    const k = passes === 1 ? 0.5 : pass / (passes - 1);
    // Denser toward the pin, like a cut medallion, sparse at the rim.
    const passRadius = radius * (0.12 + 0.88 * Math.pow(k, 0.92));
    const swell = Math.sin(k * Math.PI);
    const master = pass % 9 === 0;
    paint.globalAlpha = strength * (master ? 0.85 : 0.16 + 0.16 * swell);
    paint.lineWidth = master ? 1.1 : 0.7;
    tracePass(paint, {
      radius: passRadius,
      lobes,
      depth: depth * (0.55 + 0.45 * swell),
    });
    paint.stroke();
  }

  if (furniture) {
    paint.globalAlpha = strength * 0.55;
    paint.lineWidth = 0.5;
    paint.beginPath();
    paint.arc(0, 0, radius * 1.03, 0, Math.PI * 2);
    paint.stroke();

    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI / 2) * i;
      paint.beginPath();
      paint.moveTo(Math.cos(angle) * radius * 1.03, Math.sin(angle) * radius * 1.03);
      paint.lineTo(Math.cos(angle) * radius * 1.075, Math.sin(angle) * radius * 1.075);
      paint.stroke();
    }
  }

  // The pin the plate turns on.
  paint.globalAlpha = strength * 0.8;
  paint.beginPath();
  paint.arc(0, 0, 1.6, 0, Math.PI * 2);
  paint.fillStyle = color;
  paint.fill();

  return plate;
}

/* ── layout ───────────────────────────────────────────────── */

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const unit = Math.min(width, height);
  // Portrait pins the pair vertically; landscape pins them across the frame.
  const portrait = height > width * 0.92;
  const radiusA = unit * (portrait ? 0.44 : 0.47);
  const radiusB = radiusA * 0.86;

  state.layout = {
    width,
    height,
    radiusA,
    radiusB,
    ax: portrait ? width * 0.36 : width * 0.34,
    ay: portrait ? height * 0.34 : height * 0.44,
    bx: portrait ? width * 0.64 : width * 0.66,
    by: portrait ? height * 0.66 : height * 0.58,
  };
  state.paintedDepth = null;
}

function repaint() {
  const { radiusA, radiusB } = state.layout;
  const tone = state.tone;
  state.plates.a = paintPlate(radiusA * 2.2, {
    lobes: LOBES_A,
    depth: state.depth,
    color: tone.a,
    passes: PASSES_A,
    strength: tone.dark ? 0.95 : 1,
    furniture: true,
  });
  state.plates.b = paintPlate(radiusB * 2.2, {
    lobes: LOBES_B,
    depth: 1 - state.depth * 0.55,
    color: tone.b,
    passes: PASSES_B,
    strength: tone.dark ? 0.4 : 0.42,
    furniture: false,
  });
  state.paintedDepth = state.depth;
  document.getElementById("params").textContent = `N${LOBES_A} · D${state.depth.toFixed(2)}`;
}

/* ── frame ────────────────────────────────────────────────── */

let last = 0;
let recutTimer = 0;

function ease(current, target, dt, tau) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

let drew = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) return;

  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
  last = now;

  state.depth = ease(state.depth, state.depthTarget, dt, 0.16);
  state.tilt = ease(state.tilt, state.tiltTarget, dt, 0.2);
  state.push = ease(state.push, state.pushTarget, dt, 0.2);

  const still = reduceQuery.matches
    && drew
    && Math.abs(state.depth - state.depthTarget) < 0.0005
    && Math.abs(state.tilt - state.tiltTarget) < 0.0005;
  if (still) return;

  if (!reduceQuery.matches) {
    state.angleA += dt * 0.07;
    state.angleB -= dt * 0.045;
  }

  if (state.paintedDepth === null) repaint();

  const { width, height, ax, ay, bx, by, radiusA, radiusB } = state.layout;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = state.tone.bg;
  ctx.fillRect(0, 0, width, height);

  // Ink on paper by day, light on black by night.
  ctx.globalCompositeOperation = state.tone.dark ? "lighter" : "multiply";

  const shiftX = (0.5 - state.tilt) * 26;
  const shiftY = (0.5 - state.push) * 20;

  ctx.save();
  ctx.translate(bx + shiftX * 0.55, by + shiftY * 0.55);
  ctx.rotate(state.angleB);
  ctx.drawImage(state.plates.b, -radiusB * 1.1, -radiusB * 1.1, radiusB * 2.2, radiusB * 2.2);
  ctx.restore();

  ctx.save();
  ctx.translate(ax + shiftX, ay + shiftY);
  ctx.rotate(state.angleA);
  ctx.drawImage(state.plates.a, -radiusA * 1.1, -radiusA * 1.1, radiusA * 2.2, radiusA * 2.2);
  ctx.restore();

  ctx.globalCompositeOperation = "source-over";
  drew = true;
}

/* ── input ────────────────────────────────────────────────── */

function steer(event) {
  const touch = event.touches?.[0] ?? event;
  const { width, height } = state.layout;
  state.tiltTarget = Math.min(1, Math.max(0, touch.clientX / width));
  state.pushTarget = Math.min(1, Math.max(0, touch.clientY / height));
  state.depthTarget = DEPTH_A + (state.tiltTarget - 0.5) * 0.34;
  hint.classList.add("is-gone");

  // The cut is expensive; re-cut once the hand stops moving.
  clearTimeout(recutTimer);
  recutTimer = setTimeout(() => {
    state.depth = state.depthTarget;
    repaint();
  }, 160);
}

canvas.addEventListener("pointermove", steer);
canvas.addEventListener("pointerdown", (event) => {
  steer(event);
  if (navigator.vibrate) navigator.vibrate(6);
});
canvas.addEventListener("touchmove", (event) => {
  event.preventDefault();
  steer(event);
}, { passive: false });

/* ── boot ─────────────────────────────────────────────────── */

function start() {
  state.tone = readTone();
  layout();
  repaint();
  canvas.classList.add("is-ready");
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => {
  state.tone = readTone();
  layout();
  repaint();
});

darkQuery.addEventListener("change", () => {
  state.tone = readTone();
  repaint();
});

start();
