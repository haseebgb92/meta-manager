/** Media identification for display only: never attempt image decoding on hosted MP4/WebM. */
export function isVideoAsset(url, platform = "") {
  if (typeof url !== "string" || !url.trim()) return false;
  if (platform === "instagram_reel") return true;
  try { return /\.(mp4|webm|mov|m4v|ogv)$/i.test(new URL(url).pathname); }
  catch { return /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(url); }
}

export function isSafeMediaUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch { return false; }
}
