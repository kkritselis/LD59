/**
 * ScreenManager
 *
 * Controls which screen is visible. Screens transition with a CSS
 * opacity fade. Only one screen is active at a time.
 *
 * Screen IDs: 'loading' | 'menu' | 'game'
 */

const SCREEN_IDS = {
  loading: 'screen-loading',
  menu:    'screen-menu',
  game:    'screen-game',
};

const FADE_DURATION_MS = 500;

export class ScreenManager {
  constructor() {
    this.screens = {};
    this.current = null;

    for (const [key, id] of Object.entries(SCREEN_IDS)) {
      const el = document.getElementById(id);
      if (!el) console.warn(`[ScreenManager] Element #${id} not found.`);
      this.screens[key] = el;
    }
  }

  /**
   * Fades out the current screen and fades in the target screen.
   * Returns a Promise that resolves once the transition completes.
   */
  async show(name) {
    if (!this.screens[name]) {
      console.warn(`[ScreenManager] Unknown screen: "${name}"`);
      return;
    }

    if (this.current === name) return;

    // Fade out old screen
    const outgoing = this.current ? this.screens[this.current] : null;
    if (outgoing) {
      outgoing.classList.add('fading-out');
      outgoing.classList.remove('active');
    }

    await this._delay(FADE_DURATION_MS);

    if (outgoing) {
      outgoing.classList.remove('fading-out');
    }

    // Fade in new screen
    const incoming = this.screens[name];
    incoming.classList.add('active');
    this.current = name;
  }

  /** Returns the name of the currently active screen. */
  getCurrent() {
    return this.current;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
