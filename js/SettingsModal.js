/**
 * SettingsModal
 *
 * Controls the settings modal overlay. Works with AudioManager to
 * read and write volume levels. Supports a pending-changes pattern:
 * changes are applied live for preview but only committed on Save.
 * Cancel restores the previous state.
 *
 * Usage:
 *   const settings = new SettingsModal(audioManager);
 *   settings.open();
 */

const CHANNELS = ['master', 'sfx', 'music', 'ambient'];

export class SettingsModal {
  constructor(audioManager) {
    this.audio = audioManager;

    this._overlay  = document.getElementById('settings-modal');
    this._sliders  = {};
    this._readouts = {};
    // Pre-populate with current audio values so revert is always safe,
    // even if close() is somehow called before open() ever runs.
    this._snapshot = this._captureCurrentVolumes();

    this._cacheElements();
    this._bindSliders();
    this._bindButtons();
    this._bindOverlayClick();
    this._bindEscapeKey();
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  open() {
    this._snapshot = this._captureCurrentVolumes();
    this._syncSlidersFromAudio();
    this._overlay.classList.remove('hidden');
    document.getElementById('btn-close-settings')?.focus();
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
      this._sliders[ch]  = document.getElementById(`slider-${ch}`);
      this._readouts[ch] = document.getElementById(`readout-${ch}`);
    }
  }

  _bindSliders() {
    for (const ch of CHANNELS) {
      const slider = this._sliders[ch];
      if (!slider) continue;

      slider.addEventListener('input', () => {
        const value = parseInt(slider.value, 10);
        this._updateReadout(ch, value);
        // Apply live so the user can hear changes immediately
        this.audio.setVolume(ch, value / 100);
      });
    }
  }

  _bindButtons() {
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this._revertToSnapshot();
      this.close();
    });

    document.getElementById('btn-cancel-settings')?.addEventListener('click', () => {
      this._revertToSnapshot();
      this.close();
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      this.audio.saveSettings();
      this.close();
    });
  }

  _bindOverlayClick() {
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) {
        this._revertToSnapshot();
        this.close();
      }
    });
  }

  _bindEscapeKey() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this._overlay.classList.contains('hidden')) {
        this._revertToSnapshot();
        this.close();
      }
    });
  }

  _syncSlidersFromAudio() {
    for (const ch of CHANNELS) {
      const value = Math.round(this.audio.getVolume(ch) * 100);
      if (this._sliders[ch])  this._sliders[ch].value = value;
      this._updateReadout(ch, value);
    }
  }

  _updateReadout(channel, intValue) {
    if (this._readouts[channel]) {
      this._readouts[channel].textContent = `${intValue}%`;
    }
  }

  _captureCurrentVolumes() {
    const snap = {};
    for (const ch of CHANNELS) {
      snap[ch] = this.audio.getVolume(ch);
    }
    return snap;
  }

  _revertToSnapshot() {
    for (const ch of CHANNELS) {
      this.audio.setVolume(ch, this._snapshot[ch]);
    }
  }
}
