/**
 * AudioManager
 *
 * Manages a Web Audio API context with four independent gain channels:
 *   master -> sfx
 *          -> music
 *          -> ambient
 *
 * Volume settings persist via localStorage when allowed (Ludum Dare embeds
 * often disable storage — reads/writes are wrapped so the game still runs).
 * Audio files load from the same zip origin via fetch(), with an XHR fallback
 * only if fetch fails (some restricted contexts differ).
 */

const STORAGE_KEY = 'ld59_audio_settings';

const DEFAULTS = {
  master:  0.8,
  sfx:     1.0,
  music:   0.7,
  ambient: 0.6,
};

const GAME_AUDIO = {
  background:  'assets/audio/background.mp3',
  resource:    'assets/audio/resource.wav',
  blasterShip: 'assets/audio/Blaster_ship.wav',
  blasterTower: 'assets/audio/Blaster_tower.wav',
};

export class AudioManager {
  constructor() {
    this.context = null;
    this.nodes = {};
    this.settings = this._loadSettings();
    this._initialized = false;

    /** @type {Record<string, AudioBuffer> | null} */
    this._buffers = null;
    this._buffersReady = false;
    this._pendingBgStart = false;
    /** @type {AudioBufferSourceNode | null} */
    this._bgSource = null;
  }

  /**
   * Must be called from a user gesture to satisfy browser autoplay policy.
   */
  init() {
    if (this._initialized) return;

    this.context = new (window.AudioContext || window.webkitAudioContext)();

    // Build gain node graph: channels -> master -> destination
    this.nodes.master  = this._makeGain(this.settings.master);
    this.nodes.sfx     = this._makeGain(this.settings.sfx);
    this.nodes.music   = this._makeGain(this.settings.music);
    this.nodes.ambient = this._makeGain(this.settings.ambient);

    this.nodes.sfx.connect(this.nodes.master);
    this.nodes.music.connect(this.nodes.master);
    this.nodes.ambient.connect(this.nodes.master);
    this.nodes.master.connect(this.context.destination);

    this._initialized = true;
    this._loadGameBuffers();
    console.log('[AudioManager] Initialized.');
  }

  /** Looping gameplay bed (music channel). */
  startBackgroundLoop() {
    if (!this._initialized) return;
    if (!this._buffersReady) {
      this._pendingBgStart = true;
      return;
    }
    this.stopBackgroundLoop();
    const buf = this._buffers.background;
    if (!buf) return;
    const src = this.context.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.nodes.music);
    try {
      src.start(0);
    } catch (e) {
      console.warn('[AudioManager] Background start failed:', e);
      return;
    }
    this._bgSource = src;
  }

  stopBackgroundLoop() {
    this._pendingBgStart = false;
    if (!this._bgSource) return;
    try {
      this._bgSource.stop();
    } catch (_) { /* already stopped */ }
    try {
      this._bgSource.disconnect();
    } catch (_) { /* */ }
    this._bgSource = null;
  }

  playResourcePickup() {
    this._playOneShot('resource', 'sfx', 0.55);
  }

  playBlasterShip() {
    this._playOneShot('blasterShip', 'sfx', 0.45);
  }

  playBlasterTower() {
    this._playOneShot('blasterTower', 'sfx', 0.4);
  }

  /** Returns the current 0-1 gain value for a channel. */
  getVolume(channel) {
    return this.settings[channel] ?? DEFAULTS[channel];
  }

  /** Sets a channel's gain and persists the change. */
  setVolume(channel, value) {
    const num = parseFloat(value);
    if (!isFinite(num)) return;
    const clamped = Math.max(0, Math.min(1, num));
    this.settings[channel] = clamped;

    if (this._initialized && this.nodes[channel]) {
      this.nodes[channel].gain.setTargetAtTime(
        clamped,
        this.context.currentTime,
        0.02
      );
    }
  }

  /** Persists all current settings to localStorage when the embed allows it. */
  saveSettings() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn('[AudioManager] Could not save settings:', e);
    }
  }

  /**
   * Returns the input GainNode for a channel so audio sources
   * can connect directly to it.
   *
   *   const src = audioManager.context.createBufferSource();
   *   src.connect(audioManager.getChannelNode('sfx'));
   *   src.start();
   */
  getChannelNode(channel) {
    return this.nodes[channel] ?? null;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  _makeGain(value) {
    const node = this.context.createGain();
    node.gain.value = value;
    return node;
  }

  _loadSettings() {
    try {
      if (typeof localStorage === 'undefined') return { ...DEFAULTS };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[AudioManager] Could not load settings:', e);
    }
    return { ...DEFAULTS };
  }

  /** Load binary from the game package (same origin as index.html). */
  async _loadArrayBufferSameOrigin(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
            resolve(xhr.response);
          } else {
            reject(new Error(`${url} HTTP ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(err);
        xhr.send();
      });
    }
  }

  async _loadGameBuffers() {
    if (!this._initialized || !this.context) return;
    const out = {};
    try {
      for (const [key, url] of Object.entries(GAME_AUDIO)) {
        const ab = await this._loadArrayBufferSameOrigin(url);
        out[key] = await this.context.decodeAudioData(ab.slice(0));
      }
      this._buffers = out;
      this._buffersReady = true;
      if (this._pendingBgStart) {
        this._pendingBgStart = false;
        this.startBackgroundLoop();
      }
    } catch (e) {
      console.warn('[AudioManager] Game audio decode failed:', e);
    }
  }

  /**
   * @param {string} key  buffer key in GAME_AUDIO
   * @param {'sfx'|'music'|'ambient'} channel
   * @param {number} gainLinear
   */
  _playOneShot(key, channel, gainLinear) {
    if (!this._initialized || !this._buffersReady || !this._buffers[key]) return;
    const bus = this.nodes[channel];
    if (!bus) return;
    const buf = this._buffers[key];
    const src = this.context.createBufferSource();
    src.buffer = buf;
    const g = this.context.createGain();
    g.gain.value = gainLinear;
    src.connect(g);
    g.connect(bus);
    const end = () => {
      try { src.disconnect(); } catch (_) { /* */ }
      try { g.disconnect(); } catch (_) { /* */ }
    };
    src.onended = end;
    try {
      src.start(0);
    } catch (e) {
      console.warn('[AudioManager] One-shot failed:', key, e);
      end();
    }
  }
}
