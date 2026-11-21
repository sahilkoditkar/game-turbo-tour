// Entry point: start the platform layer, then the game. The career save is read while main.js starts,
// so the platform (and its storage) must be ready first; init() never rejects and is time-bounded.
import { platform } from './platform/index.js';
import { setupEmbed } from './platform/embed.js';

setupEmbed(); // iframe focus + keys that would scroll the embedding page (no-op on a top-level page)
await platform.init();
platform.loadingStart(); // initial loading: main.js calls loadingStop() once the main menu is up
await import('./main.js');
