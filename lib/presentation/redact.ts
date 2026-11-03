/**
 * Secret redaction for decks. Code blocks quote repository lines, and repositories sometimes hold
 * hardcoded credentials; a deck travels further than the repository's readers, so every string in it
 * is checked before it is rendered or shared. Code decides, not a model: a value is masked when it has
 * a known credential format, sits inside a private key block, is the password of a connection URL, or
 * is a literal assigned to a secret-named key.
 *
 * Precision matters as much as recall: a masked commit SHA, path or env var reference would make a
 * slide wrong, so references, placeholders, calls, members and types are left alone.
 *
 * A mask keeps the recognisable prefix (`AKIA••••••••`, `sk_live_••••••••`) and none of the secret
 * body, and is never longer than what it replaces, so redacted text still fits the spec's limits.
 */

const DOT = "•";

/** One bullet per masked character, at most 8: hides the length of long secrets, never lengthens text. */
function bullets(body: string): string {
  return DOT.repeat(Math.min(8, body.length));
}

const hasLetter = (s: string) => /[A-Za-z]/.test(s);
const hasDigit = (s: string) => /\d/.test(s);

/** Documentation stand-ins rather than credentials: "your-api-key", "changeme", "xxxx…", "<token>", "...". */
function isPlaceholder(value: string): boolean {
  return (
    /^[x*•.#_-]+$/i.test(value) ||
    /(.)\1{5,}/.test(value) ||
    /(?:^|[^a-z])your|changeme|change[-_ ]me|replace[-_ ]?me|placeholder|example|dummy|redacted|insert[-_ ]|[-_ ]here$|\.\.\.|<[^>]*>/i.test(value) ||
    /^(?:password|passwd|pass|pwd|secret|token|none|null|nil|undefined|true|false|string|required|optional|enabled|disabled)$/i.test(value)
  );
}

/** Values that point at a secret kept elsewhere: environment variables and template slots. */
function isReference(value: string): boolean {
  return /^\$|\$\{|\{\{|%\(|process\.env|import\.meta\.env|os\.environ|getenv|ENV\[/.test(value);
}

/**
 * URLs, URNs (urn:ietf:params:oauth:…), file paths, key file names and package versions say where a
 * secret lives or what it is: package.json lists "next-auth": "^5.0.0-beta.25" under a secret-named key.
 */
function isLocation(value: string): boolean {
  return (
    /^[~^=<>v]*\d+(?:\.\d+){1,3}(?:[-+][\w.-]*)?$/.test(value) ||
    /^(?:workspace|catalog|npm|file|link|github):/.test(value) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /^[a-z][\w.-]*(?::[\w.-]+){2,}$/i.test(value) ||
    /^(?:~|\.{1,2})?\/|^[A-Za-z]:\\/.test(value) ||
    /^[\w./-]+\.(?:pem|key|crt|cer|p12|pfx|jks|der|pub|json|ya?ml|toml|env|txt)$/i.test(value) ||
    (value.includes("/") && value.split("/").every((s) => /^[A-Za-z_.-]*$/.test(s)))
  );
}

/** How often a value switches between letters and digits: "hunter2hunter2" 3, "OAuth2-based" 2. */
function letterDigitSwitches(value: string): number {
  return value.replace(/[^A-Za-z0-9]/g, "").replace(/[A-Za-z]+/g, "a").replace(/\d+/g, "1").length - 1;
}

/**
 * A quoted literal that looks like a credential. Spaces mean prose ("Password is required"),
 * UPPER_SNAKE is an env var name, "required|min:8" a validation rule; otherwise it must mix
 * character classes or be long.
 */
function quotedSecret(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value) || /^[a-z]+(?:_[a-z]+)+$/.test(value)) return false; // API_KEY, client_secret_post
  if (/^[A-Z][a-z]+$/.test(value)) return false; // a translated label: "password": "Passwort"
  if (/^[a-z_]+(?::[^|]*)?(?:\|[a-z_]+(?::[^|]*)?)+$/i.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9._-]/].filter((re) => re.test(value)).length;
  return classes >= 2 || value.length >= 16;
}

/**
 * An unquoted literal (.env, YAML, query strings) that looks like a credential. Code puts variables,
 * members and types in the same place, and deck prose ("Token: 15-minute expiry") too, so a bare
 * value must mix letters and digits several times over, or carry symbols besides.
 */
function bareSecret(value: string): boolean {
  if (/^[A-Za-z_$#][\w$#]*(?:\.[A-Za-z_$#][\w$#]*)+$/.test(value)) return false; // this.#client, config.token
  if (/=[^=]/.test(value)) return false; // a chained assignment or expression; base64 pads only at the end
  if (!hasLetter(value) || !hasDigit(value)) return false;
  return letterDigitSwitches(value) >= 3 || /[^A-Za-z0-9._/-]/.test(value);
}

const SECRET_LAST = new Set(["password", "passwd", "secret", "token", "auth", "apikey"]);
const SECRET_PAIR = new Set(["api key", "access key", "private key", "secret key"]);

/** Whether a key name ends in a secret word: dbPassword, API_KEY, client_secret, x-auth-token; not passwordHash or oauth. */
function isSecretKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return SECRET_LAST.has(words.at(-1) ?? "") || SECRET_PAIR.has(words.slice(-2).join(" "));
}

/**
 * The masked form of a literal assigned to a secret key, or null to leave it. `next` is the character
 * after a bare value: a call, index or generic (`getToken()`, `env["X"]`) is code, not a literal.
 */
function maskLiteral(raw: string, next: string): string | null {
  const quote = /^["'`]/.test(raw) ? raw[0] : "";
  if (!quote && /[([{<]/.test(next)) return null;
  const inner = quote ? raw.slice(1, -1) : raw.replace(/[.:]+$/, "");
  const after = quote || raw.slice(inner.length);
  const scheme = /^(?:Bearer|Basic|Token)\s+/i.exec(inner)?.[0] ?? "";
  const body = inner.slice(scheme.length);
  if (body.length < 8 || body.includes(DOT) || isReference(body) || isPlaceholder(body) || isLocation(body)) return null;
  if (!(quote ? quotedSecret(body) : bareSecret(body))) return null;
  return quote + scheme + bullets(body) + after;
}

interface PrefixRule {
  /** Group 1 is the recognisable prefix kept in the mask, group 2 the secret body. */
  re: RegExp;
  ok?: (body: string) => boolean;
}

/** Known credential formats, most specific first. */
const PREFIX_RULES: PrefixRule[] = [
  { re: /\b(AKIA|ASIA)([A-Z0-9]{16})\b/g },
  { re: /\b(gh[pousr]_)([A-Za-z0-9]{36,255})\b/g },
  { re: /\b(github_pat_)([A-Za-z0-9_]{22,255})\b/g },
  { re: /\b(xox[baprs]-)([A-Za-z0-9-]{10,})/g, ok: hasDigit },
  { re: /\b((?:sk|rk)_(?:live|test)_)([A-Za-z0-9]{10,})\b/g },
  { re: /\b(AIza)([A-Za-z0-9_-]{35})(?![A-Za-z0-9_-])/g },
  { re: /\b(sk-(?:ant-|proj-)?)([A-Za-z0-9_-]{20,})/g, ok: (b) => hasLetter(b) && hasDigit(b) },
  // Starts only where a base64url run starts: from inside a run, the search would rescan it at every "eyJ".
  { re: /(?<![A-Za-z0-9_-])(eyJ)([A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g },
  { re: /\b((?:Bearer|Basic|Token)\s+)([A-Za-z0-9._~+/-]{16,}={0,2})/g, ok: (b) => hasLetter(b) && hasDigit(b) },
];

/**
 * scheme://user:PASSWORD@host. The user part has no ":" or "/", so host:port/path@x never matches.
 * Schemes are short (mongodb+srv, postgresql+asyncpg); the bound keeps long dotted lines linear.
 */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/"'`]*:)([^\s@/"'`]+)@/gi;

const SECRET_WORD = String.raw`(?:pass(?:word|wd)|secret[_-]?key|secret|token|auth|api[_-]?key|access[_-]?key|private[_-]?key)`;

/**
 * key = value, key: value, "key": "value", key => value, key := value, and typed `key: str = value`.
 * The key must end in a secret word (checked again by isSecretKey on word boundaries); the value is
 * a quoted literal or a bare run up to a delimiter. The key is at most 64 characters, so a long line
 * of dotted or dashed words is not rescanned from every word.
 */
const ASSIGNMENT_RE = new RegExp(
  String.raw`(?<![\w$])(["']?)((?:[A-Za-z_$][\w$.-]{0,63}?)?${SECRET_WORD})\1[?!]?` +
    String.raw`((?:\s*:\s*[A-Za-z_][\w.<>\[\]|? ]{0,40}?(?=\s*=[^=>]))?\s*(?:=>|={1,3}|!={1,2}|:=|:)\s*)` +
    String.raw`("[^"\n]*"|'[^'\n]*'|\`[^\`\n]*\`|[^\s"'\`,;&()\[\]{}<>\\]+)`,
  "gi",
);

/* ------------------------------------------------------------ Private keys */

interface PemState {
  /** Inside a private key block whose END marker has not been seen yet. */
  open: boolean;
  /** This block was already counted. */
  counted: boolean;
}

const freshPem = (): PemState => ({ open: false, counted: false });

const PEM_BEGIN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;
const PEM_END = /-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;
const B64_RUN = /[A-Za-z0-9+/]{2,}={0,2}/g;
/** What surrounds key lines quoted in code: quotes, concatenation, escaped newlines (`"MIIE…\n" +`). */
const DECORATION = /^[\s"'`+,;=()]*$/;

const unescape = (s: string) => s.replace(/\\[nr]/g, " ");
const decorationOnly = (s: string) => DECORATION.test(unescape(s));

/**
 * A line of key material: base64 runs in nothing but decoration, every run but the last full length
 * (key lines are 64 characters, only the final one is shorter), so `sign(payload, KEY)` is code.
 */
function isKeyLine(s: string): boolean {
  const plain = unescape(s);
  const runs = plain.match(B64_RUN) ?? [];
  return runs.length > 0 && runs.slice(0, -1).every((r) => r.length >= 16) && DECORATION.test(plain.replace(B64_RUN, ""));
}

/** Masks the base64 runs of key material, keeping escaped newlines and the code around them. */
function maskRuns(s: string): string {
  return s.replace(/(\\[nr])|[A-Za-z0-9+/]{2,}={0,2}/g, (m: string, escape?: string) => (escape ? m : bullets(m)));
}

/**
 * Masks private key bodies line by line, keeping the BEGIN/END markers. A block may span lines of one
 * string or, through `pem`, consecutive strings of an array (a code block's lines). A line that only
 * names the marker in prose holds no key and is left alone.
 */
function maskPem(text: string, pem: PemState): { text: string; count: number } {
  if (!pem.open && !PEM_BEGIN.test(text)) return { text, count: 0 };
  let count = 0;
  const mask = (s: string) => {
    const out = maskRuns(s);
    if (out !== s && !pem.counted) {
      pem.counted = true;
      count++;
    }
    return out;
  };
  const lines = text.split("\n").map((line) => {
    let head = "";
    let rest = line;
    if (pem.open && !PEM_END.test(line) && !isKeyLine(line)) {
      // Blank lines and armor headers (Proc-Type, DEK-Info, Version) sit inside a block.
      if (decorationOnly(line) || /^\s*["'`]?[A-Za-z-]+: /.test(line)) return line;
      pem.open = false;
    }
    if (!pem.open) {
      const begin = PEM_BEGIN.exec(line);
      if (!begin) return line;
      head = line.slice(0, begin.index + begin[0].length);
      rest = line.slice(head.length);
      if (!PEM_END.test(rest) && !decorationOnly(rest) && !/[A-Za-z0-9+/]{16,}/.test(rest)) return line;
      pem.open = true;
      pem.counted = false;
    }
    const end = PEM_END.exec(rest);
    if (!end) return head + mask(rest);
    pem.open = false;
    return head + mask(rest.slice(0, end.index)) + rest.slice(end.index);
  });
  return { text: lines.join("\n"), count };
}

/* ------------------------------------------------------------------ Public */

function redactWith(text: string, pem: PemState): { text: string; count: number } {
  if (!text) return { text, count: 0 };
  const keyed = maskPem(text, pem);
  let out = keyed.text;
  let count = keyed.count;
  for (const rule of PREFIX_RULES) {
    out = out.replace(rule.re, (match: string, prefix: string, body: string) => {
      if ((rule.ok && !rule.ok(body)) || isPlaceholder(body)) return match;
      count++;
      return prefix + bullets(body);
    });
  }
  out = out.replace(URL_CREDENTIALS, (match: string, head: string, password: string) => {
    if (isReference(password) || isPlaceholder(password)) return match;
    count++;
    return `${head}${bullets(password)}@`;
  });
  out = out.replace(ASSIGNMENT_RE, (match: string, _q: string, key: string, _sep: string, value: string, offset: number, whole: string) => {
    if (!isSecretKey(key)) return match;
    const masked = maskLiteral(value, whole.charAt(offset + match.length));
    if (masked === null) return match;
    count++;
    return match.slice(0, match.length - value.length) + masked;
  });
  return { text: out, count };
}

/** Masks credential values in one text, keeping the rest of each line, and counts how many it masked. */
export function redactText(text: string): { text: string; count: number } {
  return redactWith(text, freshPem());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Redacts every string in a deck spec (or any JSON-like value) and returns a new value; the input is
 * not mutated and non-string leaves are kept as they are. Consecutive strings of an array share key
 * block state, and so does each field of consecutive objects in an array (a terminal block's
 * `{ text, kind }` lines), so a private key quoted across a block's lines is masked line by line.
 */
export function redactSecrets<T>(value: T): { value: T; count: number } {
  let count = 0;
  const walkObject = (v: Record<string, unknown>, fields: Map<string, PemState>) =>
    Object.fromEntries(
      Object.entries(v).map(([k, item]) => {
        const pem = fields.get(k) ?? freshPem();
        fields.set(k, pem);
        return [k, walk(item, pem)];
      }),
    );
  const walk = (v: unknown, pem: PemState): unknown => {
    if (typeof v === "string") {
      const r = redactWith(v, pem);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(v)) {
      let run = freshPem();
      let fields = new Map<string, PemState>();
      return v.map((item) => {
        if (typeof item !== "string") run = freshPem();
        if (!isPlainObject(item)) fields = new Map();
        return isPlainObject(item) ? walkObject(item, fields) : walk(item, run);
      });
    }
    if (isPlainObject(v)) return walkObject(v, new Map());
    return v;
  };
  return { value: walk(value, freshPem()) as T, count };
}
