/**
 * LoadingScreen
 *
 * Drives the loading progress bar and status label.
 * Call run() to simulate or drive real asset loading,
 * then promptLanguage() to gate the transition on a language selection.
 */

export class LoadingScreen {
  constructor() {
    this.bar   = document.getElementById('loading-bar-fill');
    this.label = document.getElementById('loading-label');
    this._progress = 0;

    // LANGUAGE SELECTOR:
    // this._langOverlay  = document.getElementById('language-modal');
    // this._langSelect   = document.getElementById('language-select');
    // this._langContinue = document.getElementById('btn-language-continue');
  }

  /**
   * Sets progress from 0 to 100 and updates the status label.
   */
  setProgress(value, message = '') {
    this._progress = Math.max(0, Math.min(100, value));
    this.bar.style.width = `${this._progress}%`;
    if (message) this.label.textContent = message;
  }

  /**
   * Simulated loading sequence. Replace the body of each step
   * with real asset loading (textures, audio buffers, etc.) as needed.
   *
   * Returns a Promise that resolves when loading is complete.
   */
  async run() {
    const steps = [
      { progress: 10,  message: 'Loading shaders...',  delay: 200 },
      { progress: 30,  message: 'Loading textures...',  delay: 300 },
      { progress: 55,  message: 'Loading audio...',     delay: 400 },
      { progress: 75,  message: 'Building scene...',    delay: 300 },
      { progress: 90,  message: 'Finalizing...',        delay: 200 },
      { progress: 100, message: 'Ready.',               delay: 350 },
    ];

    for (const step of steps) {
      await this._delay(step.delay);
      this.setProgress(step.progress, step.message);
    }

    await this._delay(400);
  }

  /* LANGUAGE SELECTOR: commented out for later
  promptLanguage(translationManager) {
    return new Promise((resolve) => {
      const overlay  = this._langOverlay;
      const select   = this._langSelect;
      const continueBtn = this._langContinue;
      if (!overlay || !select || !continueBtn) {
        resolve();
        return;
      }

      select.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value    = '';
      placeholder.disabled = true;
      placeholder.textContent = 'Select a language';
      select.appendChild(placeholder);

      for (const lang of translationManager.languages) {
        const opt = document.createElement('option');
        opt.value       = lang.key;
        opt.textContent = lang.name;
        select.appendChild(opt);
      }

      if (translationManager.selectedLanguage) {
        select.value = translationManager.selectedLanguage;
        continueBtn.disabled = false;
      } else {
        select.value = '';
        continueBtn.disabled = true;
      }

      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      select.focus();

      const onSelectChange = () => {
        continueBtn.disabled = select.value === '';
      };

      const onContinue = () => {
        if (!select.value) return;
        translationManager.setLanguage(select.value);
        select.removeEventListener('change', onSelectChange);
        continueBtn.removeEventListener('click', onContinue);
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
        resolve();
      };

      select.addEventListener('change', onSelectChange);
      continueBtn.addEventListener('click', onContinue);
    });
  }
  END LANGUAGE SELECTOR */

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
