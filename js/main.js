/**
 * main.js — Entry Point
 *
 * Boots the application, wires all modules together, and drives
 * the top-level flow:  Loading -> Language select -> Menu -> Game
 */

import { AudioManager }       from './AudioManager.js';
import { ScreenManager }      from './ScreenManager.js';
import { LoadingScreen }      from './LoadingScreen.js';
import { MenuScreen }         from './MenuScreen.js';
import { GameScreen }         from './GameScreen.js';
import { SettingsModal }      from './SettingsModal.js';
import { TranslationManager } from './TranslationManager.js';

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------

async function main() {
  // Core services
  const audio         = new AudioManager();
  const screens       = new ScreenManager();
  const translations  = new TranslationManager();
  await translations.load();

  // UI modules
  const loading  = new LoadingScreen();
  const menu     = new MenuScreen();
  const settings = new SettingsModal(audio, translations);

  // GameScreen is created lazily on first play to avoid
  // allocating a WebGL context before it is needed.
  let game = null;

  // ------------------------------------------------------------------
  // Loading -> Language select -> Menu
  // ------------------------------------------------------------------

  // Show the loading screen immediately (it is already active in HTML)
  screens.current = 'loading';

  await loading.run();

  // LANGUAGE SELECTOR: await loading.promptLanguage(translations);

  await screens.show('menu');
  menu.start();

  // ------------------------------------------------------------------
  // Menu wiring
  // ------------------------------------------------------------------

  menu.onStartGame = async () => {
    // Initialize audio on first user gesture
    audio.init();
    audio.playWarp();
    await menu.playStartTransition();
    menu.stop();

    if (!game) {
      game = new GameScreen(audio, translations);

      game.onOpenSettings = () => settings.open();

      game.onMainMenu = async () => {
        settings.setAbandonHandler(null);
        await screens.show('menu');
        menu.start();
      };
    }

    settings.setAbandonHandler(async () => {
      settings.setAbandonHandler(null);
      game.stop();
      await screens.show('menu');
      menu.start();
    });

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
