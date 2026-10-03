const BROKEN_ENDING =
  /^(?:ção|ções|ssão|sões|mento|menta|mente|dade|agens|agem|ário|ária|ência|ância|ável|ível|ando|endo|indo|ado|ada|idos|idas|oso|osa|ente|antes|ência)$/i;

/** True when a line-end hyphen is a word broken by the line, not a compound, code or process number. */
export function dehyphenateAllowed(prevLine: string, nextLine: string): boolean {
  if (!/[-\u2010\u2011]$/.test(prevLine.trim())) return false;
  const left = prevLine.trim().replace(/[-\u2010\u2011]$/, "").split(/\s/).pop() ?? "";
  const right = nextLine.trim().split(/\s/)[0]?.replace(/[^\p{L}].*$/u, "") ?? "";
  if (left.length < 2 || right.length < 2) return false;
  if (/\d/.test(left) || /\d/.test(right)) return false;
  if (/[./\\]/.test(left)) return false;
  if (BROKEN_ENDING.test(right)) return true;
  if (left.length >= 4 && right.length >= 4) return false;
  return true;
}
