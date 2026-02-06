import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { openBooster } from "./core/booster.js";

const clock = new THREE.Clock();

// 🎬 Slow motion
let timeScale = 1;
let slowMoUntil = 0;

// ✅ Canvas
const canvasEl = document.getElementById("scene");
if (!canvasEl) throw new Error("Canvas #scene introuvable dans index.html");

// 🌟 Scene / Camera / Renderer
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 3);

const renderer = new THREE.WebGLRenderer({
  canvas: canvasEl,
  alpha: true,
  antialias: true,
  premultipliedAlpha: false
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.setClearAlpha(0);

scene.add(new THREE.AmbientLight(0xffffff, 1));

// ============================
// ✅ UI
// ============================
const shopEl = document.getElementById("shop");
const flashEl = document.getElementById("flash");
const endActionsEl = document.getElementById("end-actions");
const okBtn = document.getElementById("ok-btn");
const againBtn = document.getElementById("again-btn");

// 🔊 Sons
const SFX = {
  open: new Audio("/sfx/open.mp3"),
  common: new Audio("/sfx/common.mp3"),
  rare: new Audio("/sfx/rare.mp3"),
  epic: new Audio("/sfx/epic.mp3"),
  legendary: new Audio("/sfx/legendary.mp3")
};

for (const k in SFX) {
  SFX[k].preload = "auto";
  SFX[k].volume = 0.7;
}
SFX.legendary.volume = 0.9;

function playSfx(audio) {
  if (!audio) return;
  try {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {}
}

// ============================
// 🌟 Globals
// ============================
let boosterMesh = null;
let isOpening = false;
let isSwitching = false;
let isClearing = false;

const cards = [];

const HIDDEN_STACK_Y = 0.75;
const HIDDEN_STACK_Z = 0.95;

const REVEALED_ROW_Y = -0.35;
const REVEALED_ROW_Z = 0.95;

const REVEALED_SPACING = 1.1;

const CARD_SCALE = 0.65;
const CARD_SCALE_SELECTED = 1.18;

const RARITY_GLOW = {
  common: 0.3,
  rare: 0.6,
  epic: 1.0,
  legendary: 1.6
};

// ============================
// 🎴 REVEAL MODE
// ============================
const QUESTION_TEX = "/ui/question.png";
const texLoader = new THREE.TextureLoader();

const textureCache = new Map();
function loadTextureCached(url, onLoad, onError) {
  if (!url) return;
  if (textureCache.has(url)) {
    onLoad(textureCache.get(url));
    return;
  }
  texLoader.load(
    url,
    tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      textureCache.set(url, tex);
      onLoad(tex);
    },
    undefined,
    err => onError?.(err)
  );
}

const revealState = {
  active: false,
  index: 0,
  drawn: [],
  cardObjs: [],
  isRevealing: false
};

function getSlotsX(count) {
  const spacing = 1.05;
  const totalWidth = (count - 1) * spacing;
  const startX = -totalWidth / 2;
  return Array.from({ length: count }, (_, i) => startX + i * spacing);
}

const cardExitTargets = new Map();

// ============================
// 🧠 Selection / Drag
// ============================
let selectedCard = null;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let selectedBase = { x: 0, y: 0, z: 0 };

let targetPos = new THREE.Vector3();
let targetRot = new THREE.Euler();
let targetScale = 1;

// ============================
// 📦 COLLECTION (localStorage)
// ============================
const STORAGE_KEY = "xbooster_collection_v1";

function loadCollection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; }
  catch { return {}; }
}
function saveCollection(col) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(col));
}
function addToCollection(cardsPulled) {
  const col = loadCollection();
  for (const c of cardsPulled) {
    const id = c.id ?? `${c.name ?? "card"}|${c.image ?? ""}`;
    if (!col[id]) {
      col[id] = { id, name: c.name ?? "Sans nom", image: c.image ?? "", rarity: c.rarity ?? "common", count: 0 };
    }
    col[id].count += 1;
  }
  saveCollection(col);
  renderCollection();
}
function computeStats(col) {
  let total = 0;
  const by = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const id in col) {
    const item = col[id];
    total += item.count;
    const r = item.rarity ?? "common";
    if (by[r] == null) by[r] = 0;
    by[r] += item.count;
  }
  return { total, by };
}

// UI collection
const panel = document.getElementById("collection-panel");
const grid = document.getElementById("collection-grid");
const statsEl = document.getElementById("collection-stats");
const btnOpenCol = document.getElementById("open-collection");
const btnCloseCol = document.getElementById("collection-close");
const btnResetCol = document.getElementById("collection-reset");
const sortSel = document.getElementById("collection-sort");

function openCollectionUI() { panel?.classList.remove("hidden"); renderCollection(); }
function closeCollectionUI() { panel?.classList.add("hidden"); }

btnOpenCol?.addEventListener("click", openCollectionUI);
btnCloseCol?.addEventListener("click", closeCollectionUI);
btnResetCol?.addEventListener("click", () => { localStorage.removeItem(STORAGE_KEY); renderCollection(); });
sortSel?.addEventListener("change", () => renderCollection());

function rarityRank(r) {
  return { common: 1, rare: 2, epic: 3, legendary: 4 }[r] ?? 1;
}

function renderCollection() {
  if (!grid || !statsEl) return;

  const col = loadCollection();
  const items = Object.values(col);

  const { total, by } = computeStats(col);
  statsEl.textContent = `Total: ${total} • Common: ${by.common} • Rare: ${by.rare} • Epic: ${by.epic} • Legendary: ${by.legendary}`;

  const mode = sortSel?.value ?? "rarity";
  items.sort((a, b) => {
    if (mode === "name") return (a.name ?? "").localeCompare(b.name ?? "");
    if (mode === "count") return (b.count ?? 0) - (a.count ?? 0);
    const rr = rarityRank(b.rarity) - rarityRank(a.rarity);
    if (rr !== 0) return rr;
    return (b.count ?? 0) - (a.count ?? 0);
  });

  grid.innerHTML = "";
  if (items.length === 0) {
    grid.innerHTML = `<div style="color:white;font-family:Oxanium;">Aucune carte pour l’instant.</div>`;
    return;
  }

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "collection-card";
    card.innerHTML = `
      <img src="${it.image}" alt="${it.name}">
      <div class="collection-meta">
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
          <div style="font-weight:800; font-size:0.95rem;">${it.name}</div>
          <div class="badge ${it.rarity}">${it.rarity}</div>
        </div>
        <div class="count">x${it.count}</div>
      </div>
    `;
    grid.appendChild(card);
  }
}

// ============================
// 🧠 Tween helpers
// ============================
function triggerSlowMo(durationMs = 300, scale = 0.25) {
  timeScale = scale;
  slowMoUntil = performance.now() + durationMs;
}
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function rafTween(durationMs, onUpdate, onDone) {
  const start = performance.now();
  const tick = now => {
    const t = Math.min(1, (now - start) / durationMs);
    onUpdate(t);
    if (t < 1) requestAnimationFrame(tick);
    else onDone?.();
  };
  requestAnimationFrame(tick);
}

// ============================
// 🎬 CINÉMATIQUE
// ============================
const camDefaultPos = camera.position.clone();
const camDefaultFov = camera.fov;
let camShake = 0;

const particleCount = 180;
let particles = null;
let particlesData = [];
let particlesLife = 0;

// ... (TA PARTIE PARTICULES / OPENING RESTE IDENTIQUE)
// Pour gagner du temps, je ne réécris pas tes shaders ici : garde exactement ta partie déjà en place.
function createParticles() { /* === garde ton code existant === */ }
function updateParticles(dt) { /* === garde ton code existant === */ }

function triggerFlash() {
  if (!flashEl) return;
  flashEl.classList.add("on");
  setTimeout(() => flashEl.classList.remove("on"), 120);
}



function playOpeningCinematic(onDone) {
  triggerSlowMo(300, 0.25);

  const fromPos = camera.position.clone();
  const fromFov = camera.fov;

  const targetPos = new THREE.Vector3(0, 0, 2.1);
  const targetFov = 62;

  camShake = 1.0;

  triggerFlash();
  createParticles();

  rafTween(280, t => {
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(fromPos, targetPos, e);
    camera.fov = THREE.MathUtils.lerp(fromFov, targetFov, e);
    camera.updateProjectionMatrix();
  }, () => {
    setTimeout(() => {
      const backPos = camera.position.clone();
      const backFov = camera.fov;

      rafTween(320, t => {
        const e = easeInOutCubic(t);
        camera.position.lerpVectors(backPos, camDefaultPos, e);
        camera.fov = THREE.MathUtils.lerp(backFov, camDefaultFov, e);
        camera.updateProjectionMatrix();
      }, () => {
        camShake = 0;
        onDone?.();
      });
    }, 180);
  });
}

// ============================
// 🛒 SHOP - Boosters config
// ============================
const BOOSTERS = {
  dragonborn: {
    id: "dragonborn",
    label: "DRAGON BORN",
    texture: "/boosters/dragonborn.png",
    odds: { common: 0.86, rare: 0.12, epic: 0.018, legendary: 0.002 }
  },
  abyssescourants: {
    id: "abyssescourants",
    label: "ABYSSES & COURANTS",
    texture: "/boosters/abysses_courants.png",
    odds: { common: 0.78, rare: 0.18, epic: 0.035, legendary: 0.005 },
    pool: ["Trilobite", "Trilobite noir", "Murène"]
  },
  skieswings: {
    id: "skieswings",
    label: "SKIES & Wings",
    texture: "/boosters/skies_wings.png",
    odds: { common: 0.65, rare: 0.25, epic: 0.08, legendary: 0.02 }
  },
  royaume_des_morts: {
    id: "royaume_des_morts",
    label: "ROYAUME DES MORTS",
    texture: "/boosters/royaume_des_morts.png",
    odds: { common: 0.65, rare: 0.25, epic: 0.08, legendary: 0.02 }
  },
  corruption: {
    id: "corruption",
    label: "CORRUPTION",
    texture: "/boosters/corruption.png",
    odds: { common: 0.70, rare: 0.22, epic: 0.07, legendary: 0.01 }
  },
  elementaltitans: {
    id: "elementaltitans",
    label: "ELEMENTAL TITANS",
    texture: "/boosters/elementaltitans.png",
    odds: { common: 0.70, rare: 0.22, epic: 0.07, legendary: 0.01 }
  },
  forestpeoples: {
    id: "forestpeoples",
    label: "FOREST PEOPLES",
    texture: "/boosters/forestpeoples.png",
    odds: { common: 0.70, rare: 0.22, epic: 0.07, legendary: 0.01 }
  },
  wildlife: {
    id: "wildlife",
    label: "WILDLIFE",
    texture: "/boosters/wildlife.png",
    odds: { common: 0.70, rare: 0.22, epic: 0.07, legendary: 0.01 }
  }
};

let currentBooster = BOOSTERS.dragonborn;

const boosterBtns = document.querySelectorAll(".booster-btn[data-booster]");
const activeBtn = document.querySelector(".booster-btn.active[data-booster]");
if (activeBtn) {
  const key = activeBtn.dataset.booster;
  currentBooster = BOOSTERS[key] ?? BOOSTERS.dragonborn;
}

boosterBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    if (isOpening || isSwitching || isClearing || revealState.active) return;

    boosterBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const key = btn.dataset.booster;
    currentBooster = BOOSTERS[key] ?? BOOSTERS.dragonborn;

    if (boosterMesh) boosterMesh.visible = true;
    switchBoosterTo(currentBooster.texture);
  });
});

// ============================
// ✅ BOOSTER
// ============================
function createBooster() {
  const placeholderGeo = new THREE.BoxGeometry(1.2, 1.8, 0.25);
  const placeholderMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
  const mesh = new THREE.Mesh(placeholderGeo, placeholderMat);
  mesh.name = "booster";
  scene.add(mesh);
  mesh.scale.set(1.4, 1.4, 1.4);

  boosterMesh = mesh;
  setBoosterTexture(currentBooster.texture);
  return mesh;
}

function setBoosterTexture(path) {
  if (!boosterMesh) return;

  loadTextureCached(
    path,
    texture => {
      const WIDTH  = 1.2;
      const HEIGHT = 1.8;
      const DEPTH  = 0.25;

      boosterMesh.geometry.dispose();
      boosterMesh.geometry = new THREE.BoxGeometry(WIDTH, HEIGHT, DEPTH);

      boosterMesh.material.dispose();
      boosterMesh.material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.01,
        opacity: 1
      });

      boosterMesh.scale.set(1.4, 1.4, 1.4);
      boosterMesh.position.set(0, 0, 0);
      boosterMesh.rotation.set(0, 0, 0);
    },
    err => console.error("❌ Texture booster introuvable :", path, err)
  );
}

function switchBoosterTo(texturePath) {
  if (!boosterMesh || isOpening || isSwitching || isClearing || revealState.active) return;

  isSwitching = true;
  if (shopEl) shopEl.style.pointerEvents = "none";

  if (boosterMesh.material) {
    boosterMesh.material.transparent = true;
    boosterMesh.material.opacity = 1;
  }

  const startX = 0;
  const outX = -2.2;
  const inX = 2.2;
  const fromRot = boosterMesh.rotation.y;

  rafTween(260, t => {
    const e = easeInOutCubic(t);
    boosterMesh.position.x = THREE.MathUtils.lerp(startX, outX, e);
    boosterMesh.rotation.y = fromRot + e * 0.7;
    if (boosterMesh.material) boosterMesh.material.opacity = 1 - e;
  }, () => {
    setBoosterTexture(texturePath);

    boosterMesh.position.x = inX;
    boosterMesh.rotation.y = fromRot - 0.7;
    if (boosterMesh.material) boosterMesh.material.opacity = 0;

    rafTween(300, t => {
      const e = easeInOutCubic(t);
      boosterMesh.position.x = THREE.MathUtils.lerp(inX, startX, e);
      boosterMesh.rotation.y = (fromRot - 0.7) + e * 0.7;
      if (boosterMesh.material) boosterMesh.material.opacity = e;
    }, () => {
      boosterMesh.position.x = 0;
      boosterMesh.rotation.y = 0;
      if (boosterMesh.material) boosterMesh.material.opacity = 1;

      isSwitching = false;
      if (shopEl) shopEl.style.pointerEvents = "auto";
    });
  });
}

function openBooster3D() {
  if (isOpening || revealState.active) return;

  isOpening = true;
  playSfx(SFX.open);

  hideShop();
  hideEndActions();

  playOpeningCinematic(() => {
    clearRevealedCards();
    hideEndActions();

    boosterMesh.visible = false;

    const drawn = openBooster(5, currentBooster.id, currentBooster.odds, currentBooster.pool);
    addToCollection(drawn);

    revealState.active = true;
    revealState.index = 0;
    revealState.drawn = drawn;
    revealState.cardObjs = [];

    const slotsX = getSlotsX(drawn.length);

    drawn.forEach((data, i) => {
      const c = createCard(data.image, data.rarity);
      c.finalX = slotsX[i];
      c.group.visible = i === 0; // 1 seule visible au départ
      revealState.cardObjs.push(c);
    });

    isOpening = false;
  });
}

function showShop() {
  if (shopEl) shopEl.style.display = "";
  if (boosterMesh) boosterMesh.visible = true;
  hideEndActions();
}

function hideShop() {
  if (shopEl) shopEl.style.display = "none";
  hideEndActions();
}

function showEndButtons() {
  endActionsEl?.classList.remove("hidden");
}

function hideEndActions() {
  endActionsEl?.classList.add("hidden");
}

okBtn?.addEventListener("click", () => {
  // retour au shop
  clearRevealedCards();
  showShop();

  // remet le booster 3D du booster courant
  setBoosterTexture(currentBooster.texture);
});

againBtn?.addEventListener("click", () => {
  // ouvrir encore un booster du même type
  clearRevealedCards();
  hideEndActions();
  openBooster3D(); // ré-ouvre direct le même booster
});

function createCard(realFrontUrl, rarity = "common") {
  const group = new THREE.Group();

  const geo = new THREE.PlaneGeometry(1, 1.5);

  const frontMat = new THREE.MeshBasicMaterial({ transparent: true, color: 0xffffff });
  const backMat  = new THREE.MeshBasicMaterial({ transparent: true });

  const BACK_TEX = "/ui/card_back.png"; // mets ton image de dos ici

  loadTextureCached(BACK_TEX, tex => {
    backMat.map = tex;
    backMat.needsUpdate = true;
  }, () => {
    // fallback si pas d'image de dos
    backMat.color.set(0x111111);
  });


  const front = new THREE.Mesh(geo, frontMat);
  const back  = new THREE.Mesh(geo, backMat);

  back.rotation.y = Math.PI;

  group.add(front);
  group.add(back);

  // Texture ?
  loadTextureCached(QUESTION_TEX, tex => {
    frontMat.map = tex;
    frontMat.needsUpdate = true;
  });

  group.scale.set(CARD_SCALE, CARD_SCALE, CARD_SCALE);
  group.position.set(0, HIDDEN_STACK_Y, HIDDEN_STACK_Z);

  scene.add(group);

  const cardObj = {
    group,
    front,
    back,
    realUrl: realFrontUrl,
    rarity,
    isRevealed: false,
    basePos: new THREE.Vector3(),
    baseRot: new THREE.Euler()
  };

  cards.push(cardObj);
  return cardObj;
}

function disposeMaterial(mat){
  if (!mat) return;
  if (mat.map) mat.map = null;
  mat.dispose?.();
}

function clearRevealedCards() {
  // supprime les meshes de cartes
  for (const c of revealState.cardObjs) {
    if (!c?.group) continue;
    scene.remove(c.group);

    // dispose geometry/materials
    c.front?.geometry?.dispose?.();
    c.back?.geometry?.dispose?.();
    disposeMaterial(c.front?.material);
    disposeMaterial(c.back?.material);
  }

  revealState.active = false;
  revealState.index = 0;
  revealState.drawn = [];
  revealState.cardObjs = [];
  revealState.isRevealing = false;
}

function revealNextCard() {
  if (!revealState.active || revealState.isRevealing) return;

  const current = revealState.cardObjs[revealState.index];
  if (!current) return;

  revealState.isRevealing = true;

  function finishRevealMove() {
    // Déplacement vers la rangée gauche
    rafTween(320, t => {
      current.group.position.x = THREE.MathUtils.lerp(0, current.finalX, t);
      current.group.position.y = THREE.MathUtils.lerp(HIDDEN_STACK_Y, REVEALED_ROW_Y, t);
      current.group.position.z = REVEALED_ROW_Z;
    }, () => {
      current.basePos.copy(current.group.position);
      current.baseRot.copy(current.group.rotation);

      revealState.index++;

      const next = revealState.cardObjs[revealState.index];
      if (next) next.group.visible = true;

      // 🎉 FIN DES 5 CARTES
      if (revealState.index >= revealState.cardObjs.length) {
        showEndButtons();
      }

      revealState.isRevealing = false;
    });
  }

  // 🔊 son selon rareté
  const sfx =
    current.rarity === "legendary" ? SFX.legendary :
    current.rarity === "epic" ? SFX.epic :
    current.rarity === "rare" ? SFX.rare :
    SFX.common;

  // 1️⃣ Flip vers dos
  rafTween(220, t => {
    current.group.rotation.y = Math.PI * t;
  }, () => {

    // 2️⃣ Charger la vraie image
    loadTextureCached(
      current.realUrl,
      tex => {
        current.front.material.map = tex;
        current.front.material.needsUpdate = true;
        current.isRevealed = true;
        playSfx(sfx);

        // 3️⃣ Flip retour face caméra
        rafTween(220, t => {
          current.group.rotation.y = Math.PI * (1 - t);
        }, () => {
          finishRevealMove();
        });
      },

      // ❌ IMAGE MANQUANTE → FALLBACK (IMPORTANT)
      () => {
        console.warn("⚠️ Image manquante :", current.realUrl);

        current.front.material.color.set(0xff0055);
        current.isRevealed = true;

        rafTween(220, t => {
          current.group.rotation.y = Math.PI * (1 - t);
        }, () => {
          finishRevealMove();
        });
      }
    );
  });
}

// ============================
// ✅ Raycaster + pointer
// ============================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const canvas = renderer.domElement;

function setMouseFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

/* ✅ CURSEUR MAIN SUR LE BOOSTER 3D */
canvas.addEventListener("pointermove", (event) => {
  if (isDragging) return;

  setMouseFromEvent(event);
  raycaster.setFromCamera(mouse, camera);

  const canHoverBooster =
    !isOpening && !isSwitching && !isClearing && !revealState.active && boosterMesh?.visible;

  if (canHoverBooster && boosterMesh) {
    const hit = raycaster.intersectObject(boosterMesh, true);
    if (hit.length > 0) {
      canvas.style.cursor = 'url("/ui/cursor2.png") 6 6, pointer';
      return;
    }
  }
  canvas.style.cursor = 'url("/ui/cursor.png") 6 6, auto';
});

/* ✅ CLIC SUR BOOSTER */
canvas.addEventListener("pointerdown", (e) => {
  setMouseFromEvent(e);
  raycaster.setFromCamera(mouse, camera);

  // ===============================
  // 🎴 MODE RÉVÉLATION DES CARTES
  // ===============================
  if (revealState.active) {
    if (revealState.isRevealing) return;

    const current = revealState.cardObjs[revealState.index];
    if (!current) return;

    // On teste le groupe entier (plus fiable)
    const hits = raycaster.intersectObject(current.group, true);
    if (hits.length > 0 && !current.isRevealed) {
      revealNextCard();
    }
    return;
  }

  // ===============================
  // 📦 OUVERTURE DU BOOSTER
  // ===============================
  if (isOpening || isSwitching || isClearing) return;
  if (!boosterMesh || !boosterMesh.visible) return;

  const hit = raycaster.intersectObject(boosterMesh, true);
  if (hit.length > 0) {
    openBooster3D();
  }
});

/* (le glow sera branché juste après avec RARITY_GLOW) */

  // Flip
  /*rafTween(200, t => {
    current.group.rotation.y = Math.PI * t;
  }, () => {
    loadTextureCached(current.realUrl, tex => {
      current.front.material.map = tex;
      current.front.material.needsUpdate = true;
      current.isRevealed = true;

      rafTween(200, t => {
        current.group.rotation.y = Math.PI * (1 - t);
      }, () => {
        rafTween(300, t => {
          current.group.position.x = THREE.MathUtils.lerp(0, current.finalX, t);
          current.group.position.y = THREE.MathUtils.lerp(HIDDEN_STACK_Y, REVEALED_ROW_Y, t);
        }, () => {
          current.basePos.copy(current.group.position);
          current.baseRot.copy(current.group.rotation);

          revealState.index++;
          const next = revealState.cardObjs[revealState.index];
          if (next) next.group.visible = true;

          revealState.isRevealing = false;
        });
      });
    });
  });
  */

// ============================
// ✅ SECRET MODAL LOGIC
// ============================
const hotspot = document.getElementById("secret-hotspot");
const secretModal = document.getElementById("secret-modal");
const secretClose = document.getElementById("secret-close");

function triggerSecretFlash() {
  const flash = document.getElementById("flash");
  if (!flash) return;
  flash.classList.add("on");
  setTimeout(() => flash.classList.remove("on"), 120);
}

function openSecretModal() {
  if (!secretModal) return;

  secretModal.classList.remove("hidden");
  secretModal.classList.add("is-open");

  secretModal.classList.remove("secret-active");
  void secretModal.offsetWidth;
  secretModal.classList.add("secret-active");

  triggerSecretFlash();
}

function closeSecretModal() {
  secretModal?.classList.add("hidden");
  secretModal?.classList.remove("is-open", "secret-active");
}

hotspot?.addEventListener("click", openSecretModal);
secretClose?.addEventListener("click", closeSecretModal);

secretModal?.addEventListener("click", (e) => {
  if (e.target === secretModal) closeSecretModal();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSecretModal();
});

// ============================
// ✅ Render loop
// ============================
function animate() {
  requestAnimationFrame(animate);

  let dt = clock.getDelta();

  if (slowMoUntil > 0 && performance.now() > slowMoUntil) {
    slowMoUntil = 0;
    timeScale = 1;
  }
  dt *= timeScale;

  updateParticles(dt);

  if (camShake > 0) {
    camShake = Math.max(0, camShake - dt * 2.0);
    camera.position.x = camDefaultPos.x + (Math.random() - 0.5) * 0.03 * camShake;
    camera.position.y = camDefaultPos.y + (Math.random() - 0.5) * 0.03 * camShake;
  }

  renderer.render(scene, camera);
}
animate();

// Init booster
boosterMesh = createBooster();


// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

