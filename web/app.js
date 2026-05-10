import * as THREE from "three";

// --- Cabinet dimensions (world units) ---------------------------------------
const CAB = {
  width: 6, // X span (interior)
  depth: 5, // Z span (interior)
  height: 7, // Y span (interior)
  wall: 0.12,
  floorY: 0,
};

// Drop chute is a square hole in the floor at -X / -Z corner.
const CHUTE = {
  size: 1.2,
  cx: -CAB.width / 2 + 0.9,
  cz: -CAB.depth / 2 + 0.9,
};

// Claw motion bounds (interior, with margin so claw doesn't clip walls).
const CLAW_BOUNDS = {
  minX: -CAB.width / 2 + 0.6,
  maxX: CAB.width / 2 - 0.6,
  minZ: -CAB.depth / 2 + 0.6,
  maxZ: CAB.depth / 2 - 0.6,
  topY: CAB.height - 1.0,
  bottomY: CAB.floorY + 0.55,
};

const PRIZE_COUNT = 14;
const PRIZE_RADIUS = 0.42;
const GRAB_RADIUS = 0.55;
const MOVE_SPEED = 3.0; // units / second
const VERTICAL_SPEED = 2.5;
const GRAVITY = -9.0;

// --- Renderer / scene -------------------------------------------------------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e1a);
scene.fog = new THREE.Fog(0x0e0e1a, 18, 36);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
function placeCamera() {
  const portrait = window.innerHeight > window.innerWidth;
  if (portrait) {
    camera.position.set(0, 5.5, 11.5);
  } else {
    camera.position.set(0, 5.0, 10.5);
  }
  camera.lookAt(0, 3.0, 0);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  placeCamera();
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);

// --- Lights -----------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.45));

const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(6, 12, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -10;
keyLight.shadow.camera.right = 10;
keyLight.shadow.camera.top = 10;
keyLight.shadow.camera.bottom = -10;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 30;
scene.add(keyLight);

const pinkLight = new THREE.PointLight(0xff5599, 0.7, 18);
pinkLight.position.set(-4, 6, 4);
scene.add(pinkLight);

const blueLight = new THREE.PointLight(0x59c2ff, 0.7, 18);
blueLight.position.set(4, 6, -4);
scene.add(blueLight);

// --- Cabinet ---------------------------------------------------------------
const cabinet = new THREE.Group();
scene.add(cabinet);

// Floor with chute hole, made from 4 strips around the chute.
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

  // Strip A: full width, in front of chute (negative Z side)
  addStrip(-W / 2, xLeftEnd, -D / 2, D / 2); // left of chute, full depth
  addStrip(xRightStart, W / 2, -D / 2, D / 2); // right of chute, full depth
  addStrip(xLeftEnd, xRightStart, -D / 2, zNearEnd); // gap between, in front
  addStrip(xLeftEnd, xRightStart, zFarStart, D / 2); // gap between, behind

  function addStrip(x0, x1, z0, z1) {
    const w = x1 - x0;
    const d = z1 - z0;
    if (w <= 0 || d <= 0) return;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.1, d),
      floorMat,
    );
    m.position.set((x0 + x1) / 2, CAB.floorY - 0.05, (z0 + z1) / 2);
    m.receiveShadow = true;
    g.add(m);
  }

  return g;
}
cabinet.add(makeFloorWithHole());

// Glass walls
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xaad9ff,
  transmission: 0.85,
  opacity: 0.35,
  transparent: true,
  roughness: 0.05,
  metalness: 0.0,
  thickness: 0.1,
  side: THREE.DoubleSide,
});

function makeWall(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
  m.position.set(x, y, z);
  cabinet.add(m);
}
const H = CAB.height;
const T = CAB.wall;
makeWall(CAB.width, H, T, 0, H / 2, -CAB.depth / 2); // back
makeWall(CAB.width, H, T, 0, H / 2, CAB.depth / 2); // front
makeWall(T, H, CAB.depth, -CAB.width / 2, H / 2, 0); // left
makeWall(T, H, CAB.depth, CAB.width / 2, H / 2, 0); // right

// Frame edges
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
// vertical corners
for (const sx of [-1, 1])
  for (const sz of [-1, 1])
    makeBeam(
      BEAM,
      H + 0.1,
      BEAM,
      (sx * CAB.width) / 2,
      H / 2,
      (sz * CAB.depth) / 2,
    );
// top frame
makeBeam(CAB.width + BEAM, BEAM, BEAM, 0, H, -CAB.depth / 2);
makeBeam(CAB.width + BEAM, BEAM, BEAM, 0, H, CAB.depth / 2);
makeBeam(BEAM, BEAM, CAB.depth + BEAM, -CAB.width / 2, H, 0);
makeBeam(BEAM, BEAM, CAB.depth + BEAM, CAB.width / 2, H, 0);
// bottom frame
makeBeam(CAB.width + BEAM, BEAM, BEAM, 0, 0, -CAB.depth / 2);
makeBeam(CAB.width + BEAM, BEAM, BEAM, 0, 0, CAB.depth / 2);
makeBeam(BEAM, BEAM, CAB.depth + BEAM, -CAB.width / 2, 0, 0);
makeBeam(BEAM, BEAM, CAB.depth + BEAM, CAB.width / 2, 0, 0);

// Chute marker (gold ring on floor edge)
{
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CHUTE.size * 0.45, CHUTE.size * 0.55, 32),
    new THREE.MeshBasicMaterial({ color: 0xffcc44, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(CHUTE.cx, CAB.floorY + 0.005, CHUTE.cz);
  cabinet.add(ring);
}

// --- Gantry & claw ---------------------------------------------------------
const gantry = new THREE.Group();
scene.add(gantry);

// X-rail (runs along X at top, moves in Z)
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

// Carriage on the rail (moves in X), holds the cable
const carriage = new THREE.Group();
gantry.add(carriage);
const carriageBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.18, 0.24),
  railMat,
);
carriageBody.position.y = CAB.height - 0.3;
carriage.add(carriageBody);

// Cable
const cable = new THREE.Mesh(
  new THREE.CylinderGeometry(0.025, 0.025, 1, 8),
  new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8 }),
);
carriage.add(cable);

// Claw assembly
const clawGroup = new THREE.Group();
carriage.add(clawGroup);

const clawBodyMat = new THREE.MeshStandardMaterial({
  color: 0xdadbe6,
  metalness: 0.85,
  roughness: 0.25,
});
const clawTipMat = new THREE.MeshStandardMaterial({
  color: 0xff7799,
  metalness: 0.5,
  roughness: 0.4,
});

// Hub
const hub = new THREE.Mesh(
  new THREE.CylinderGeometry(0.22, 0.28, 0.22, 24),
  clawBodyMat,
);
hub.castShadow = true;
clawGroup.add(hub);

// Three fingers, each is a pivot group with a finger mesh.
const FINGER_COUNT = 3;
const fingers = [];
for (let i = 0; i < FINGER_COUNT; i++) {
  const angle = (i / FINGER_COUNT) * Math.PI * 2;
  const pivot = new THREE.Group();
  pivot.position.set(
    Math.cos(angle) * 0.22,
    -0.08,
    Math.sin(angle) * 0.22,
  );
  pivot.rotation.y = -angle + Math.PI / 2;
  clawGroup.add(pivot);

  const fingerMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.55, 0.14),
    clawBodyMat,
  );
  fingerMesh.castShadow = true;
  fingerMesh.position.set(0, -0.27, 0);
  pivot.add(fingerMesh);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 12), clawTipMat);
  tip.castShadow = true;
  tip.rotation.x = Math.PI;
  tip.position.set(0, -0.6, 0);
  pivot.add(tip);

  fingers.push(pivot);
}

// State for claw position
const claw = {
  x: 0,
  z: 0,
  y: CLAW_BOUNDS.topY,
  open: 1, // 1 fully open, 0 closed
  carried: null,
};

function updateClawTransforms() {
  carriage.position.set(claw.x, 0, 0);
  xRail.position.set(0, CAB.height - 0.3, claw.z);
  // carriage body slides along its own X but stays at same Z as rail
  carriageBody.position.set(0, CAB.height - 0.3, claw.z);
  cable.position.set(0, (CAB.height - 0.3 + claw.y + 0.1) / 2, claw.z);
  cable.scale.y = Math.max(0.05, CAB.height - 0.3 - (claw.y + 0.1));
  clawGroup.position.set(0, claw.y, claw.z);
  // open factor: 0 = closed (fingers tilted inward), 1 = open
  const tilt = (1 - claw.open) * 0.55; // radians inward
  for (const p of fingers) {
    p.rotation.z = -tilt;
  }
}

// --- Prizes ----------------------------------------------------------------
const prizeColors = [
  0xff5577, 0x59c2ff, 0xffd166, 0x06d6a0, 0xb388ff, 0xffa463, 0x4dd0e1,
];
const prizes = [];

function spawnPrizes() {
  for (let i = 0; i < PRIZE_COUNT; i++) {
    const color = prizeColors[i % prizeColors.length];
    const geo =
      i % 3 === 0
        ? new THREE.IcosahedronGeometry(PRIZE_RADIUS, 0)
        : new THREE.SphereGeometry(PRIZE_RADIUS, 18, 14);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    let x, z;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * (CAB.width - 1.2);
      z = (Math.random() - 0.5) * (CAB.depth - 1.2);
      attempts++;
    } while (insideChute(x, z) && attempts < 20);

    mesh.position.set(x, PRIZE_RADIUS + 0.05, z);
    scene.add(mesh);

    prizes.push({
      mesh,
      vel: new THREE.Vector3(0, 0, 0),
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

// --- Animation loop --------------------------------------------------------
const clock = new THREE.Clock();

function step() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(step);
}

function update(dt) {
  // Horizontal control only when idle.
  if (state === STATE.IDLE) {
    let dx = 0,
      dz = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.forward) dz -= 1;
    if (input.back) dz += 1;
    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz) || 1;
      claw.x = clamp(
        claw.x + (dx / len) * MOVE_SPEED * dt,
        CLAW_BOUNDS.minX,
        CLAW_BOUNDS.maxX,
      );
      claw.z = clamp(
        claw.z + (dz / len) * MOVE_SPEED * dt,
        CLAW_BOUNDS.minZ,
        CLAW_BOUNDS.maxZ,
      );
    }
  }

  // Drop sequence
  switch (state) {
    case STATE.DROPPING: {
      claw.y -= VERTICAL_SPEED * dt;
      if (claw.y <= CLAW_BOUNDS.bottomY) {
        claw.y = CLAW_BOUNDS.bottomY;
        state = STATE.GRAB;
        stateTimer = 0;
        attemptGrab();
      }
      break;
    }
    case STATE.GRAB: {
      stateTimer += dt;
      claw.open = Math.max(0.1, 1 - stateTimer / 0.4);
      if (stateTimer >= 0.45) {
        state = STATE.RAISING;
        stateTimer = 0;
      }
      break;
    }
    case STATE.RAISING: {
      claw.y += VERTICAL_SPEED * dt;
      if (claw.y >= CLAW_BOUNDS.topY) {
        claw.y = CLAW_BOUNDS.topY;
        state = STATE.RETURNING;
        stateTimer = 0;
        setStatus("Returning to chute...");
      }
      break;
    }
    case STATE.RETURNING: {
      const tx = CHUTE.cx;
      const tz = CHUTE.cz;
      const dx = tx - claw.x;
      const dz = tz - claw.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = MOVE_SPEED * dt;
      if (dist <= stepLen) {
        claw.x = tx;
        claw.z = tz;
        state = STATE.RELEASE;
        stateTimer = 0;
      } else {
        claw.x += (dx / dist) * stepLen;
        claw.z += (dz / dist) * stepLen;
      }
      break;
    }
    case STATE.RELEASE: {
      stateTimer += dt;
      claw.open = Math.min(1, stateTimer / 0.3);
      if (stateTimer >= 0.35) {
        if (claw.carried) {
          // Drop into chute: prize falls and gets collected.
          claw.carried.vel.set(0, 0, 0);
          claw.carried = null;
        }
        state = STATE.IDLE;
        dropBtn.disabled = false;
        setStatus("Move the claw and press Drop");
      }
      break;
    }
  }

  // Carried prize follows claw tip
  if (claw.carried) {
    const p = claw.carried;
    p.mesh.position.set(claw.x, claw.y - 0.6, claw.z);
    p.vel.set(0, 0, 0);
  }

  // Physics for free prizes
  for (const p of prizes) {
    if (p === claw.carried) continue;
    if (p.collected) continue;

    p.vel.y += GRAVITY * dt;
    p.mesh.position.x += p.vel.x * dt;
    p.mesh.position.y += p.vel.y * dt;
    p.mesh.position.z += p.vel.z * dt;

    // Collect if dropped through chute
    if (
      p.mesh.position.y < -1.5 ||
      (p.mesh.position.y < CAB.floorY + p.radius &&
        insideChute(p.mesh.position.x, p.mesh.position.z))
    ) {
      if (!p.collected) {
        p.collected = true;
        scene.remove(p.mesh);
        setScore(score + 1);
        setStatus("Got one!");
      }
      continue;
    }

    // Floor
    if (p.mesh.position.y < CAB.floorY + p.radius) {
      p.mesh.position.y = CAB.floorY + p.radius;
      if (p.vel.y < 0) p.vel.y = -p.vel.y * 0.25;
      p.vel.x *= 0.85;
      p.vel.z *= 0.85;
    }
    // Walls (interior)
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

  // Prize–prize separation (cheap)
  for (let i = 0; i < prizes.length; i++) {
    const a = prizes[i];
    if (a.collected || a === claw.carried) continue;
    for (let j = i + 1; j < prizes.length; j++) {
      const b = prizes[j];
      if (b.collected || b === claw.carried) continue;
      const dx = b.mesh.position.x - a.mesh.position.x;
      const dz = b.mesh.position.z - a.mesh.position.z;
      const dy = b.mesh.position.y - a.mesh.position.y;
      const distSq = dx * dx + dy * dy + dz * dz;
      const minDist = a.radius + b.radius;
      if (distSq > 0 && distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq);
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        a.mesh.position.x -= nx * overlap;
        a.mesh.position.y -= ny * overlap;
        a.mesh.position.z -= nz * overlap;
        b.mesh.position.x += nx * overlap;
        b.mesh.position.y += ny * overlap;
        b.mesh.position.z += nz * overlap;
        a.vel.x -= nx * 0.2;
        a.vel.z -= nz * 0.2;
        b.vel.x += nx * 0.2;
        b.vel.z += nz * 0.2;
      }
    }
  }

  // Decorative claw open/close visuals when idle
  if (state === STATE.IDLE || state === STATE.DROPPING) {
    claw.open = 1;
  }

  updateClawTransforms();

  // Respawn if everything collected
  if (prizes.every((p) => p.collected) && state === STATE.IDLE) {
    setStatus("Refilling prizes...");
    for (const p of prizes) scene.remove(p.mesh);
    prizes.length = 0;
    spawnPrizes();
    setTimeout(() => setStatus("Move the claw and press Drop"), 1200);
  }
}

function attemptGrab() {
  // Find nearest prize within grab radius of claw tip.
  const tipX = claw.x;
  const tipY = claw.y - 0.5;
  const tipZ = claw.z;

  let best = null;
  let bestDistSq = GRAB_RADIUS * GRAB_RADIUS;
  for (const p of prizes) {
    if (p.collected) continue;
    const dx = p.mesh.position.x - tipX;
    const dy = p.mesh.position.y - tipY;
    const dz = p.mesh.position.z - tipZ;
    const dSq = dx * dx + dy * dy + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = p;
    }
  }

  if (best) {
    // 70% grab probability for a bit of arcade feel.
    if (Math.random() < 0.7) {
      claw.carried = best;
      setStatus("Grabbed!");
      return;
    }
  }
  setStatus("Missed — try again");
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Kick off
resize();
updateClawTransforms();
setScore(0);
setStatus("Move the claw and press Drop");
step();
