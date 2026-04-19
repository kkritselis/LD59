# LD59# Signal's Edge
### *They came from every direction. You came from somewhere worse.*

A top-down survival defense game where you balance base protection, resource gathering, and signal integrity on a hostile alien world. After crash landing, you must expand outward under constant pressure, harvesting materials to construct and stabilize a transmission tower while escalating alien waves force you to choose between defense, exploration, and getting a signal out before everything collapses.

**Engine:** Three.js (HTML5)  
**Submitted to:** Ludum Dare 59 · Fireside Jam · GDFG · 100 Day Jam

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

## Week 1 — Ludum Dare (Due Sunday Apr 19)
*Does it feel like a game? Ugly is fine. Submit it.*

### Core
- [x] Three.js scene with procedural terrain
- [x] Ship model loaded and placed
- [x] Delta-time corrected game loop
- [x] WASD / arrow key flight controls
- [x] Ship banking and pitch on movement
- [x] Autopilot takeoff and landing sequence
- [x] Hangar / base model placed at terrain origin
- [x] Geological cross-section view
- [x] Sky shader with alien atmosphere
- [x] Menu screen with title and start button
- [x] Screen manager (Menu → Game → Settings)
- [x] Audio manager (volume control scaffolding)

### Still Needed This Weekend
- [ ] Enemy spawning — cones/placeholder meshes at radius around base
- [ ] Enemy movement — move toward hangar each frame
- [ ] Base health — integer value, decrements on enemy contact
- [ ] Game over state — stop loop, show "YOU DIED" overlay
- [ ] Wave timer — spawn enemies on interval, increase rate over time
- [ ] HUD overlay — base HP bar, wave counter (HTML divs, not Three.js)
- [ ] One placeable turret — click terrain to place, shoots nearest enemy
- [ ] Win condition — survive N waves

---

## Week 2 — Fireside Jam (Due Sunday Apr 26)
*Someone else could pick it up and understand it.*

### Enemies
- [ ] Load alien FBX — replace placeholder cones
- [ ] Two additional enemy types (fast/fragile, slow/tanky)
- [ ] Enemy death effect (particle burst or flash)

### Combat & Building
- [ ] Ship weapon — fires projectile toward cursor
- [ ] Two additional turret types (area, long range)
- [ ] Resource node — collectible pickups scattered on terrain
- [ ] Resource currency — spend to place turrets

### Feel
- [ ] Sound effects (weapon fire, explosion, turret shot)
- [ ] Screen shake on base hit
- [ ] Fog of war / unexplored terrain darkening
- [ ] UI polish — styled HUD, readable fonts, wave announcement

---

## Week 3 — GDFG (Due Sunday May 3)
*The Double Crisis theme earns its keep.*

### Depth
- [ ] Wave escalation curve — faster, more enemies over time
- [ ] Boss wave — large enemy, telegraphed arrival
- [ ] Double crisis mechanic — two spawn points on opposite sides of map activate simultaneously
- [ ] Signal tower — core structure to build and protect, win condition tied to it
- [ ] Ship upgrade system — Vampire Survivors style level-up pick on XP threshold

### World
- [ ] Map events — signal anomalies that trigger when investigated
- [ ] Environmental hazard — storm, terrain damage, or visibility disruption
- [ ] Exploration reward — resource caches hidden in fog of war

---

## Week 4 — 100 Day Jam (Due May 12)
*The game you always wished you had time for.*

### Meta
- [ ] Roguelite run structure — fresh start each run, persistent unlocks
- [ ] Persistent upgrade tree — unlocks carry between runs
- [ ] Multiple ship types with different stats

### Polish
- [ ] Full particle system — explosions, resource collection, thruster trails
- [ ] Music — ambient alien atmosphere track
- [ ] Full sound design pass
- [ ] Difficulty tuning from playtesting
- [ ] Enemy variety pass — visual distinction between all types
- [ ] Lore / codex entries discovered through exploration
- [ ] Leaderboard or score screen

---

## Architecture

```
js/
  shaders/
    noise.js              — GLSL noise functions (shared)
    terrain.vert.js       — Terrain vertex shader
    terrain.frag.js       — Terrain fragment shader
  AudioManager.js         — Volume control for BGM / SFX / music
  GameScreen.js           — Scene, camera, renderer, game loop (main)
  LoadingScreen.js        — Asset preload screen
  MenuScreen.js           — Title screen with background renderer
  ScreenManager.js        — Routes between screens
  SettingsModal.js        — Settings overlay

assets/
  obj/                    — FBX models (Synty Sci-Fi pack)
  textures/               — Atlas textures, terrain channels
  audio/                  — BGM and SFX
```

### Coordinate System
The ship is always at world `(0, y, 0)`. The terrain and hangar slide in the opposite direction of the offset to create the illusion of movement. Enemies live in world space and move toward the hangar position each frame — which is always at `(-offset.x, platformY, offset.y)`.

---

## Notes
- All movement is delta-time corrected — behavior is frame-rate independent
- Drag uses `Math.pow(0.35, delta)` — exponential form keeps half-life constant regardless of FPS
- Lerps use `Math.min(1, delta * rate)` — clamps at 1 so frame spikes can't overshoot
- Menu and Game renderers use isolated `THREE.Clock` instances — neither affects the other's timing