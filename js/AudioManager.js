/**
 * AudioManager
 *
 * Manages a Web Audio API context with four independent gain channels:
 *   master -> sfx
 *          -> music
 *          -> ambient
 *
 * All channel volumes are persisted in localStorage and restored on init.
 */

const STORAGE_KEY = 'ld59_audio_settings';

const DEFAULTS = {
  master:  0.8,
  sfx:     1.0,
  music:   0.7,
  ambient: 0.6,
};

export class AudioManager {
  constructor() {
    this.context = null;
    this.nodes = {};
    this.settings = this._loadSettings();
    this._initialized = false;
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
    console.log('[AudioManager] Initialized.');
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

  /** Persists all current settings to localStorage. */
  saveSettings() {
    try {
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
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[AudioManager] Could not load settings:', e);
    }
    return { ...DEFAULTS };
  }
}
