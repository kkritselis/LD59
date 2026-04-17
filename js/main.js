/**
 * main.js — Entry Point
 *
 * Boots the application, wires all modules together, and drives
 * the top-level flow:  Loading -> Menu -> Game
 */

import { AudioManager }  from './AudioManager.js';
import { ScreenManager } from './ScreenManager.js';
import { LoadingScreen } from './LoadingScreen.js';
import { MenuScreen }    from './MenuScreen.js';
import { GameScreen }    from './GameScreen.js';
import { SettingsModal } from './SettingsModal.js';

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------

async function main() {
  // Core services
  const audio   = new AudioManager();
  const screens = new ScreenManager();

  // UI modules
  const loading  = new LoadingScreen();
  const menu     = new MenuScreen();
  const settings = new SettingsModal(audio);

  // GameScreen is created lazily on first play to avoid
  // allocating a WebGL context before it is needed.
  let game = null;

  // ------------------------------------------------------------------
  // Loading -> Menu
  // ------------------------------------------------------------------

  // Show the loading screen immediately (it is already active in HTML)
  screens.current = 'loading';

  await loading.run();
  await screens.show('menu');

  // ------------------------------------------------------------------
  // Menu wiring
  // ------------------------------------------------------------------

  menu.onStartGame = async () => {
    // Initialize audio on first user gesture
    audio.init();

    if (!game) {
      game = new GameScreen(audio);

      game.onOpenSettings = () => settings.open();

      game.onMainMenu = async () => {
        await screens.show('menu');
      };
    }

    await screens.show('game');
    game.start();
  };

  menu.onOpenSettings = () => {
    audio.init();
    settings.open();
  };
}

main().catch(err => {
  console.error('[main] Unhandled error during startup:', err);
});
