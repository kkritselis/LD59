# LD59 — Signal's Edge
### *They came from every direction. You came from somewhere worse.*

A top-down survival defense game where you balance base protection, resource gathering, and signal integrity on a hostile alien world. After crash landing, you must expand outward under constant pressure, harvesting materials to construct and stabilize a transmission array while escalating alien waves force you to choose between defense, exploration, and getting a distress signal out before everything collapses.

**Engine:** Three.js (HTML5), ES modules  
**Jam track:** Ludum Dare 59 · **Fireside Jam** · GDFG · 100 Day Jam  

**Ludum Dare 59 (Apr 17–19, 2026):** **complete** — first milestone shipped (LD / embed / local package).

**Fireside Jam (Apr 17–26, 2026, theme: Manage):** **in progress** — second weekend of the multi-jam experiment. Jam deadline is tight; personal schedule limits this sprint to a **single concentrated work block (~12–14 hours)** before travel (San Antonio). Optimize for shippable deltas: credits compliance, clearer presentation, stronger early-game feel, and one solid enemy visual pass.

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

- [ ] **Credits (Fireside requirement)** — full attribution for code, libraries, fonts, Synty (or other) asset packs, any CC models, sounds, and tools. **Settings UI:** add a dedicated **Credits** tab/section (alongside audio controls) so judges and players can find it without hunting a separate file.
- [ ] **Enemy creature FBX** — replace shared **torus-knot** placeholder with the new enemy model; match scale/orientation to terrain; keep flow-field movement + cleanup paths sound.
- [ ] **Wave pacing** — address LD feedback: **first waves felt too slow**. Tune `_waveTimer` / first-wave delay / initial counts so action ramps sooner without instant overwhelm (see `GameScreen.js` wave block).
- [ ] **Spawn presentation** — stop enemies **materializing in a long line on the UV border**; add **spawn holes / surface portals** (mesh + short emerge animation or staged visibility) so spawns read as “emerging from the ground” at a small set of perimeter points.
- [ ] **UI pass** — wire **new texture art** under `assets/textures/` (modal frames, settings chrome, buttons on/off states, `system_modal.png`, etc.) into `index.html` / `css/style.css` / modals as designed. Note: `frame_bottom_rigft.png` looks like a filename typo (`right`) — fix when referencing to avoid 404s.
- [ ] **Audio “attention” pass** — once clips exist: stronger sting for wave start / tension; **attack / impact SFX** when enemies **damage the base** or **pressure a tower** (distinct from generic ambience). *Asset discovery TBD; reserve hooks in `AudioManager` / game loop.*

### Ship / ops (non-code or parallel)

- [ ] **itch.io** — create/update the Fireside Jam game page, screenshots, short description, credits mirror, and upload the same zip build you use for the jam.
- [ ] **Playtest pass** — 10–15 minutes after changes: embed rules (no external `fetch` to third parties), storage off in iframe, and **zip root `index.html`**.

### Already true in repo (do not duplicate work)

- [x] Dock **manage** loop — spend resources on repair, tower, transmission increments, weapon tier; distress win when funded.
- [x] **Local Three** — `index.html` import map → `./js/three.module.js` + explicit `./js/jsm/...` paths; `FBXLoader` patched for r169 `ColorManagement.toWorkingColorSpace` API.
- [x] **Core SFX pipeline** — `AudioManager` already plays pickup, ship blaster, tower blaster, BGM after Begin; new sounds plug into the same pattern.
- [x] **100 resource nodes**, expanded flow field (`FLOW_FIELD_AREA_MULT`), radar (**F**), transmission + towers + win overlay (from LD weekend).

---

## Week 1 — Ludum Dare 59 (Apr 17–19, 2026) — COMPLETE

*Goal: does it feel like a game? Ship something playable.*

### Core loop (all in the LD59 build)

- [x] Three.js scene with procedural terrain (shader heightmap + CPU mirror in `terrain.js`)
- [x] Ship, hangar, transmission mast, defense tower pieces, resource pickups — FBX (`FBXLoader`, local `js/jsm` + `js/three.module.js`)
- [x] Delta-time game loop; screen flow Loading → Menu → Game; settings modal
- [x] WASD / arrow flight; ship banking and pitch; autopilot takeoff / landing; snap-to-pad when near base
- [x] Geological cross-section; sky shader; menu with procedural background; intro briefing modal (“Begin”)
- [x] **Enemies** — shared **`TorusKnotGeometry`** placeholder (maroon, tumbling); flow-field border spawn; Dijkstra movement; base damage on contact; culled past terrain tile
- [x] **Waves** — ~**60 s** timer, count doubles each wave to cap (1 → 2 → 4 → … → 256) — *schedule itself is a tuning target for Fireside (see sprint goals)*
- [x] **Ship laser** — dashed `Line2` / `LineMaterial`; SFX
- [x] **Resources** — 100 pickups (FBX + fallback), tractor beam; HUD count
- [x] **Dock shop** — repair, tower, transmission funding, weapon upgrade, distress when array complete
- [x] **Defense towers** — purchase at dock, **T** to place; FBX base + weapon; tower lasers + SFX
- [x] **Win** — distress flow + overlay
- [x] **Radar HUD**; direction arrow; target reticle
- [x] **AudioManager** — channel gains; BGM; `fetch` + XHR fallback for buffers; `localStorage` when embed allows

### Known gaps (carry to Fireside / later)

- [ ] Full **game over** screen when base HP hits 0
- [ ] Broader difficulty / economy tuning

---

## Week 2 — Fireside Jam (due Sunday Apr 26, 2026) — IN PROGRESS

*Theme: **Manage** — credits, clarity, and “this is a finished slice,” not only new mechanics.*

Use the **Fireside sprint** section above as the live task list for the limited window. Week 2 backlog below is the longer arc; check items off there only when shipped.

### Enemies

- [ ] Creature FBX + spawn holes / emergence read (sprint)
- [ ] Additional archetypes / death VFX (post–Fireside if no time)

### Combat and building

- [x] Ship weapon; defense towers; resource economy in dock
- [ ] Additional tower variants

### Feel

- [x] Baseline SFX + music channel
- [ ] Screen shake; fog-of-war treatment; HUD / wave callouts
- [ ] Game over screen
- [ ] Credits surface in UI (sprint — **required for jam rules**)

---

## Week 3 — GDFG (due Sunday May 3)

*The Double Crisis theme earns its keep.*

### Depth

- [x] Wave escalation — doubling schedule with cap
- [ ] **Double crisis** mechanic
- [x] Transmission array + distress win (extend as needed)
- [ ] Ship upgrade meta between sorties

### World

- [ ] Map events; environmental hazard layer; exploration caches

---

## Week 4 — 100 Day Jam (due May 12)

*The game you always wished you had time for.*

### Meta

- [ ] Roguelite structure; upgrade tree;

### Polish

- [ ] Particles; full audio mix; tuning; enemy/tower read; lore; leaderboard if feasible

---

## Architecture

```
index.html                — import map: `three` → ./js/three.module.js; explicit ./js/jsm/... addon paths; optional ./js/browser.js (fflate) if needed
js/
  three.module.js         — Three r169 bundle (keep in sync with js/jsm addon versions)
  jsm/                    — examples modules (FBXLoader, lines, curves, libs/fflate.module.js, …)
  shaders/                — terrain + shared noise
  AudioManager.js
  EnemyManager.js         — Flow field, spawn, update, kill; shared enemy geometry + material
  GameScreen.js           — Scene, loop, ship, weapons, dock, transmission, win, HUD
  LoadingScreen.js
  MenuScreen.js
  ResourceManager.js
  ScreenManager.js
  SettingsModal.js        — Audio + (planned) Credits tab
  terrain.js
  main.js

assets/
  obj/                    — FBX models
  textures/               — Atlases, HUD, **new modal/frame PNGs** (integrate in UI pass)
  audio/                  — BGM and WAV SFX (+ room for new stings / attack cues)
```

### Coordinate system

The ship stays at world `(0, y, 0)`. Terrain and hangar move opposite the scroll offset. Enemies and resources use heightmap UV coordinates; each frame:

```
worldX = (uvx - 0.5) * uScale - offset.x
worldZ = -(uvy - 0.5) * uScale + offset.y
```

### Flow field

`EnemyManager` builds **Dijkstra** on a UV grid whose span follows `FLOW_FIELD_AREA_MULT` (currently **4×** unit tile area). Resolution scales with span. Blocked cells: water, steep slope, thin-air height. Enemies sample the field each frame.

---

## Notes

- Movement uses delta time; drag uses `Math.pow(0.35, delta)`; lerps clamp with `Math.min(1, delta * rate)`.
- Menu and game each use their own `THREE.Clock`.
- Keep **`js/three.module.js`** and **`js/jsm/**`** on the **same Three.js revision** (or patch `ColorManagement` API mismatches).
- FBX textures: `setResourcePath('assets/textures/')`; paths inside FBX must exist in the zip for embed hosts.
