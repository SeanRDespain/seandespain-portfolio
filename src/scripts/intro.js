// Homepage opening sequence, played once per browser session.
//
// The inline head script in index.astro decides whether it plays and adds
// html.intro-active before first paint, so the page never flashes. This file
// drives the timeline: the name decodes out of binary, a line of light draws
// across the seam, the night splits open along it, and the starfield rushes
// past on the way in to the hero.
//
// Every layer hangs off one master clock (a target-less Web Animation), so a
// skip (any click, key, scroll, or tap) is just a playback-rate change and
// the canvas, the decode, and the CSS layers all fast-forward together.

const html = document.documentElement;
const overlay = document.querySelector("[data-intro]");

// all times in ms from the start of the sequence
const T = {
  decodeStart: 380,
  charStep: 62,
  tagIn: 950,
  lineDraw: 1050,
  warpStart: 1450,
  split: 1800,
  warpPeak: 2000,
  done: 2050,
  total: 3100,
};
const SKIP_RATE = 5;

const anims = [];
let tornDown = false;
let doneSent = false;
let starfield = null;

function signalDone() {
  if (doneSent) return;
  doneSent = true;
  document.dispatchEvent(new CustomEvent("intro:done"));
}

function onSkip() {
  anims.forEach((a) => a.updatePlaybackRate(SKIP_RATE));
  removeSkipListeners();
}
const SKIP_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];
function addSkipListeners() {
  SKIP_EVENTS.forEach((e) => window.addEventListener(e, onSkip, { passive: true }));
}
function removeSkipListeners() {
  SKIP_EVENTS.forEach((e) => window.removeEventListener(e, onSkip));
}

function teardown() {
  if (tornDown) return;
  tornDown = true;
  removeSkipListeners();
  signalDone();
  html.classList.remove("intro-active");
  starfield?.destroy();
  overlay?.remove();
  // final keyframes match the page's resting styles, so cancelling is seamless
  anims.forEach((a) => a.cancel());
}

// warp speed in depth units per ms: a slow drift while the name decodes,
// a sharp ease-in to the jump as the night splits, then a settle
const SLOW = 0.00011;
const FAST = 0.0021;
const SETTLE = 0.00045;
function speedAt(t) {
  if (t < T.warpStart) return SLOW;
  if (t < T.warpPeak) {
    const p = (t - T.warpStart) / (T.warpPeak - T.warpStart);
    return SLOW + (FAST - SLOW) * p * p * p;
  }
  const p = Math.min(1, (t - T.warpPeak) / 800);
  return FAST + (SETTLE - FAST) * (1 - Math.pow(1 - p, 3));
}

function createStarfield(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  let cx = 0;
  let cy = 0;
  const resize = () => {
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2;
    cy = h / 2;
  };
  resize();
  window.addEventListener("resize", resize);

  const place = (s, z) => {
    s.x = (Math.random() * 2 - 1) * cx * 1.1;
    s.y = (Math.random() * 2 - 1) * cy * 1.1;
    s.z = z;
    s.tint = Math.random() < 0.22;
  };
  const count = Math.round(Math.min(380, Math.max(140, (w * h) / 5000)));
  const stars = Array.from({ length: count }, () => {
    const s = {};
    place(s, 0.25 + Math.random() * 0.75);
    return s;
  });

  let last = 0;
  return {
    draw(t) {
      const dt = Math.max(0, Math.min(80, t - last));
      last = t;
      const v = speedAt(t);
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.z -= v * dt;
        if (s.z <= 0.03) {
          place(s, 1);
          continue;
        }
        const sx = cx + s.x / s.z;
        const sy = cy + s.y / s.z;
        if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) {
          place(s, 1);
          continue;
        }
        const near = 1 - s.z;
        const alpha = Math.min(1, near * 1.25);
        const rgb = s.tint ? "169, 184, 255" : "238, 242, 255";
        const size = 0.5 + near * 1.6;
        // trail runs back toward the vanishing point, so it always points
        // exactly along the direction of travel
        const tz = Math.min(1, s.z + v * 42);
        const px = cx + s.x / tz;
        const py = cy + s.y / tz;
        if (Math.hypot(sx - px, sy - py) < 1.5) {
          ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
          ctx.beginPath();
          ctx.arc(sx, sy, size * 0.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const g = ctx.createLinearGradient(px, py, sx, sy);
          g.addColorStop(0, `rgba(${rgb}, 0)`);
          g.addColorStop(1, `rgba(${rgb}, ${alpha})`);
          ctx.strokeStyle = g;
          ctx.lineWidth = size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        }
      }
    },
    destroy() {
      window.removeEventListener("resize", resize);
    },
  };
}

function run() {
  try {
    sessionStorage.setItem("sd-intro-seen", "1");
  } catch (e) {
    // storage blocked: the intro just plays again next load
  }

  const q = (sel) => overlay.querySelector(sel);
  const top = q(".intro__half--top");
  const bottom = q(".intro__half--bottom");
  const line = q(".intro__line");
  const name = q(".intro__name");
  const tag = q(".intro__tag");
  const canvas = q(".intro__stars");
  const edges = overlay.querySelectorAll(".intro__edge");
  const aura = document.querySelector(".hero__aura");
  const chars = [...overlay.querySelectorAll(".intro__char[data-char]")];

  const at = (ms) => Math.min(1, Math.max(0, ms / T.total));
  const outExpo = "cubic-bezier(0.16, 1, 0.3, 1)";
  const inOut = "cubic-bezier(0.65, 0, 0.35, 1)";
  const splitEase = "cubic-bezier(0.83, 0, 0.17, 1)";

  // every layer spans the full timeline with keyframe offsets, so one
  // playback-rate change moves them all together
  const add = (el, keyframes) => {
    if (!el) return;
    anims.push(el.animate(keyframes, { duration: T.total, fill: "both" }));
  };

  const master = new Animation(new KeyframeEffect(null, null, { duration: T.total }), document.timeline);
  anims.push(master);

  add(name, [
    { offset: 0, opacity: 0, filter: "blur(10px)", "--intro-ls": "0.95em", easing: outExpo },
    { offset: at(1500), opacity: 1, filter: "blur(0px)", "--intro-ls": "0.42em" },
    { offset: at(T.split), opacity: 1, filter: "blur(0px)", "--intro-ls": "0.42em", easing: "ease-in" },
    { offset: at(T.split + 650), opacity: 0, filter: "blur(4px)", "--intro-ls": "0.42em" },
    { offset: 1, opacity: 0, filter: "blur(4px)", "--intro-ls": "0.42em" },
  ]);
  add(tag, [
    { offset: 0, opacity: 0, filter: "blur(6px)", transform: "translateY(-6px)" },
    { offset: at(T.tagIn), opacity: 0, filter: "blur(6px)", transform: "translateY(-6px)", easing: outExpo },
    { offset: at(T.tagIn + 800), opacity: 1, filter: "blur(0px)", transform: "none" },
    { offset: at(T.split), opacity: 1, filter: "blur(0px)", transform: "none", easing: "ease-in" },
    { offset: at(T.split + 650), opacity: 0, filter: "blur(4px)", transform: "none" },
    { offset: 1, opacity: 0, filter: "blur(4px)", transform: "none" },
  ]);
  add(line, [
    { offset: 0, opacity: 0, transform: "scaleX(0)" },
    { offset: at(T.lineDraw), opacity: 0, transform: "scaleX(0)", easing: inOut },
    { offset: at(T.split), opacity: 1, transform: "scaleX(1)", easing: "ease-out" },
    { offset: at(T.split + 260), opacity: 0, transform: "scaleX(1) scaleY(3)" },
    { offset: 1, opacity: 0, transform: "scaleX(1) scaleY(3)" },
  ]);
  add(top, [
    { offset: 0, transform: "translateY(0)" },
    { offset: at(T.split), transform: "translateY(0)", easing: splitEase },
    { offset: at(T.split + 1100), transform: "translateY(-100%)" },
    { offset: 1, transform: "translateY(-100%)" },
  ]);
  add(bottom, [
    { offset: 0, transform: "translateY(0)" },
    { offset: at(T.split), transform: "translateY(0)", easing: splitEase },
    { offset: at(T.split + 1100), transform: "translateY(100%)" },
    { offset: 1, transform: "translateY(100%)" },
  ]);
  edges.forEach((edge) =>
    add(edge, [
      { offset: 0, opacity: 0 },
      { offset: at(T.split - 40), opacity: 0 },
      { offset: at(T.split + 100), opacity: 1, easing: "ease-in" },
      { offset: at(T.split + 950), opacity: 0 },
      { offset: 1, opacity: 0 },
    ])
  );
  add(canvas, [
    { offset: 0, opacity: 0 },
    { offset: at(300), opacity: 1 },
    { offset: at(2050), opacity: 1, easing: "ease-in-out" },
    { offset: at(2800), opacity: 0 },
    { offset: 1, opacity: 0 },
  ]);
  add(aura, [
    { offset: 0, opacity: 0.2, transform: "scale(1.06)" },
    { offset: at(T.split - 50), opacity: 0.2, transform: "scale(1.06)", easing: outExpo },
    { offset: at(T.split + 1250), opacity: 1, transform: "none" },
    { offset: 1, opacity: 1, transform: "none" },
  ]);

  master.play();
  starfield = canvas ? createStarfield(canvas) : null;

  // decode: every unlocked character flickers through binary, then each one
  // locks into its letter left to right with a small flash
  const lockAt = chars.map((_, i) => T.decodeStart + i * T.charStep + Math.random() * 50);
  const locked = chars.map(() => false);
  let lastFlicker = -Infinity;
  let opened = false;

  const frame = () => {
    if (tornDown) return;
    const t = master.currentTime ?? 0;
    const flicker = t - lastFlicker > 55;
    if (flicker) lastFlicker = t;
    chars.forEach((c, i) => {
      if (locked[i]) return;
      if (t >= lockAt[i]) {
        locked[i] = true;
        c.textContent = c.dataset.char;
        c.classList.add("is-locked");
      } else if (flicker) {
        c.textContent = Math.random() > 0.5 ? "1" : "0";
      }
    });
    starfield?.draw(t);
    if (!opened && t >= T.split) {
      opened = true;
      // the page underneath becomes clickable the moment the night opens
      overlay.style.pointerEvents = "none";
    }
    if (t >= T.done) signalDone();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  addSkipListeners();
  master.finished.then(teardown, teardown);
  // belt and braces: never leave the overlay up, whatever happens above
  setTimeout(teardown, T.total + 2500);
}

if (overlay && html.classList.contains("intro-active")) {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // if the script arrived very late (slow network), the visitor has waited
  // long enough: skip straight to the page
  if (prefersReduced || performance.now() > 4500 || typeof KeyframeEffect === "undefined") {
    teardown();
  } else {
    // JS is alive, so the CSS failsafe that hides a stuck overlay can stand down
    overlay.classList.add("is-running");
    const start = () => {
      try {
        run();
      } catch (e) {
        teardown();
      }
    };
    if (document.hidden) {
      // opened in a background tab: hold the first frame until it's seen
      const onVisible = () => {
        if (document.hidden) return;
        document.removeEventListener("visibilitychange", onVisible);
        start();
      };
      document.addEventListener("visibilitychange", onVisible);
    } else {
      start();
    }
  }
} else if (overlay) {
  overlay.remove();
}
