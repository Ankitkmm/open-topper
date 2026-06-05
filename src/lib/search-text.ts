const TOKEN_SPLIT = /[^a-z0-9]+/g;

export function normalizeSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchTerms(value: string) {
  return normalizeSearchText(value)
    .split(TOKEN_SPLIT)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

export function searchTokens(value: string) {
  return normalizeSearchText(value)
    .split(TOKEN_SPLIT)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function matchesSearchTerm(term: string, haystack: string, tokens: string[]) {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return true;
  if (haystack.includes(normalizedTerm)) return true;
  return tokens.some((token) => fuzzyTokenMatch(normalizedTerm, token));
}

export function fuzzyTokenMatch(leftRaw: string, rightRaw: string) {
  const left = normalizeSearchText(leftRaw);
  const right = normalizeSearchText(rightRaw);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 4 && right.includes(left)) return true;
  if (right.length >= 4 && left.includes(right)) return true;

  const distance = boundedLevenshtein(left, right, fuzzyDistanceLimit(left, right));
  return distance <= fuzzyDistanceLimit(left, right);
}

export function bestTokenMatchScore(term: string, tokens: string[]) {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return 0;
  let best = 0;

  for (const token of tokens) {
    const normalizedToken = normalizeSearchText(token);
    if (!normalizedToken) continue;
    if (normalizedToken === normalizedTerm) return 1;
    if (normalizedToken.includes(normalizedTerm) || normalizedTerm.includes(normalizedToken)) {
      best = Math.max(best, 0.82);
      continue;
    }

    const limit = fuzzyDistanceLimit(normalizedTerm, normalizedToken);
    const distance = boundedLevenshtein(normalizedTerm, normalizedToken, limit);
    if (distance > limit) continue;

    const denominator = Math.max(normalizedTerm.length, normalizedToken.length, 1);
    best = Math.max(best, Math.max(0.4, 1 - distance / denominator));
  }

  return best;
}

function fuzzyDistanceLimit(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength <= 5) return 1;
  if (maxLength <= 9) return 2;
  return 2;
}

function boundedLevenshtein(left: string, right: string, limit: number) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  if (left === right) return 0;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    let rowMin = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost,
      );
      rowMin = Math.min(rowMin, current[rightIndex]);
    }

    if (rowMin > limit) return limit + 1;
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }

  return previous[right.length];
}
