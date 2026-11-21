// localStorage behind the platform storage facade. Every access may throw (private mode, blocked storage,
// quota): reads return null, enumeration returns [], writes rethrow so callers can handle a full quota.
export const localStore = {
  getItem(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setItem(k, v) { localStorage.setItem(k, String(v)); },
  removeItem(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  keys() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k != null) out.push(k); } } catch { /* ignore */ }
    return out;
  },
};
