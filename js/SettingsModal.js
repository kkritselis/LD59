/**
 * SettingsModal
 *
 * Controls the settings modal overlay. Works with AudioManager to
 * read and write volume levels. Sliders apply live; closing the modal
 * (X, overlay, Escape) persists levels via `saveSettings()`.
 *
 * Usage:
 *   const settings = new SettingsModal(audioManager);
 *   settings.open();
 */

const CHANNELS = ['master', 'sfx', 'music', 'ambient'];

export class SettingsModal {
  constructor(audioManager) {
    this.audio = audioManager;
    /** @type {null | (() => void | Promise<void>)} */
    this._onAbandonRun = null;

    this._overlay  = document.getElementById('settings-modal');
    this._dialog   = document.getElementById('settings-modal-dialog');
    this._sliders  = {};

    this._cacheElements();
    this._bindSliders();
    this._bindButtons();
    this._bindHeaderTabToggle();
    this._bindOverlayClick();
    this._bindEscapeKey();
    this._syncAbandonButton();
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  open() {
    this._setSystemTab(false);
    this._syncSlidersFromAudio();
    this._syncAbandonButton();
    this._overlay.classList.remove('hidden');
    document.getElementById('btn-close-settings')?.focus();
  }

  /** While a run is active, wire this so "Abandon run" returns to the menu. Pass null to disable. */
  setAbandonHandler(fn) {
    this._onAbandonRun = typeof fn === 'function' ? fn : null;
    this._syncAbandonButton();
  }

  close() {
    // Move focus out before hiding so no focused descendant ends up inside
    // a display:none element (avoids the aria-hidden + focused child warning).
    if (this._overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    this._overlay.classList.add('hidden');
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  _cacheElements() {
    for (const ch of CHANNELS) {
      this._sliders[ch] = document.getElementById(`slider-${ch}`);
    }
  }

  _bindSliders() {
    for (const ch of CHANNELS) {
      const slider = this._sliders[ch];
      if (!slider) continue;

      slider.addEventListener('input', () => {
        const value = parseInt(slider.value, 10);
        // Apply live so the user can hear changes immediately
        this.audio.setVolume(ch, value / 100);
      });
    }
  }

  _bindButtons() {
    const closeBtn = document.getElementById('btn-close-settings');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._dismissAndPersist();
    });

    document.getElementById('btn-abandon-run')?.addEventListener('click', async () => {
      if (!this._onAbandonRun) return;
      this.audio.saveSettings();
      this._closeWithoutRevert();
      const fn = this._onAbandonRun;
      await fn();
    });
  }

  _dismissAndPersist() {
    this.audio.saveSettings();
    this.close();
  }

  _bindHeaderTabToggle() {
    const header = document.getElementById('settings-modal-header');
    if (!header) return;
    header.addEventListener('click', (e) => {
      if (e.target.closest('#btn-close-settings')) return;
      this._toggleSettingsTab();
    });
  }

  _isSystemTab() {
    return Boolean(this._dialog?.classList.contains('settings-modal-dialog--system'));
  }

  /** @param {boolean} system true = system / credits panel */
  _setSystemTab(system) {
    this._dialog?.classList.toggle('settings-modal-dialog--system', system);
    const audioBody = this._overlay?.querySelector('.settings-modal-body');
    const infoBody  = this._overlay?.querySelector('.info-modal-body');
    if (audioBody) audioBody.setAttribute('aria-hidden', system ? 'true' : 'false');
    if (infoBody)  infoBody.setAttribute('aria-hidden', system ? 'false' : 'true');
  }

  _toggleSettingsTab() {
    this._setSystemTab(!this._isSystemTab());
  }

  _syncAbandonButton() {
    const btn = document.getElementById('btn-abandon-run');
    if (!btn) return;
    const on = Boolean(this._onAbandonRun);
    btn.disabled = !on;
    btn.classList.toggle('hidden', !on);
  }

  /** Hide overlay after volumes were already saved (e.g. abandon run). */
  _closeWithoutRevert() {
    if (this._overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    this._overlay.classList.add('hidden');
  }

  _bindOverlayClick() {
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) this._dismissAndPersist();
    });
  }

  _bindEscapeKey() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this._overlay.classList.contains('hidden')) {
        this._dismissAndPersist();
      }
    });
  }

  _syncSlidersFromAudio() {
    for (const ch of CHANNELS) {
      const value = Math.round(this.audio.getVolume(ch) * 100);
      if (this._sliders[ch]) this._sliders[ch].value = value;
    }
  }

}
