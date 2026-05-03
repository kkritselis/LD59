![Signal's Edge — game logo](assets/textures/logo.png)

# LD59 — Signal's Edge
### *They came from every direction. You came from somewhere worse.*

A top-down survival defense game where you balance base protection, resource gathering, and signal integrity on a hostile alien world. After crash landing, you must expand outward under constant pressure, harvesting materials to construct and stabilize a transmission array while escalating alien waves force you to choose between defense, exploration, and getting a distress signal out before everything collapses.

**Engine:** Three.js (HTML5), ES modules  
**Jam track:** Ludum Dare 59 · **Fireside Jam** · GDFG · 100 Day Jam  

**Ludum Dare 59 (Apr 17–19, 2026):** **complete** — first milestone shipped (LD / embed / local package).

**Fireside Jam (Apr 17–26, 2026, theme: Manage):** **in progress** — second weekend of the multi-jam experiment. Jam deadline is tight; personal schedule limits this sprint to a **single concentrated work block (~12–14 hours)**. Optimize for shippable deltas: credits compliance, clearer presentation, stronger early-game feel, and one solid enemy visual pass.

---

## The Strategy

Rather than burning out on a single 72-hour jam, this project runs across four overlapping game jams with staggered deadlines. The same game is submitted to each — every weekend is another jam deadline, another forced polish pass, another revision. The game compounds instead of getting abandoned.

| Jam | Dates | Theme | Goal |
|-----|-------|-------|------|
| Ludum Dare 59 | Apr 17–19 | Signal | Playable core loop |
| Fireside Jam | Apr 17–26 | Manage | Feels like a real game |
| GDFG | Apr 9–May 3 | Double Crisis | Depth and drama |
| 100 Day Jam | Jan 31–May 12 | Horror – Lost Signal | Polished final release |

---

## Fireside sprint — goals for this session (~12–14 h)

Ordered roughly by **jam compliance first**, then **player-facing impact**, then **deliverables**.

### Must / should ship today

- [X] **Credits (Fireside requirement)** — full attribution for code, libraries, fonts, Synty (or other) asset packs, any CC models, sounds, and tools. **Settings UI:** fill **`#settings-info-text`** (system tab) with real credits copy; tab toggle is wired (header click, `system_modal.png` background). Judges still need the **content** completed and proofread.
- [x] **Enemy creature model pass** — replaced torus placeholder with `assets/obj/spider.glb`; enemy scale tuned down; attack/death playback works; walk clip selection now auto-falls back by name matching and clip exclusion.
- [x] **Wave pacing / opening pressure** — added a strong opening read by spawning **50 enemies at session start**, scattered over valid flow-field cells. Regular wave schedule remains the 60-second cadence.
- [ ] **Spawn presentation** — stop enemies **materializing in a long line on the UV border**; add **spawn holes / surface portals** (mesh + short emerge animation or staged visibility) so spawns read as “emerging from the ground” at a small set of perimeter points.
- [x] **UI pass (current sprint)** — dock store card layout retuned for manual positioning: card body de-flexed, ratio/cost decoupled via absolute positioning, ratio omitted when `store.json` `max` is null/empty, and dock footer actions removed from modal markup for a cleaner panel while polishing.
- [ ] **Audio “attention” pass** — klaxon loop while base armor &lt; max (`AudioManager` + `assets/audio/klaxon.mp3`); first-resource sting (`ironOre.mp3`); VO at game start (`hostilesInbound` → `takeTheFighter`). Still wanted: wave sting; attack/impact when enemies hit towers.

### Ship / ops (non-code or parallel)

- [x] **itch.io** — create/update the Fireside Jam game page, screenshots, short description, credits mirror, and upload the same zip build you use for the jam.
- [x] **Playtest pass** — 10–15 minutes after changes: embed rules (no external `fetch` to third parties), storage off in iframe, and **zip root `index.html`**.


### Already true in repo (do not duplicate work)

- [x] Dock **manage** loop — spend resources on repair, tower, transmission increments, weapon tier; distress win when funded.
- [x] **Local Three** — `index.html` import map → `./js/three.module.js` + explicit `./js/jsm/...` paths; `FBXLoader` patched for r169 `ColorManagement.toWorkingColorSpace` API.
- [x] **Core SFX pipeline** — `AudioManager`: BGM, VO chain, warp sting (`introCutScene.mp3`), klaxon (armor-scaled loop), `ironOre` first pickup, blasters, resource pickup; buffers decode after `init()` with pending-play flush for async loads.
- [x] **100 resource nodes**, expanded flow field (`FLOW_FIELD_AREA_MULT`), radar (**F**), transmission + towers + win overlay (from LD weekend).

---

## Week 1 — Ludum Dare 59 (Apr 17–19, 2026) — COMPLETE

*Goal: does it feel like a game? Ship something playable.*

### Core loop (all in the LD59 build)

- [x] Three.js scene with procedural terrain (shader heightmap + CPU mirror in `terrain.js`)
- [x] Ship, hangar, **cruiser wreck** (`SM_Ship_Cruiser_02.fbx` parented under hangar with baked pose), transmission mast, defense tower pieces, resource pickups — FBX (`FBXLoader`, local `js/jsm` + `js/three.module.js`). Mast fitted height **`TRANSMISSION_VISUAL_HEIGHT`** (~**0.775** world units full build); hidden when base scrolls off the terrain tile (same **`TERRAIN_HALF`** rule as hangar). Cruiser **damage smoke** (`THREE.Points`, intensity vs missing armor).
- [x] Delta-time game loop; screen flow Loading → Menu → Game; settings modal
- [x] WASD / arrow flight; ship banking and pitch; autopilot takeoff / landing; snap-to-pad when near base
- [x] Geological cross-section; sky shader; **main menu** — dual WebGL layers (`#menu-bg-canvas` planet shader + `#menu-intro-canvas` cruiser and warp exit VFX); staggered ship path and hull fade-in on Start; gameplay begins on landscape (captain’s-log modal removed); centered WASD hint fades on first movement key.
- [x] **Enemies** — `spider.glb` with mixer (walk/attack/death), flow-field movement; root yaw tracks motion direction in world space; **one** base HP damage per enemy on contact then death clip / removal (no drain-while-standing bug).
- [x] **Waves** — ~**60 s** timer, count doubles each wave to cap (1 → 2 → 4 → … → 256) — *schedule itself is a tuning target for Fireside (see sprint goals)*
- [x] **Ship laser** — dashed `Line2` / `LineMaterial`; SFX
- [x] **Resources** — 100 pickups (FBX + fallback), tractor beam; HUD count (split label/value, see `#hud-resources-label` / `#hud-resources-value` in `index.html`)
- [x] **Base HP HUD** — label + 25-bar graph + numeric readout (`GameScreen.js` syncs bar segments to `BASE_MAX_HP`)
- [x] **Dock store** — `store.json` drives catalog cards (repair, transmission, three tower SKUs → same `_purchaseTower()` until tiers split); ratio node is omitted when `max` is null/empty; `fetch('./store.json')` at runtime (**include in zip** for embeds). Base armor starts damaged (**5 / 25** max); repair spends resources toward **25**.
- [x] **Defense towers** — purchase at dock, **T** to place; FBX base + weapon; tower lasers + SFX
- [x] **Win / lose** — distress win + transmission win + base destroyed overlay
- [x] **Radar HUD** (position/size in `css/style.css` — `.flow-radar-hud` / `.flow-radar`); direction arrow; target reticle
- [x] **AudioManager** — channel gains; BGM; klaxon vs armor; VO + warp + first-resource sting; `fetch` + XHR fallback for buffers; `localStorage` when embed allows

### Known gaps (carry to Fireside / later)

- [ ] Broader difficulty / economy tuning
- [ ] Spawn presentation (perimeter portals instead of border spawn line)
- [ ] Language selector / `TranslationManager` pipeline is commented out for this build; restore when localizing

---

## Week 2 — Fireside Jam (due Sunday Apr 26, 2026) — IN PROGRESS

*Theme: **Manage** — credits, clarity, and “this is a finished slice,” not only new mechanics.*

Use the **Fireside sprint** section above as the live task list for the limited window. Week 2 backlog below is the longer arc; check items off there only when shipped.

### Combat and building

- [x] Ship weapon; defense towers; resource economy in dock

### Feel

- [x] Baseline SFX + music channel
- [x] Main menu **Start** handoff — dual-canvas planet zoom plus 3D cruiser + warp exit (`MenuScreen.js`, `#menu-intro-canvas`)
- [x] Game over screen
- [x] Credits **content** in Settings system tab (shell + scrollable panel shipped — **required for jam rules**)

---

## Week 3 — GDFG (due Sunday May 3)

*The Double Crisis theme earns its keep.*

## Goal

Increase early-game tension, enforce the double crisis, and improve clarity of combat + resource loops.

---

## 1. Opening Sequence (High Priority)

**Objective:** Start with action, layer explanation after.

- [ ] Ship crash → immediate player control (no delay)

- [ ] Enemies already active when control begins

- [ ] Delay AI messaging until after action starts

- [ ] Trigger resource tutorial only after first pickup

**Target Outcome:**

Player is under pressure within the first 5–10 seconds.

---

## 2. Enforce Double Crisis (High Priority)

**Objective:** Make rebuilding and defense happen simultaneously.

- [x] Base starts partially damaged — session begins at **5 / 25** armor (`BASE_START_HP` / `BASE_MAX_HP`); repair toward max via dock

- [ ] Base slowly degrades over time (light pressure)

- [ ] Maintain low-level enemy trickle after initial clear

- [ ] Place resources slightly outside safe zone

**Target Outcome:**

Player cannot focus on only one problem.

---

## 3. Resource System Adjustment (High Priority)

**Objective:** Prevent rushing the signal tower.

- [ ] Add second resource type

```json
{
  "iron": 0,
  "helion": 0
}
```

### Enemies

- [ ] Creature FBX + spawn holes / emergence read (sprint)
- [ ] Additional archetypes / death VFX (post–Fireside if no time)

### Depth

- [x] Wave escalation — doubling schedule with cap
- [ ] **Double crisis** mechanic
- [x] Transmission array + distress win (extend as needed)
- [ ] Ship upgrade meta between sorties

### World

- [ ] Map events; environmental hazard layer; exploration caches
- [ ] Creature FBX + spawn holes / emergence read (sprint)
- [ ] Additional archetypes / death VFX (post–Fireside if no time)

### Combat and building

- [ ] Additional tower variants

### Feel

- [ ] Screen shake; fog-of-war treatment; wave callouts (game HUD frame + stats layout largely in place)
- [ ] Better Game over screen
- [ ] Enemy spawn VFX/readability pass (optional if testing time is tight)

---

## Week 4 — 100 Day Jam (due May 12)

*The game you always wished you had time for.*

### Meta

- [ ] Roguelite structure; upgrade tree;

### Polish

- [ ] Particles; full audio mix; tuning; enemy/tower read; lore; leaderboard if feasible

---

## Architecture

### Menu title sequence (`MenuScreen.js`, `index.html`, `css/style.css`)

The main menu uses **two stacked canvases** on `#screen-menu`: the **raw GLSL planet** on `#menu-bg-canvas`, and a **transparent WebGL overlay** on `#menu-intro-canvas` (higher `z-index`, `pointer-events: none`) for the cinematic beat when the player hits **Start**.

- **Cruiser** — `assets/obj/SM_Ship_Cruiser_02.fbx` via `FBXLoader`, `OBJ_SCALE`, and the same Polygon atlas Phong pattern as in `GameScreen.js` (textures under `assets/textures/`).
- **Motion** — `_shipIntroPathT`: first **2 s** covers **half** the hand-tuned arc (ease-out); the rest of the **8 s** zoom uses the same **ease-in-out cubic** as planet `uZoomT`. Pose numbers (`x0`, `scale0`, etc.) are edited in `_updateCruiserPose`.
- **Hull fade-in** — **500 ms** opacity ramp using `THREE.MathUtils.smoothstep(elapsed, 0, SHIP_FADEIN_MS)` (first argument is clock time). Intro hull material uses `depthWrite: false` so warp layers stay readable.
- **Warp exit** — Fresnel bubble `ShaderMaterial`, bow torus, flash disc, `THREE.Points` stream, two point lights (tunnel ring stack removed for clarity); strength follows **planet** `zoomT`, not hull opacity, so VFX can precede the ship.
- **Renderer** — Intro `WebGLRenderer` uses **`NoToneMapping`** so additive passes stay bright.

```
index.html                — import map: `three` → ./js/three.module.js; explicit ./js/jsm/... addon paths; optional ./js/browser.js (fflate) if needed; menu stack: `#menu-bg-canvas` + `#menu-intro-canvas`
store.json                — Dock store catalog (items: id, action, name, description, cost, image; optional tower max); loaded by GameScreen
js/
  three.module.js         — Three r169 bundle (keep in sync with js/jsm addon versions)
  jsm/                    — examples modules (FBXLoader, lines, curves, libs/fflate.module.js, …)
  shaders/                — terrain + shared noise
  AudioManager.js
  EnemyManager.js         — Flow field; spawn/update/kill; GLTF spider + mixer; face velocity; one-shot base contact damage
  GameScreen.js           — Scene, loop, ship, weapons, dock store UI, transmission (mast scale + tile visibility), cruiser wreck + smoke, win/lose HUD, base backdrop
  LoadingScreen.js
  MenuScreen.js           — Planet fullscreen shader (`#menu-bg-canvas`); intro 3D pass (`#menu-intro-canvas`): `SM_Ship_Cruiser_02.fbx`, layered warp VFX, start-transition handoff to game
  ResourceManager.js
  ScreenManager.js
  SettingsModal.js        — Audio volumes; header toggles system tab (credits); persist on dismiss; language UI deferred with HTML/TranslationManager hooks commented
  terrain.js
  main.js

assets/
  obj/                    — FBX models
  textures/               — HUD frames, radar, **store** / **modal** / **buy** PNGs, `base_bkgd.png`, logos
  audio/                  — BGM, WAV / MP3 SFX (`warp`/`introCutScene`, VO, `klaxon`, `ironOre`, blasters, pickup, …)
```

### Coordinate system

The ship stays at world `(0, y, 0)`. Terrain, hangar, and transmission mast move opposite the scroll offset (mast uses **`TRANSMISSION_PAD_OFFSET_X`** beside the pad). Enemies and resources use heightmap UV coordinates; each frame:

```
worldX = (uvx - 0.5) * uScale - offset.x
worldZ = -(uvy - 0.5) * uScale + offset.y
```

### Flow field

`EnemyManager` builds **Dijkstra** on a UV grid whose span follows `FLOW_FIELD_AREA_MULT` (currently **4×** unit tile area). Resolution scales with span. Blocked cells: water, steep slope, thin-air height. Enemies sample the field each frame.

---

## Notes

- **Flow:** Loading → Menu → Game. Language selection UI and `TranslationManager` hooks exist but are commented out in `index.html` / `main.js` / related screens until localization is wired again.
- **`store.json`** must ship beside **`index.html`** (same folder in the zip) so `fetch('./store.json')` works on itch and other static hosts.
- Hand-tweaked **game HUD** layout lives in `index.html` (`#game-hud`) and `css/style.css`. See `.cursor/rules/ld59-hud-layout.mdc` for agent guidance when editing those files.
- Movement uses delta time; drag uses `Math.pow(0.35, delta)`; lerps clamp with `Math.min(1, delta * rate)`.
- Menu and game each use their own `THREE.Clock`.
- Keep **`js/three.module.js`** and **`js/jsm/**`** on the **same Three.js revision** (or patch `ColorManagement` API mismatches).
- FBX textures: `setResourcePath('assets/textures/')`; paths inside FBX must exist in the zip for embed hosts.
