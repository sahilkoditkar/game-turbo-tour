// Behaviour when the game runs inside a portal iframe (does nothing on a top-level page, e.g. GitHub Pages).
// - take keyboard focus at boot, so the keys work before the first click
// - keys whose default action is "scroll" must not scroll the PARENT page: the game page itself never scrolls,
//   so the browser hands PageUp / PageDown / Home / End to the embedding page. (Arrows and Space are already
//   prevented in input.js.)
// - Tab opens the Free Roam map; while driving (focus on the page itself, not on a menu button) its default
//   action would move focus out of the iframe into the portal page, so it is prevented there.
const PARENT_SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End']);

export function setupEmbed() {
  let framed = false;
  try { framed = window.self !== window.top; } catch { framed = true; }
  if (!framed) return false;
  try { window.focus(); } catch { /* ignore */ }
  window.addEventListener('keydown', (e) => {
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (PARENT_SCROLL_KEYS.has(e.code)) { e.preventDefault(); return; }
    if (e.code === 'Tab' && (t === document.body || t === document.documentElement || tag === 'CANVAS')) e.preventDefault();
  });
  return true;
}
