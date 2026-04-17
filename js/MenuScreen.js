/**
 * MenuScreen
 *
 * Handles button wiring for the main menu.
 * Emits events via callbacks set on the instance.
 *
 * Usage:
 *   const menu = new MenuScreen();
 *   menu.onStartGame    = () => { ... };
 *   menu.onOpenSettings = () => { ... };
 */

export class MenuScreen {
  constructor() {
    this.onStartGame    = null;
    this.onOpenSettings = null;

    this._bindButtons();
  }

  _bindButtons() {
    const btnStart    = document.getElementById('btn-start');
    const btnSettings = document.getElementById('btn-menu-settings');

    btnStart?.addEventListener('click', () => {
      this.onStartGame?.();
    });

    btnSettings?.addEventListener('click', () => {
      this.onOpenSettings?.();
    });
  }
}
