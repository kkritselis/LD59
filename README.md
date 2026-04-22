# LD59 — Signal's Edge
### *They came from every direction. You came from somewhere worse.*

A top-down survival defense game where you balance base protection, resource gathering, and signal integrity on a hostile alien world. After crash landing, you must expand outward under constant pressure, harvesting materials to construct and stabilize a transmission array while escalating alien waves force you to choose between defense, exploration, and getting a distress signal out before everything collapses.

**Engine:** Three.js (HTML5), ES modules  
**Jam track:** Ludum Dare 59 · Fireside Jam · GDFG · 100 Day Jam  

**Ludum Dare 59 build weekend:** April 17–19, 2026 — **complete** (first milestone shipped to itch / LD hosting as applicable).

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

## Week 1 — Ludum Dare 59 (Apr 17–19, 2026) — COMPLETE

*Goal: does it feel like a game? Ship something playable.*

### Core loop (all in the LD59 build)

- [x] Three.js scene with procedural terrain (shader heightmap + CPU mirror in `terrain.js`)
- [x] Ship, hangar, transmission mast, defense tower pieces, resource pickups — FBX from Synty-style assets (`FBXLoader`, local `js/jsm` + `js/three.module.js` via import map in `index.html`)
- [x] Delta-time game loop; screen flow Loading → Menu → Game; settings modal
- [x] WASD / arrow flight; ship banking and pitch; autopilot takeoff / landing; snap-to-pad when near base
- [x] Geological cross-section; sky shader; menu with procedural background; intro briefing modal (“Begin”)
- [x] **Enemies** — shared `TorusKnotGeometry` mesh (maroon material, tumbling rotation), spawned on expanded flow-field border; movement via Dijkstra flow field toward base; base HP damage on contact; hidden when scrolled past terrain tile
- [x] **Waves** — timer (~60s), count doubles each wave up to cap (1 → 2 → 4 → … → 256)
- [x] **Ship laser** — dashed `Line2` / `LineMaterial` toward nearest enemy in range; SFX hooks
- [x] **Resources** — 100 pickup nodes (FBX + fallback), tractor beam when in range; HUD resource count
- [x] **Dock shop** — opens when landed on pad (after first departure); repair, defense tower purchase, transmission funding, weapon tier upgrade, distress call when array is fully funded
- [x] **Defense towers** — purchase at dock, place with **T** in flight (FBX base + weapon when templates load); tower lasers and SFX
- [x] **Win** — fund transmission to goal, send distress from dock; win overlay
- [x] **Radar HUD** — optional flow-field canvas overlay (**F**); enemy dots, ship, base markers
- [x] Direction arrow and target reticle above terrain
- [x] **AudioManager** — master / SFX / music / ambient gains; BGM loop after Begin; decode via `fetch` with XHR fallback; `localStorage` for settings when allowed (embed sandboxes may block storage)

### Known gaps (nice-to-have, not blocking LD59)

- [ ] Full **game over** presentation when base HP reaches 0 (currently stops / logs; no dedicated overlay)
- [ ] Further difficulty and economy tuning from playtests

---

## Week 2 — Fireside Jam (due Sunday Apr 26)

*Someone else could pick it up and understand it.*

### Enemies

- [ ] Optional alien creature FBX again (currently torus-knot placeholder reads well and avoids asset/version drift)
- [ ] Additional enemy archetypes (fast / tanky) with distinct silhouettes
- [ ] Death VFX (burst, dissolve, or flash)

### Combat and building

- [x] Ship weapon — autofire laser (see Week 1)
- [x] Defense tower — purchasable, placeable, fires on enemies
- [ ] Additional tower variants (area denial, long range)
- [x] Resources as currency — spent in dock (repair, tower, transmission segments, weapon upgrade)

### Feel

- [x] Core SFX — pickup, ship blaster, tower blaster; ambient / music channels exist
- [ ] Screen shake on base hit
- [ ] Fog of war / unexplored terrain treatment
- [ ] HUD polish — wave callouts, clearer onboarding strings
- [ ] Game over screen (paired with gap above)

---

## Week 3 — GDFG (due Sunday May 3)

*The Double Crisis theme earns its keep.*

### Depth

- [x] Wave escalation — doubling schedule with cap (see Week 1)
- [ ] Boss or set-piece wave
- [ ] **Double crisis** mechanic — two simultaneous pressure sources on opposite sides of the map
- [x] Transmission array — staged funding + distress win (extend with more drama / failure states if desired)
- [ ] Ship upgrade pick-ups or meta progression between sorties

### World

- [ ] Map events — anomalies, escorts, or timed hazards
- [ ] Environmental hazard — storm, visibility, or terrain damage layer
- [ ] Exploration rewards — caches tied to riskier terrain or flow-field corners

---

## Week 4 — 100 Day Jam (due May 12)

*The game you always wished you had time for.*

### Meta

- [ ] Roguelite run structure with persistent unlocks
- [ ] Upgrade tree across runs
- [ ] Multiple ships / loadouts

### Polish

- [ ] Particle pass — impacts, thrusters, collection sparkle
- [ ] Full music / ambience bed and mix pass
- [ ] Difficulty and UX tuning from wider playtests
- [ ] Enemy and tower read hierarchy at a glance
- [ ] Lore or log entries
- [ ] Score / time leaderboard if scope allows

---

## Architecture

```
index.html                — import map: `three` → ./js/three.module.js; explicit ./js/jsm/... addon paths; optional ./js/browser.js (fflate) if needed
js/
  three.module.js         — Three r169 bundle (keep in sync with js/jsm addon versions)
  jsm/                    — examples modules (FBXLoader, lines, curves, libs/fflate.module.js, …)
  shaders/
    noise.js              — GLSL noise (shared)
    terrain.vert.js       — Terrain vertex shader
    terrain.frag.js       — Terrain fragment shader
  AudioManager.js         — Web Audio graph, buffers, settings persistence
  EnemyManager.js         — Flow field, spawn, update, kill; shared enemy geometry + material
  GameScreen.js           — Scene, loop, ship, weapons, dock, transmission, win, HUD wiring
  LoadingScreen.js        — Boot bar (simulated steps)
  MenuScreen.js           — Title + procedural background
  ResourceManager.js      — Scatter, tractor beam, collection
  ScreenManager.js        — Screen fades
  SettingsModal.js        — Audio sliders; abandon run when in game
  terrain.js              — CPU heightmap (mirrors shader; flow + placement)
  main.js                 — Bootstrap

assets/
  obj/                    — FBX models
  textures/               — Atlases, SVG HUD art, terrain channels
  audio/                  — BGM and WAV SFX
```

### Coordinate system

The ship stays at world `(0, y, 0)`. Terrain and hangar move opposite the scroll offset. Enemies and resources use heightmap UV coordinates; each frame:

```
worldX = (uvx - 0.5) * uScale - offset.x
worldZ = -(uvy - 0.5) * uScale + offset.y
```

### Flow field

`EnemyManager` builds a **Dijkstra** field on a square UV grid whose span is controlled by `FLOW_FIELD_AREA_MULT` (currently **4×** the unit tile’s area, so each axis spans `sqrt(4)` around `0.5`). Grid resolution scales with that span so cell size stays in the same ballpark as the original 96×96 on a 1×1 tile. Each cell stores direction toward base, speed factor, and blocked flags for water, excessive slope, and high-altitude “thin air” cells. Enemies only **sample** the field each frame (no per-agent A* ).

---

## Notes

- Movement uses delta time; drag uses `Math.pow(0.35, delta)`; lerps clamp with `Math.min(1, delta * rate)`.
- Menu and game each use their own `THREE.Clock` so timing stays isolated.
- Keep **`js/three.module.js`** and **`js/jsm/**`** on the **same Three.js revision** (or patch APIs like `ColorManagement.toWorkingColorSpace` vs `colorSpaceToWorking` when mixing versions).
- FBX textures resolve with `setResourcePath('assets/textures/')`; embedded paths inside FBX must still exist under the zip layout for hosting (e.g. Ludum Dare embed).
