// Ahum hand-drawn kit: wobble filters, critters, props, a tiny synth sound kit and click feel.
// From Auto Ahum (~/ahum-ops/ui/index.html), copied into DM Desk (var(--muted)/var(--accent) renamed to --hd-*). Plain ES module, no dependencies; works in any framework.
//   import { installFilters, startBoil, critter, sfx, setSound, wireClickFeel } from "./handdrawn.js";

const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- wobble ---------- */
// Three noise filters with different seeds. Put class="sk" on any SVG group to make it hand-drawn;
// startBoil() cycles them so the lines "boil" like a cartoon. Static exports use one filter, no boil.
export const FILTERS = [2, 7, 13].map((seed, i) =>
  `<filter id="rough${i}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter>`).join("");

export function installFilters() {
  if (document.getElementById("rough0")) return;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("width", "0"); s.setAttribute("height", "0"); s.setAttribute("aria-hidden", "true");
  s.style.position = "absolute"; s.innerHTML = FILTERS;
  document.body.prepend(s);
  document.documentElement.dataset.boil = "0";
}

export function startBoil(ms = 150) {
  installFilters();
  if (reduced) return;
  let b = 0;
  // Pause while the page scrolls. Flipping data-boil on <html> restyles every
  // .sk filter; doing that mid-fling made iOS Safari drop the fixed tab bar and
  // the sticky top bar from the composited frame (they vanished but stayed tappable).
  let lastScroll = 0;
  const mark = () => { lastScroll = performance.now(); };
  addEventListener("scroll", mark, { passive: true, capture: true });
  addEventListener("touchmove", mark, { passive: true });
  addEventListener("wheel", mark, { passive: true });
  setInterval(() => {
    if (document.hidden || performance.now() - lastScroll < 500) return;
    b = (b + 1) % 3; document.documentElement.dataset.boil = b;
  }, ms);
}

/* ---------- critters ---------- */
// Head r=26 at (0,0), body down to y=62. Draw inside a <g transform="translate(x,y) scale(s)">.
// kind: fox raccoon owl otter beaver parrot dog elephant · st: "work" (awake) or "sleep" · extra: a prop.
export const KINDS = ["fox", "raccoon", "owl", "otter", "beaver", "parrot", "dog", "elephant"];
export function critter(kind, st = "work", extra = "", { body = true } = {}) {
  const sleep = st === "sleep";
  const delay = () => (Math.random() * 4).toFixed(2);
  let eyes = sleep
    ? `<path class="ln nf" d="M-14,-4 q4,5 8,0 M6,-4 q4,5 8,0"/>`
    : `<g class="blink" style="animation-delay:${delay()}s"><circle class="dot" cx="-9" cy="-4" r="3.3"/><circle class="dot" cx="9" cy="-4" r="3.3"/></g>`;
  let back = "", mid = "", front = "";
  switch (kind) {
    case "fox":
      back = `<path class="ln f" d="M-23,-8 L-27,-42 L-5,-24 Z M23,-8 L27,-42 L5,-24 Z"/>`;
      front = `<ellipse class="ln muz" cx="0" cy="11" rx="13" ry="9"/><circle class="dot" cx="0" cy="6" r="3.2"/>`; break;
    case "raccoon":
      back = `<circle class="ln f" cx="-18" cy="-20" r="9"/><circle class="ln f" cx="18" cy="-20" r="9"/>`;
      mid = `<path class="mask" d="M-25,-7 C-15,-17 -5,-11 0,-7 C5,-11 15,-17 25,-7 C19,5 6,1 0,3 C-6,1 -19,5 -25,-7 Z"/>`;
      eyes = sleep ? `<path class="ln lt nf" d="M-14,-4 q4,5 8,0 M6,-4 q4,5 8,0"/>` : eyes.replaceAll('class="dot"', 'class="dotl"');
      front = `<ellipse class="ln muz" cx="0" cy="12" rx="10" ry="7"/><circle class="dot" cx="0" cy="8" r="3"/>`; break;
    case "owl":
      back = `<path class="ln f" d="M-22,-12 L-21,-37 L-8,-23 Z M22,-12 L21,-37 L8,-23 Z"/>`;
      eyes = sleep ? `<path class="ln nf" d="M-17,-4 q6,6 12,0 M5,-4 q6,6 12,0"/>`
        : `<g class="blink" style="animation-delay:${delay()}s"><circle class="ln muz" cx="-10" cy="-4" r="9"/><circle class="ln muz" cx="10" cy="-4" r="9"/><circle class="dot" cx="-8" cy="-3" r="4"/><circle class="dot" cx="12" cy="-3" r="4"/></g>`;
      front = `<path class="ln beak" d="M-4,7 L4,7 L0,15 Z"/>`; break;
    case "otter":
      back = `<circle class="ln f" cx="-21" cy="-16" r="6"/><circle class="ln f" cx="21" cy="-16" r="6"/>`;
      front = `<ellipse class="ln muz" cx="0" cy="11" rx="13" ry="8"/><circle class="dot" cx="0" cy="7" r="3.2"/><path class="ln thin nf" d="M-9,12 L-21,10 M-9,15 L-21,17 M9,12 L21,10 M9,15 L21,17"/>`; break;
    case "beaver":
      back = `<circle class="ln f" cx="-19" cy="-18" r="7"/><circle class="ln f" cx="19" cy="-18" r="7"/>`;
      front = `<ellipse class="ln muz" cx="0" cy="9" rx="12" ry="8"/><circle class="dot" cx="0" cy="5" r="3.2"/><rect class="ln muz" x="-5" y="14" width="10" height="8" rx="1.5"/><path class="ln thin nf" d="M0,14 L0,22"/>`; break;
    case "parrot":
      back = `<path class="ln f" d="M-6,-22 C-15,-45 3,-47 0,-26 C4,-47 21,-41 8,-22 Z"/>`;
      front = `<path class="ln beak" d="M-3,0 C12,-2 16,10 6,17 C6,10 2,8 -3,8 Z"/>`; break;
    case "dog":
      front = `<ellipse class="ln f" cx="-24" cy="2" rx="8" ry="16" transform="rotate(18 -24 2)"/><ellipse class="ln f" cx="24" cy="2" rx="8" ry="16" transform="rotate(-18 24 2)"/><ellipse class="ln muz" cx="0" cy="11" rx="12" ry="8"/><ellipse class="dot" cx="0" cy="6" rx="4.5" ry="3.4"/>`; break;
    case "elephant":
      back = `<ellipse class="ln f" cx="-28" cy="2" rx="15" ry="20"/><ellipse class="ln f" cx="28" cy="2" rx="15" ry="20"/>`;
      front = `<path class="ln nf" style="stroke-width:11" d="M0,6 C-2,22 4,30 13,25"/><path class="nf" style="stroke:var(--c);stroke-width:6;stroke-linecap:round" d="M0,6 C-2,22 4,30 13,25"/>`; break;
  }
  const b = body ? `<path class="ln f" d="M-24,62 C-28,32 -18,20 0,20 C18,20 28,32 24,62 Z"/><ellipse class="muz" cx="0" cy="44" rx="11" ry="12" opacity=".75"/>` : "";
  const zz = sleep ? `<text class="zzz" x="20" y="-30">Zz</text>` : "";
  return `<g class="${sleep ? "breathe" : ""}" style="--c:var(--${kind})">${b}${back}<circle class="ln f" r="26"/>${mid}${eyes}${front}${extra}${zz}</g>`;
}

/* ---------- props (same coordinate space as critter heads) ---------- */
export const props = {
  cap: () => `<path class="ln capf" d="M-21,-19 C-19,-40 19,-40 21,-19 Z"/><path class="ln capf" d="M15,-22 L38,-19 L21,-15 Z"/>`,
  hardhat: () => `<path class="ln hat" d="M-21,-17 C-20,-42 20,-42 21,-17 Z"/><path class="ln nf" d="M-28,-17 L28,-17"/><path class="ln thin nf" d="M0,-36 L0,-19"/>`,
  laptop: () => `<g transform="translate(0,24)"><rect class="ln washf" x="-17" y="-12" width="34" height="22" rx="3"/><path class="ln thin nf" style="stroke:var(--ok)" d="M-10,-4 l-4,3 l4,3 M10,-4 l4,3 l-4,3 M3,-6 l-6,12"/></g>`,
  mug: () => `<g transform="translate(16,30)"><rect class="ln muz" x="-7" y="-9" width="14" height="16" rx="2"/><path class="ln thin nf" d="M7,-5 q6,3 0,7"/><path class="ln thin nf" style="stroke:var(--hd-muted)" d="M-2,-13 q2,-4 0,-7 M3,-13 q2,-4 0,-7"/></g>`,
  clipboard: () => `<g transform="translate(-14,30) rotate(-8)"><rect class="ln muz" x="-10" y="-13" width="20" height="26" rx="2"/><path class="ln thin nf" d="M-5,-5 h10 M-5,0 h10 M-5,5 h6"/></g>`,
};

/* ---------- the Ahum Labs triangle, hand-drawn (sail, flag, badge, mountain) ---------- */
// Apex at (cx, top), base at y=bottom, four red bands with paper gaps, like the logo.
export function ahumTriangle(cx, top, bottom, halfW, { outline = true } = {}) {
  const h = bottom - top, xAt = y => ((y - top) / h) * halfW;
  const cuts = [0, .28, .34, .55, .61, .78, .84, 1].map(t => top + t * h);
  let out = "";
  for (let i = 0; i < 8; i += 2) {
    const a = cuts[i], b = cuts[i + 1];
    const pa = i === 0 ? `${cx},${a}` : `${cx - xAt(a)},${a} ${cx + xAt(a)},${a}`;
    out += `<polygon class="logo-red" points="${pa} ${cx + xAt(b)},${b} ${cx - xAt(b)},${b}"/>`;
  }
  if (outline) out += `<path class="ln nf" style="stroke-width:4" d="M${cx},${top} L${cx + halfW},${bottom} L${cx - halfW},${bottom} Z"/>`;
  return out;
}

/* ---------- sound ----------
   Synthesised in the browser, no files. Off by default, remembered per device, unlocked by the first real tap.
   Every sound is under 0.4 s and goes through one soft compressor so nothing clips. */
let actx = null, bus = null, soundOn = false;
const KEY = "ahum-sound";
try { soundOn = localStorage.getItem(KEY) === "on"; } catch {}
function ac() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = actx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 3;
    bus = actx.createGain(); bus.gain.value = 2.2; bus.connect(comp); comp.connect(actx.destination);
  }
  if (actx.state !== "running") actx.resume();
  return actx;
}
function unlock() {
  if (!soundOn) return;
  try { const c = ac(), b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch {}
}
if (typeof document !== "undefined") for (const ev of ["pointerdown", "pointerup", "click", "keydown", "touchend"]) document.addEventListener(ev, unlock, true);
const ready = () => actx && actx.state === "running";
const jitter = (f, p = .04) => f * (1 + (Math.random() * 2 - 1) * p);
function tone(f, { type = "sine", at = 0, dur = .08, vol = .1, to = null, attack = .004 } = {}) {
  const c = ac(), t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + .02);
}
function noise({ at = 0, dur = .05, vol = .05, from = 2000, to = 2000, q = 1, type = "bandpass" } = {}) {
  const c = ac(), t = c.currentTime + at, n = Math.ceil(c.sampleRate * (dur + .02));
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(.02, dur / 3)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(bus); src.start(t); src.stop(t + dur + .02);
}
// What each sound is for: see references/where-life-goes.md.
export const SFX = {
  hover: () => tone(jitter(2400, .06), { dur: .035, vol: .018 }),                                   // faint glassy tick
  press: () => { tone(jitter(520), { type: "triangle", dur: .07, vol: .13, to: 260 }); noise({ dur: .018, vol: .05, from: 3500, to: 2500 }); }, // woody tock
  on: () => { tone(660, { dur: .07, vol: .08 }); tone(990, { at: .06, dur: .1, vol: .08 }); },     // two notes up
  off: () => { tone(740, { dur: .07, vol: .07 }); tone(494, { at: .06, dur: .1, vol: .07 }); },    // two notes down
  open: () => { noise({ dur: .18, vol: .045, from: 500, to: 2600, q: .8 }); tone(880, { at: .08, dur: .09, vol: .03 }); }, // swoosh in
  close: () => noise({ dur: .16, vol: .04, from: 2400, to: 450, q: .8 }),                          // swoosh out
  yes: () => [523.25, 659.25, 783.99].forEach((f, i) => tone(f, { type: "triangle", at: i * .055, dur: .22, vol: .09, attack: .008 })), // little major chime
  no: () => { tone(220, { type: "triangle", dur: .12, vol: .12, to: 180 }); tone(165, { type: "triangle", at: .09, dur: .16, vol: .11, to: 130 }); }, // low two-step
  sent: () => { noise({ dur: .22, vol: .05, from: 600, to: 4000, q: .7 }); [659.25, 987.77].forEach((f, i) => tone(f, { at: .14 + i * .07, dur: .2, vol: .08 })); }, // whoosh + chime
  pop: () => tone(jitter(880, .08), { type: "sine", dur: .06, vol: .09, to: 1400 }),                // something new appears
  squeak: () => tone(jitter(1500, .1), { type: "sine", dur: .09, vol: .05, to: 2300 }),            // a critter is poked
};
export function sfx(name) {
  if (!soundOn || !SFX[name]) return;
  if (name === "hover" && !ready()) return; // a hover can't unlock audio
  try { SFX[name](); } catch {}
}
export const soundIsOn = () => soundOn;
export function setSound(on) {
  if (!on) { sfx("off"); }
  soundOn = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch {}
  if (on) sfx("on");
}

/* ---------- click feel ---------- */
export function burst(x, y) {
  if (reduced) return;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "-35 -35 70 70"); s.setAttribute("class", "hd-burst");
  s.style.left = (x - 35) + "px"; s.style.top = (y - 35) + "px";
  let d = "";
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.random() * .3; d += `M${(Math.cos(a) * 14).toFixed(1)},${(Math.sin(a) * 14).toFixed(1)} L${(Math.cos(a) * 28).toFixed(1)},${(Math.sin(a) * 28).toFixed(1)} `; }
  s.innerHTML = `<path d="${d}"/>`;
  document.body.appendChild(s); setTimeout(() => s.remove(), 520);
}
export function boing(el) {
  if (reduced) return;
  el.classList.remove("boing"); void el.offsetWidth; el.classList.add("boing");
  el.addEventListener("animationend", () => el.classList.remove("boing"), { once: true });
}
// One call wires: press tock on buttons/links, burst + boing on .clicky, squeak on .hd-hit critters,
// hover tick (mouse only), up/down notes on checkboxes.
export function wireClickFeel() {
  document.addEventListener("pointerdown", e => {
    if (e.target.closest("[data-sound-toggle], input[type=checkbox]")) return;
    const critterHit = e.target.closest(".hd-hit");
    if (critterHit) { sfx("squeak"); boing(critterHit.querySelector("g") || critterHit); return; }
    if (e.target.closest("button, a[href], summary, .clicky")) sfx("press");
    const c = e.target.closest(".clicky");
    if (c) { burst(e.clientX, e.clientY); boing(c); }
  });
  let last = null, at = 0;
  document.addEventListener("pointerover", e => {
    if (e.pointerType !== "mouse") return;
    const el = e.target.closest(".clicky, .hd-hit, button, a[href], summary");
    if (!el || el === last || el.disabled) { if (!el) last = null; return; }
    last = el; const now = performance.now(); if (now - at < 45) return; at = now; sfx("hover");
  });
  document.addEventListener("change", e => { if (e.target.matches("input[type=checkbox]")) sfx(e.target.checked ? "on" : "off"); }, true);
  document.querySelectorAll("[data-sound-toggle]").forEach(b => {
    const show = () => { b.textContent = "Sound: " + (soundOn ? "on" : "off"); b.setAttribute("aria-pressed", soundOn); };
    show(); b.addEventListener("click", () => { setSound(!soundOn); show(); });
  });
}
