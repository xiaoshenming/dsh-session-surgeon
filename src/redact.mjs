const SK_RE = /(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9]{10,}/g;
const PEM_RE =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/g;
const HOME_RE = /\/(?:home|Users)\/[^/\s]+/g;

/** True when `s` contains an unpaired UTF-16 surrogate. */
export function containsLoneSurrogate(s) {
  if (typeof s !== "string") return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/** Replace unpaired surrogates. Default replacement is U+FFFD. */
export function replaceLoneSurrogates(s, replacement = "\uFFFD") {
  if (typeof s !== "string") return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i += 1;
      } else {
        out += replacement;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += replacement;
      continue;
    }
    out += s[i];
  }
  return out;
}

export function redactString(s) {
  if (typeof s !== "string" || s.length === 0) return s;
  return s
    .replace(SK_RE, "$1sk-REDACTED")
    .replace(PEM_RE, "REDACTED_PEM")
    .replace(HOME_RE, "~");
}

/** Walk any JSON-like value; strings go through `fn`. */
export function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, fn);
    return out;
  }
  return value;
}

export function redactValue(value) {
  return mapStrings(value, redactString);
}

/** Count lone-surrogate strings in a tree (does not mutate). */
export function countLoneSurrogates(value) {
  let n = 0;
  mapStrings(value, (s) => {
    if (containsLoneSurrogate(s)) n += 1;
    return s;
  });
  return n;
}

/** Deep-clone and replace lone surrogates. Returns { value, replaced }. */
export function replaceLoneSurrogatesIn(value, replacement = "\uFFFD") {
  let replaced = 0;
  const next = mapStrings(value, (s) => {
    if (!containsLoneSurrogate(s)) return s;
    replaced += 1;
    return replaceLoneSurrogates(s, replacement);
  });
  return { value: next, replaced };
}
