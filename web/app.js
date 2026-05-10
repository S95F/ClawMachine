import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// --- Cabinet dimensions (world units) ---------------------------------------
const CAB = {
  width: 6,
  depth: 5,
  height: 7,
  wall: 0.12,
  floorY: 0,
};

const CHUTE = {
  size: 1.4,
  cx: -CAB.width / 2 + 1.0,
  cz: -CAB.depth / 2 + 1.0,
  lipHeight: 0.6,
  wallT: 0.10,
};

const CLAW_BOUNDS = {
  minX: -CAB.width / 2 + 0.6,
  maxX: CAB.width / 2 - 0.6,
  minZ: -CAB.depth / 2 + 0.6,
  maxZ: CAB.depth / 2 - 0.6,
  topY: CAB.height - 1.2,
  bottomY: CAB.floorY + 0.7,
};

const PRIZE_COUNT = 30;
const PRIZE_RADIUS = 0.40;
const CLAW_HUB_RADIUS = 0.36;
const AIM_SEARCH_RADIUS = 1.8; // max distance the aim-assist will pull toward

// Configurable difficulty / assistance. Cycle through these via the
// "Assist:" button in the HUD. "Off" is the base challenge — higher levels
// widen the grab tolerance, boost the probability, soften prize scatter and
// add an aim-assist that pulls the claw toward the nearest prize while it
// descends. Selection is persisted to localStorage.
const ASSIST_LEVELS = [
  { name: "Off",    cls: "lvl-off",    grabRadius: 0.50, baseChance: 0.10, bestChance: 0.62, slip: 0.32, hubPush: 0.80, aimSpeed: 0.0 },
  { name: "Light",  cls: "lvl-light",  grabRadius: 0.62, baseChance: 0.22, bestChance: 0.78, slip: 0.18, hubPush: 0.55, aimSpeed: 1.2 },
  { name: "Medium", cls: "lvl-medium", grabRadius: 0.78, baseChance: 0.42, bestChance: 0.92, slip: 0.08, hubPush: 0.35, aimSpeed: 2.4 },
  { name: "Strong", cls: "lvl-strong", grabRadius: 1.00, baseChance: 0.70, bestChance: 1.00, slip: 0.00, hubPush: 0.15, aimSpeed: 4.0 },
];
function loadAssistIdx() {
  const saved = parseInt(localStorage.getItem("claw.assist") || "", 10);
  if (Number.isInteger(saved) && saved >= 0 && saved < ASSIST_LEVELS.length) {
    return saved;
  }
  return 1; // default to Light — user needs help to get started
}
let assistIdx = loadAssistIdx();
let ASSIST = ASSIST_LEVELS[assistIdx];

// Movement tuning — input feeds a target velocity that's damped into actual.
const MAX_HORIZ_SPEED = 3.0;
const HORIZ_ACCEL = 14.0; // velocity smoothing factor (per second)
const VERTICAL_SPEED = 2.6;
const GRAVITY = -9.0;

// Physics step
const PHYS_DT = 1 / 120;
const MAX_FRAME_DT = 1 / 30;

// Finger curl angles per joint (rotation.z, radians).
// Positive z splays the segment outward; negative curls it inward toward the hub center.
// OPEN  → idle / moving / dropping (fingers fanned outward)
// CLOSED → grabbing / raising / returning (fingers clenched under the hub)
const FINGER_OPEN = [0.22, 0.16, 0.08];
const FINGER_CLOSED = [-0.12, -0.50, -0.85];
const FINGER_LERP = 11.0; // smoothing rate (higher = snappier)

// --- Renderer / scene -------------------------------------------------------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e1a);
scene.fog = new THREE.Fog(0x0e0e1a, 18, 36);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
const INITIAL_CAM = new THREE.Vector3(0, 5.2, 11.0);
const INITIAL_TARGET = new THREE.Vector3(0, 3.0, 0);
camera.position.copy(INITIAL_CAM);
camera.lookAt(INITIAL_TARGET);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(INITIAL_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 7;
controls.maxDistance = 18;
controls.minPolarAngle = 0.25;
controls.maxPolarAngle = Math.PI * 0.48;
controls.rotateSpeed = 0.8;
controls.zoomSpeed = 0.7;
controls.update();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);

// --- Lights -----------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.45));

const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(6, 12, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(512, 512);
keyLight.shadow.camera.left = -10;
keyLight.shadow.camera.right = 10;
keyLight.shadow.camera.top = 10;
keyLight.shadow.camera.bottom = -10;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 30;
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);

scene.add(new THREE.PointLight(0xff5599, 0.7, 18).translateX(-4).translateY(6).translateZ(4));
scene.add(new THREE.PointLight(0x59c2ff, 0.7, 18).translateX(4).translateY(6).translateZ(-4));

// --- Cabinet ---------------------------------------------------------------
const cabinet = new THREE.Group();
scene.add(cabinet);

const floorMat = new THREE.MeshStandardMaterial({
  color: 0x2a2540,
  roughness: 0.7,
  metalness: 0.1,
});

function makeFloorWithHole() {
  const g = new THREE.Group();
  const W = CAB.width;
  const D = CAB.depth;
  const cx = CHUTE.cx;
  const cz = CHUTE.cz;
  const cs = CHUTE.size;

  const xLeftEnd = cx - cs / 2;
  const xRightStart = cx + cs / 2;
  const zNearEnd = cz - cs / 2;
  const zFarStart = cz + cs / 2;

  addStrip(-W / 2, xLeftEnd, -D / 2, D / 2);
  addStrip(xRightStart, W / 2, -D / 2, D / 2);
  addStrip(xLeftEnd, xRightStart, -D / 2, zNearEnd);
  addStrip(xLeftEnd, xRightStart, zFarStart, D / 2);

  function addStrip(x0, x1, z0, z1) {
    const w = x1 - x0;
    const d = z1 - z0;
    if (w <= 0 || d <= 0) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), floorMat);
    m.position.set((x0 + x1) / 2, CAB.floorY - 0.05, (z0 + z1) / 2);
    m.receiveShadow = true;
    g.add(m);
  }

  return g;
}
cabinet.add(makeFloorWithHole());

// Cheap transparent glass — transmission/refraction was the biggest desktop
// perf cost (a full extra render pass per frame). Standard transparent material
// reads almost as nice and is dramatically faster.
const glassMat = new THREE.MeshStandardMaterial({
  color: 0xaad9ff,
  transparent: true,
  opacity: 0.18,
  roughness: 0.1,
  metalness: 0.0,
  side: THREE.DoubleSide,
  depthWrite: false,
});

function makeWall(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
  m.position.set(x, y, z);
  cabinet.add(m);
}
const H = CAB.height;
const T = CAB.wall;
makeWall(CAB.width, H, T, 0, H / 2, -CAB.depth / 2);
makeWall(CAB.width, H, T, 0, H / 2, CAB.depth / 2);
makeWall(T, H, CAB.depth, -CAB.width / 2, H / 2, 0);
makeWall(T, H, CAB.depth, CAB.width / 2, H / 2, 0);

const frameMat = new THREE.MeshStandardMaterial({
  color: 0xffaa55,
  metalness: 0.4,
  roughness: 0.4,
});

function makeBeam(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  cabinet.add(m);
}
const BEAM = 0.18;
for (const sx of [-1, 1])
  for (const sz of [-1, 1])
    makeBeam(BEAM, H + 0.1, BEAM, (sx * CAB.width) / 2, H / 2, (sz * CAB.depth) / 2);
makeBeam(CAB.width + BEAM, BEAM, BEAM, 0, H, -CAB.depth / 2);
makeBeam(CAB.width + BEAM, BEAM, BEAM, 0, H, CAB.depth / 2);
makeBeam(BEAM, BEAM, CAB.depth + BEAM, -CAB.width / 2, H, 0);
makeBeam(BEAM, BEAM, CAB.depth + BEAM, CAB.width / 2, H, 0);
makeBeam(CAB.width + BEAM, BEAM, BEAM, 0, 0, -CAB.depth / 2);
makeBeam(CAB.width + BEAM, BEAM, BEAM, 0, 0, CAB.depth / 2);
makeBeam(BEAM, BEAM, CAB.depth + BEAM, -CAB.width / 2, 0, 0);
makeBeam(BEAM, BEAM, CAB.depth + BEAM, CAB.width / 2, 0, 0);

{
  // Gold inset ring around the hole
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CHUTE.size * 0.5 - 0.05, CHUTE.size * 0.5, 32),
    new THREE.MeshBasicMaterial({ color: 0xffcc44, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(CHUTE.cx, CAB.floorY + 0.005, CHUTE.cz);
  cabinet.add(ring);

  // Lip walls — a 4-sided low wall around the chute so prizes can't roll in
  // by themselves. The claw has to actually lift one above lipHeight and drop
  // it through.
  const lipMat = new THREE.MeshStandardMaterial({
    color: 0xffaa55,
    metalness: 0.55,
    roughness: 0.35,
  });
  const lipH = CHUTE.lipHeight;
  const lipT = CHUTE.wallT;
  const half = CHUTE.size / 2;
  const outer = CHUTE.size + 2 * lipT;
  const lipSpec = [
    { w: outer, d: lipT, x: CHUTE.cx, z: CHUTE.cz + half + lipT / 2 },
    { w: outer, d: lipT, x: CHUTE.cx, z: CHUTE.cz - half - lipT / 2 },
    { w: lipT, d: outer, x: CHUTE.cx + half + lipT / 2, z: CHUTE.cz },
    { w: lipT, d: outer, x: CHUTE.cx - half - lipT / 2, z: CHUTE.cz },
  ];
  for (const s of lipSpec) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, lipH, s.d), lipMat);
    m.position.set(s.x, CAB.floorY + lipH / 2, s.z);
    m.castShadow = true;
    m.receiveShadow = true;
    cabinet.add(m);
  }
}

// --- Gantry & claw ---------------------------------------------------------
const gantry = new THREE.Group();
scene.add(gantry);

const railMat = new THREE.MeshStandardMaterial({
  color: 0xc8c8d6,
  metalness: 0.7,
  roughness: 0.3,
});
const xRail = new THREE.Mesh(
  new THREE.BoxGeometry(CAB.width - 0.4, 0.12, 0.16),
  railMat,
);
xRail.position.y = CAB.height - 0.3;
gantry.add(xRail);

const carriage = new THREE.Group();
gantry.add(carriage);
const carriageBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.18, 0.24),
  railMat,
);
carriage.add(carriageBody);

const cable = new THREE.Mesh(
  new THREE.CylinderGeometry(0.025, 0.025, 1, 8),
  new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8 }),
);
carriage.add(cable);

const clawGroup = new THREE.Group();
carriage.add(clawGroup);

const clawBodyMat = new THREE.MeshStandardMaterial({
  color: 0xdadbe6,
  metalness: 0.85,
  roughness: 0.25,
});
const clawJointMat = new THREE.MeshStandardMaterial({
  color: 0x9a9aac,
  metalness: 0.6,
  roughness: 0.4,
});
const clawTipMat = new THREE.MeshStandardMaterial({
  color: 0xff7799,
  metalness: 0.5,
  roughness: 0.4,
});

// Hub housing
const hub = new THREE.Mesh(
  new THREE.CylinderGeometry(0.32, 0.38, 0.28, 28),
  clawBodyMat,
);
hub.castShadow = true;
clawGroup.add(hub);
const hubCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.32, 0.16, 28),
  clawJointMat,
);
hubCap.position.y = 0.18;
clawGroup.add(hubCap);

// Build a single curved finger as a 3-segment kinematic chain.
// Each segment: pivot at the joint, mesh hangs along -Y. The next pivot
// anchors at the far end of the segment, so curl propagates naturally.
function buildFinger(angleAround) {
  const root = new THREE.Group();
  // Anchor on the rim of the hub
  root.position.set(
    Math.cos(angleAround) * 0.30,
    -0.10,
    Math.sin(angleAround) * 0.30,
  );
  // Orient so curl axis (+Z local) is tangential — curling inward bends
  // segments toward the hub center.
  root.rotation.y = -angleAround;

  const segLengths = [0.30, 0.26, 0.22];
  const radii = [0.10, 0.085, 0.07, 0.05]; // top, ..., tip
  const pivots = [];

  let parent = root;
  for (let i = 0; i < segLengths.length; i++) {
    const pivot = new THREE.Group();
    parent.add(pivot);

    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(radii[i + 1], radii[i], segLengths[i], 14),
      clawBodyMat,
    );
    seg.castShadow = true;
    seg.position.y = -segLengths[i] / 2;
    pivot.add(seg);

    // Joint sphere at top of segment for the 'mechanical' look
    const joint = new THREE.Mesh(
      new THREE.SphereGeometry(radii[i] * 1.15, 14, 10),
      clawJointMat,
    );
    joint.castShadow = true;
    pivot.add(joint);

    pivots.push(pivot);

    const nextAnchor = new THREE.Group();
    nextAnchor.position.y = -segLengths[i];
    pivot.add(nextAnchor);
    parent = nextAnchor;
  }

  // Pointed tip at the end of the chain
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.18, 14),
    clawTipMat,
  );
  tip.castShadow = true;
  tip.rotation.x = Math.PI;
  tip.position.y = -0.09;
  parent.add(tip);

  return { root, pivots };
}

const FINGER_COUNT = 3;
const fingers = [];
for (let i = 0; i < FINGER_COUNT; i++) {
  const angle = (i / FINGER_COUNT) * Math.PI * 2;
  const f = buildFinger(angle);
  // Initialize at rest pose
  for (let j = 0; j < f.pivots.length; j++) {
    f.pivots[j].rotation.z = FINGER_OPEN[j];
  }
  clawGroup.add(f.root);
  fingers.push(f);
}

// --- Claw kinematics ------------------------------------------------------
const claw = {
  // Position state
  x: 0,
  z: 0,
  y: CLAW_BOUNDS.topY,
  // Smoothed velocity
  vx: 0,
  vz: 0,
  // Curl: 0 = open (rest), 1 = fully closed
  curl: 0,
  curlTarget: 0,
  carried: null,
  // Slip mechanic — when grabbed, sometimes the prize falls out during the
  // raise / return. carryTime counts seconds since the grab; if slipAt > 0
  // and carryTime reaches it, the prize drops.
  carryTime: 0,
  slipAt: 0,
};

function updateClawTransforms() {
  // Carriage rides the rail in X (so its X follows claw.x), the rail itself
  // slides in Z so the user's Z motion looks like a moving track.
  carriage.position.set(claw.x, 0, 0);
  xRail.position.set(0, CAB.height - 0.3, claw.z);
  carriageBody.position.set(0, CAB.height - 0.3, claw.z);

  const cableTopY = CAB.height - 0.3;
  const cableBotY = claw.y + 0.18;
  const len = Math.max(0.05, cableTopY - cableBotY);
  cable.position.set(0, (cableTopY + cableBotY) / 2, claw.z);
  cable.scale.y = len;

  clawGroup.position.set(0, claw.y, claw.z);

  // Apply curl angles per joint, eased between open and closed pose.
  // curl=0 → fully OPEN, curl=1 → fully CLOSED.
  const c = claw.curl;
  for (const f of fingers) {
    for (let j = 0; j < f.pivots.length; j++) {
      f.pivots[j].rotation.z = FINGER_OPEN[j] * (1 - c) + FINGER_CLOSED[j] * c;
    }
  }
}

// --- Prizes ----------------------------------------------------------------
const prizeColors = [
  0xff5577, 0x59c2ff, 0xffd166, 0x06d6a0, 0xb388ff, 0xffa463, 0x4dd0e1,
];
// Shared resources — reusing geometry and material across all prizes is far
// cheaper than allocating per-mesh.
const prizeSphereGeo = new THREE.SphereGeometry(PRIZE_RADIUS, 18, 14);
const prizeIcoGeo = new THREE.IcosahedronGeometry(PRIZE_RADIUS, 0);
const prizeMats = prizeColors.map(
  (c) =>
    new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.55,
      metalness: 0.05,
    }),
);
const prizes = [];

function spawnPrizes() {
  // Spawn in a central cluster at staggered heights so they pile up naturally
  // once gravity settles them. A few small lateral nudges break perfect
  // vertical stacks.
  for (let i = 0; i < PRIZE_COUNT; i++) {
    const mat = prizeMats[i % prizeMats.length];
    const geo = i % 3 === 0 ? prizeIcoGeo : prizeSphereGeo;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    let x, z;
    let attempts = 0;
    do {
      // Cluster prizes toward the +X / +Z side away from the chute corner.
      x = -0.5 + (Math.random() - 0.5) * 3.2;
      z = -0.5 + (Math.random() - 0.5) * 2.8;
      attempts++;
    } while (nearChute(x, z, 0.8) && attempts < 30);

    const y = PRIZE_RADIUS + 0.4 + Math.random() * 4.5;
    mesh.position.set(x, y, z);
    scene.add(mesh);

    prizes.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        0,
        (Math.random() - 0.5) * 0.4,
      ),
      radius: PRIZE_RADIUS,
      collected: false,
    });
  }
}
spawnPrizes();

function insideChute(x, z) {
  return (
    Math.abs(x - CHUTE.cx) < CHUTE.size / 2 &&
    Math.abs(z - CHUTE.cz) < CHUTE.size / 2
  );
}

function nearChute(x, z, margin) {
  return (
    Math.abs(x - CHUTE.cx) < CHUTE.size / 2 + margin &&
    Math.abs(z - CHUTE.cz) < CHUTE.size / 2 + margin
  );
}

// --- Input -----------------------------------------------------------------
const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
};

function bindDpad() {
  const buttons = document.querySelectorAll(".dir");
  buttons.forEach((btn) => {
    const dir = btn.dataset.dir;
    const on = (e) => {
      e.preventDefault();
      input[dir] = true;
      btn.classList.add("active");
    };
    const off = (e) => {
      e.preventDefault();
      input[dir] = false;
      btn.classList.remove("active");
    };
    btn.addEventListener("touchstart", on, { passive: false });
    btn.addEventListener("touchend", off);
    btn.addEventListener("touchcancel", off);
    btn.addEventListener("mousedown", on);
    btn.addEventListener("mouseup", off);
    btn.addEventListener("mouseleave", off);
  });
}
bindDpad();

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  switch (e.key) {
    case "ArrowUp":
    case "w":
    case "W":
      input.forward = true;
      break;
    case "ArrowDown":
    case "s":
    case "S":
      input.back = true;
      break;
    case "ArrowLeft":
    case "a":
    case "A":
      input.left = true;
      break;
    case "ArrowRight":
    case "d":
    case "D":
      input.right = true;
      break;
    case " ":
    case "Enter":
      requestDrop();
      break;
  }
});
window.addEventListener("keyup", (e) => {
  switch (e.key) {
    case "ArrowUp":
    case "w":
    case "W":
      input.forward = false;
      break;
    case "ArrowDown":
    case "s":
    case "S":
      input.back = false;
      break;
    case "ArrowLeft":
    case "a":
    case "A":
      input.left = false;
      break;
    case "ArrowRight":
    case "d":
    case "D":
      input.right = false;
      break;
  }
});

// Reset view
document.getElementById("reset-view").addEventListener("click", () => {
  camera.position.copy(INITIAL_CAM);
  controls.target.copy(INITIAL_TARGET);
  controls.update();
});

// Assist level cycler
const assistBtn = document.getElementById("assist-btn");
function paintAssistBtn() {
  assistBtn.textContent = `Assist: ${ASSIST.name}`;
  assistBtn.className = `assist-btn ${ASSIST.cls}`;
}
function cycleAssist() {
  assistIdx = (assistIdx + 1) % ASSIST_LEVELS.length;
  ASSIST = ASSIST_LEVELS[assistIdx];
  try {
    localStorage.setItem("claw.assist", String(assistIdx));
  } catch (_) {
    // localStorage may be unavailable (private mode); ignore.
  }
  paintAssistBtn();
}
assistBtn.addEventListener("click", cycleAssist);
paintAssistBtn();

// --- Game state ------------------------------------------------------------
const STATE = {
  IDLE: "idle",
  DROPPING: "dropping",
  GRAB: "grab",
  RAISING: "raising",
  RETURNING: "returning",
  RELEASE: "release",
};
let state = STATE.IDLE;
let stateTimer = 0;
let score = 0;

const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const dropBtn = document.getElementById("drop");

function setStatus(text) {
  statusEl.textContent = text;
}
function setScore(n) {
  score = n;
  scoreEl.textContent = `Score: ${score}`;
}

function requestDrop() {
  if (state !== STATE.IDLE) return;
  state = STATE.DROPPING;
  stateTimer = 0;
  dropBtn.disabled = true;
  setStatus("Dropping...");
}
dropBtn.addEventListener("click", requestDrop);
dropBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  requestDrop();
});

// --- Camera-relative movement basis ---------------------------------------
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

function updateCameraBasis() {
  camera.getWorldDirection(_camForward);
  _camForward.y = 0;
  if (_camForward.lengthSq() < 1e-6) _camForward.set(0, 0, -1);
  _camForward.normalize();
  _camRight.crossVectors(_camForward, _worldUp).normalize();
}

// --- Animation loop --------------------------------------------------------
const clock = new THREE.Clock();
let physAccumulator = 0;

function loop() {
  const frameDt = Math.min(clock.getDelta(), MAX_FRAME_DT);

  // Claw + state machine in per-frame time so motion is buttery smooth
  // regardless of physics substep cadence.
  updateClaw(frameDt);

  // Prize physics in fixed substeps for stable contacts.
  physAccumulator += frameDt;
  let steps = 0;
  while (physAccumulator >= PHYS_DT && steps < 8) {
    updatePrizes(PHYS_DT);
    physAccumulator -= PHYS_DT;
    steps++;
  }
  if (steps === 8) physAccumulator = 0; // bleed off if we fell behind

  visualUpdate(frameDt);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function updateClaw(dt) {
  // Camera-relative target velocity from input, only when idle.
  let tvx = 0,
    tvz = 0;
  if (state === STATE.IDLE) {
    updateCameraBasis();
    let f = 0,
      r = 0;
    if (input.forward) f += 1;
    if (input.back) f -= 1;
    if (input.right) r += 1;
    if (input.left) r -= 1;
    if (f !== 0 || r !== 0) {
      const len = Math.hypot(f, r) || 1;
      f /= len;
      r /= len;
      tvx = (_camForward.x * f + _camRight.x * r) * MAX_HORIZ_SPEED;
      tvz = (_camForward.z * f + _camRight.z * r) * MAX_HORIZ_SPEED;
    }
  } else if (state === STATE.RETURNING) {
    const dx = CHUTE.cx - claw.x;
    const dz = CHUTE.cz - claw.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-3) {
      const s = Math.min(MAX_HORIZ_SPEED, dist * 4);
      tvx = (dx / dist) * s;
      tvz = (dz / dist) * s;
    }
  } else if (state === STATE.DROPPING && ASSIST.aimSpeed > 0) {
    // Aim-assist: gently pull the claw toward the nearest in-range prize as
    // it descends. Search radius keeps it from teleporting across the
    // cabinet — only locks onto prizes that are roughly under the claw.
    let nearest = null;
    let bestDist = AIM_SEARCH_RADIUS;
    for (const p of prizes) {
      if (p.collected) continue;
      const dx = p.mesh.position.x - claw.x;
      const dz = p.mesh.position.z - claw.z;
      const d = Math.hypot(dx, dz);
      if (d < bestDist) {
        bestDist = d;
        nearest = p;
      }
    }
    if (nearest) {
      const dx = nearest.mesh.position.x - claw.x;
      const dz = nearest.mesh.position.z - claw.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      // Ease in: scale down when already close so we don't oscillate.
      const speed = Math.min(ASSIST.aimSpeed, dist * 6);
      tvx = (dx / dist) * speed;
      tvz = (dz / dist) * speed;
    }
  }

  // Frame-rate-independent exponential smoothing of velocity.
  const k = 1 - Math.exp(-HORIZ_ACCEL * dt);
  claw.vx += (tvx - claw.vx) * k;
  claw.vz += (tvz - claw.vz) * k;
  claw.x += claw.vx * dt;
  claw.z += claw.vz * dt;
  claw.x = clamp(claw.x, CLAW_BOUNDS.minX, CLAW_BOUNDS.maxX);
  claw.z = clamp(claw.z, CLAW_BOUNDS.minZ, CLAW_BOUNDS.maxZ);

  // Vertical drop / raise eased toward a target altitude (no constant-velocity
  // teleporting between substeps — this is the source of the up/down jitter).
  let targetY = claw.y;
  switch (state) {
    case STATE.DROPPING:
      targetY = CLAW_BOUNDS.bottomY;
      break;
    case STATE.RAISING:
      targetY = CLAW_BOUNDS.topY;
      break;
    default:
      targetY = claw.y;
  }
  if (state === STATE.DROPPING || state === STATE.RAISING) {
    const dy = targetY - claw.y;
    const maxStep = VERTICAL_SPEED * dt;
    // Cap step so motion is linear/predictable, but glide the last bit so
    // we don't slam against the bound.
    const step = Math.sign(dy) * Math.min(Math.abs(dy), maxStep);
    claw.y += step;
    if (Math.abs(targetY - claw.y) < 1e-3) {
      claw.y = targetY;
      if (state === STATE.DROPPING) {
        state = STATE.GRAB;
        stateTimer = 0;
        claw.curlTarget = 1;
        attemptGrab();
      } else {
        state = STATE.RETURNING;
        stateTimer = 0;
        setStatus("Returning to chute...");
      }
    }
  }

  switch (state) {
    case STATE.GRAB: {
      stateTimer += dt;
      // Soft sweep — while the fingers curl, gently pull any loose prizes
      // within the finger arc toward the claw center. Acts like the inside
      // surface of a real claw scooping things in, and gives a prize that
      // landed just outside the strict grab radius a chance to slide into
      // it before the second-chance grab fires.
      if (!claw.carried) {
        const sweepR = ASSIST.grabRadius + 0.25;
        for (const p of prizes) {
          if (p.collected) continue;
          const dx = claw.x - p.mesh.position.x;
          const dz = claw.z - p.mesh.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 1e-3 && dist < sweepR) {
            const strength = (1 - dist / sweepR) * 3.5;
            const nx = dx / dist;
            const nz = dz / dist;
            p.mesh.position.x += nx * strength * dt;
            p.mesh.position.z += nz * strength * dt;
            // Damp lateral velocity so prizes settle instead of jittering.
            const damp = Math.max(0, 1 - dt * 6);
            p.vel.x *= damp;
            p.vel.z *= damp;
          }
        }
      }
      if (stateTimer >= 0.55) {
        if (!claw.carried) attemptGrab(); // second chance once the sweep has settled
        state = STATE.RAISING;
        stateTimer = 0;
      }
      break;
    }
    case STATE.RETURNING: {
      const dist = Math.hypot(CHUTE.cx - claw.x, CHUTE.cz - claw.z);
      if (dist < 0.03 && Math.hypot(claw.vx, claw.vz) < 0.05) {
        claw.x = CHUTE.cx;
        claw.z = CHUTE.cz;
        claw.vx = claw.vz = 0;
        state = STATE.RELEASE;
        stateTimer = 0;
        claw.curlTarget = 0;
      }
      break;
    }
    case STATE.RELEASE: {
      stateTimer += dt;
      if (stateTimer >= 0.45) {
        if (claw.carried) {
          claw.carried.vel.set(0, 0, 0);
          claw.carried = null;
        }
        claw.carryTime = 0;
        claw.slipAt = 0;
        state = STATE.IDLE;
        dropBtn.disabled = false;
        setStatus("Move the claw and press Drop");
      }
      break;
    }
    case STATE.IDLE: {
      claw.curlTarget = 0;
      break;
    }
  }

  // Carried prize tracks the claw tip smoothly each frame, with a chance
  // of slipping mid-flight if the grab was rolled "loose".
  if (claw.carried) {
    claw.carryTime += dt;
    if (claw.slipAt > 0 && claw.carryTime >= claw.slipAt) {
      const p = claw.carried;
      // Inherit current claw motion + a small downward kick.
      p.vel.set(claw.vx * 0.6, -0.5, claw.vz * 0.6);
      claw.carried = null;
      claw.slipAt = 0;
      claw.curlTarget = 0; // open fingers as it lets go
      setStatus("It slipped!");
    }
  }
  if (claw.carried) {
    const p = claw.carried;
    const targetX = claw.x;
    // Anchor the prize roughly where the fingers actually close around it
    // (mid-finger length below the hub), not below the floor as before.
    const tipY = claw.y - 0.30;
    const targetZ = claw.z;
    // Snap in fast while the fingers are still closing, then settle to a
    // gentler track so swinging looks natural during the rest of the trip.
    const lerpRate = state === STATE.GRAB ? 55 : 22;
    const a = 1 - Math.exp(-lerpRate * dt);
    p.mesh.position.x += (targetX - p.mesh.position.x) * a;
    p.mesh.position.y += (tipY - p.mesh.position.y) * a;
    p.mesh.position.z += (targetZ - p.mesh.position.z) * a;
    p.vel.set(0, 0, 0);
  }
}

function updatePrizes(dt) {
  for (const p of prizes) {
    if (p === claw.carried || p.collected) continue;
    p.vel.y += GRAVITY * dt;
    p.mesh.position.x += p.vel.x * dt;
    p.mesh.position.y += p.vel.y * dt;
    p.mesh.position.z += p.vel.z * dt;

    // Hub-push: only active while the claw is actively descending and still
    // above the floor zone. Disabled near the bottom so the aim-assist can
    // finish lining up the grab without scattering the target, and disabled
    // in every other state so a prize released over the chute can fall
    // straight down without the hub kicking it sideways.
    if (state === STATE.DROPPING && claw.y > CLAW_BOUNDS.bottomY + 0.5) {
      const dx = p.mesh.position.x - claw.x;
      const dy = p.mesh.position.y - (claw.y - 0.1);
      const dz = p.mesh.position.z - claw.z;
      const minDist = CLAW_HUB_RADIUS + p.radius;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > 1e-6 && distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const hMag = Math.hypot(dx, dz) || 1e-6;
        const nx = dx / hMag;
        const nz = dz / hMag;
        p.mesh.position.x += nx * overlap;
        p.mesh.position.z += nz * overlap;
        p.vel.x += nx * ASSIST.hubPush;
        p.vel.z += nz * ASSIST.hubPush;
      }
    }

    // Chute lip — square ring of walls around the chute opening, only active
    // for prizes that are at or below the lip height. Above the lip, prizes
    // can travel freely (and the claw can drop them in from above).
    if (p.mesh.position.y - p.radius < CAB.floorY + CHUTE.lipHeight) {
      const half = CHUTE.size / 2;
      const dx = p.mesh.position.x - CHUTE.cx;
      const dz = p.mesh.position.z - CHUTE.cz;
      const insideFootprint = Math.abs(dx) < half && Math.abs(dz) < half;
      if (!insideFootprint) {
        const closestX = clamp(p.mesh.position.x, CHUTE.cx - half, CHUTE.cx + half);
        const closestZ = clamp(p.mesh.position.z, CHUTE.cz - half, CHUTE.cz + half);
        const ddx = p.mesh.position.x - closestX;
        const ddz = p.mesh.position.z - closestZ;
        const distSq = ddx * ddx + ddz * ddz;
        if (distSq < p.radius * p.radius && distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          const overlap = p.radius - dist;
          const nx = ddx / dist;
          const nz = ddz / dist;
          p.mesh.position.x += nx * overlap;
          p.mesh.position.z += nz * overlap;
          const vDot = p.vel.x * nx + p.vel.z * nz;
          if (vDot < 0) {
            p.vel.x -= 1.3 * vDot * nx;
            p.vel.z -= 1.3 * vDot * nz;
          }
        }
      }
    }

    if (
      p.mesh.position.y < -1.5 ||
      (p.mesh.position.y < CAB.floorY + p.radius &&
        insideChute(p.mesh.position.x, p.mesh.position.z))
    ) {
      p.collected = true;
      scene.remove(p.mesh);
      setScore(score + 1);
      setStatus("Got one!");
      continue;
    }

    if (p.mesh.position.y < CAB.floorY + p.radius) {
      p.mesh.position.y = CAB.floorY + p.radius;
      if (p.vel.y < 0) p.vel.y = -p.vel.y * 0.25;
      p.vel.x *= 0.86;
      p.vel.z *= 0.86;
      // sleep tiny velocities to avoid jitter
      if (Math.abs(p.vel.y) < 0.05) p.vel.y = 0;
      if (Math.abs(p.vel.x) < 0.02) p.vel.x = 0;
      if (Math.abs(p.vel.z) < 0.02) p.vel.z = 0;
    }

    const halfW = CAB.width / 2 - p.radius;
    const halfD = CAB.depth / 2 - p.radius;
    if (p.mesh.position.x < -halfW) {
      p.mesh.position.x = -halfW;
      p.vel.x = Math.abs(p.vel.x) * 0.4;
    } else if (p.mesh.position.x > halfW) {
      p.mesh.position.x = halfW;
      p.vel.x = -Math.abs(p.vel.x) * 0.4;
    }
    if (p.mesh.position.z < -halfD) {
      p.mesh.position.z = -halfD;
      p.vel.z = Math.abs(p.vel.z) * 0.4;
    } else if (p.mesh.position.z > halfD) {
      p.mesh.position.z = halfD;
      p.vel.z = -Math.abs(p.vel.z) * 0.4;
    }
  }

  // Cheap pairwise separation
  for (let i = 0; i < prizes.length; i++) {
    const a = prizes[i];
    if (a.collected || a === claw.carried) continue;
    for (let j = i + 1; j < prizes.length; j++) {
      const b = prizes[j];
      if (b.collected || b === claw.carried) continue;
      const dx = b.mesh.position.x - a.mesh.position.x;
      const dy = b.mesh.position.y - a.mesh.position.y;
      const dz = b.mesh.position.z - a.mesh.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const minDist = a.radius + b.radius;
      if (distSq > 0 && distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq);
        const overlap = (minDist - dist) * 0.5;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        a.mesh.position.x -= nx * overlap;
        a.mesh.position.y -= ny * overlap;
        a.mesh.position.z -= nz * overlap;
        b.mesh.position.x += nx * overlap;
        b.mesh.position.y += ny * overlap;
        b.mesh.position.z += nz * overlap;
        a.vel.x -= nx * 0.15;
        a.vel.z -= nz * 0.15;
        b.vel.x += nx * 0.15;
        b.vel.z += nz * 0.15;
      }
    }
  }
}

function visualUpdate(dt) {
  // Smooth curl toward target so finger motion is buttery.
  const k = 1 - Math.exp(-FINGER_LERP * dt);
  claw.curl += (claw.curlTarget - claw.curl) * k;
  updateClawTransforms();

  // Refill if empty (only when idle)
  if (state === STATE.IDLE && prizes.every((p) => p.collected)) {
    setStatus("Refilling prizes...");
    for (const p of prizes) scene.remove(p.mesh);
    prizes.length = 0;
    spawnPrizes();
    setTimeout(() => {
      if (state === STATE.IDLE) setStatus("Move the claw and press Drop");
    }, 1200);
  }
}

function attemptGrab() {
  // The "tip" for grab purposes is the bottom of the curled fingers, roughly
  // 0.7 units below the hub. Only horizontal alignment really matters — the
  // claw has to be over the prize.
  const tipX = claw.x;
  const tipZ = claw.z;
  let best = null;
  let bestHoriz = Infinity;
  for (const p of prizes) {
    if (p.collected) continue;
    const dx = p.mesh.position.x - tipX;
    const dz = p.mesh.position.z - tipZ;
    const horiz = Math.hypot(dx, dz);
    if (horiz < bestHoriz) {
      bestHoriz = horiz;
      best = p;
    }
  }
  if (!best || bestHoriz > ASSIST.grabRadius) {
    setStatus("Missed — try again");
    return;
  }

  // Distance-modulated probability — dead-centered hits are likely, grazing
  // the edge of the (assist-tuned) radius is almost always a miss.
  const closeness = 1 - bestHoriz / ASSIST.grabRadius;
  const chance =
    ASSIST.baseChance + (ASSIST.bestChance - ASSIST.baseChance) * closeness;

  if (Math.random() < chance) {
    claw.carried = best;
    claw.carryTime = 0;
    if (ASSIST.slip > 0 && Math.random() < ASSIST.slip) {
      claw.slipAt = 0.4 + Math.random() * 1.8; // seconds after grab
    } else {
      claw.slipAt = 0;
    }
    setStatus("Grabbed!");
  } else {
    setStatus("Slipped out — try again");
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

resize();
updateClawTransforms();
setScore(0);
setStatus("Move the claw and press Drop");
loop();
