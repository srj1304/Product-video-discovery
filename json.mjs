export const safeJson = (s, fallback = {}) => {
  try { return JSON.parse(s); } catch { return fallback; }
};
export const json = (obj) => JSON.stringify(obj);
