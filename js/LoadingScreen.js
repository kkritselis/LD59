/**
 * LoadingScreen
 *
 * Drives the loading progress bar and status label.
 * Call run() to simulate or drive real asset loading,
 * then resolve() to signal completion to main.js.
 */

export class LoadingScreen {
  constructor() {
    this.bar   = document.getElementById('loading-bar-fill');
    this.label = document.getElementById('loading-label');
    this._progress = 0;
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

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
