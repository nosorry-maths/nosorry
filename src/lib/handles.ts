// Handle rules (Terms §4): public names must not impersonate the site or its staff, advertise, or offend.
// Moderators can rename a handle that breaks them (audited); this check stops the obvious cases at sign-up.

const RESERVED = new Set([
  "admin", "administrator", "root", "system", "sysadmin", "moderator", "mod", "mods", "staff", "support", "help",
  "security", "abuse", "postmaster", "webmaster", "nosorry", "official", "team", "api", "www", "mail", "null",
  "undefined", "anonymous", "deleted", "verifier", "lean", "mathlib", "anthropic", "openai", "google", "deepmind",
]);
// Advertising / spam / offensive fragments (lower case, compared without - and _).
const BANNED_FRAGMENTS = [
  "casino", "viagra", "cialis", "porn", "xxx", "escort", "betting", "bet365", "loan", "payday", "crypto", "bitcoin",
  "forex", "seo", "backlink", "followers", "buylikes", "telegram", "whatsapp", "onlyfans", "promo", "discount",
  "coupon", "dotcom", "http", "www", "nazi", "hitler",
];

/** Why this handle is not allowed, or null. */
export function handleProblem(handle: string): string | null {
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(handle)) return "Handle: 3 to 32 characters — letters, digits, _ or -. No spaces.";
  const flat = handle.toLowerCase().replace(/[-_]/g, "");
  if (RESERVED.has(handle.toLowerCase()) || RESERVED.has(flat)) return "This handle is reserved.";
  if (/^(deleted|renamed|user)-?\d+$/.test(handle.toLowerCase())) return "This handle is reserved.";
  if (BANNED_FRAGMENTS.some((b) => flat.includes(b))) return "Handles cannot advertise or contain offensive words (see the Terms).";
  if (/(com|net|org|io|xyz|shop|store|app)$/.test(flat) && /[a-z]{3,}(com|net|org|io|xyz|shop|store|app)$/.test(flat) && /(dot|-|_)/.test(handle.toLowerCase().slice(-8)))
    return "Handles cannot look like a web address.";
  return null;
}
