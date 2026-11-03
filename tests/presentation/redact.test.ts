import { describe, expect, it } from "vitest";
import { redactSecrets, redactText } from "@/lib/presentation/redact";

/*
 * Fake credentials are assembled from pieces so this file itself never holds a literal that
 * secret scanners (GitHub push protection, gitleaks) would flag.
 */
const join = (...parts: string[]) => parts.join("");
const AWS = join("AKIA", "Q7WJ4K2M9XB3T6PL");
const AWS_STS = join("ASIA", "Z9Y8X7W6V5U4T3S2");
const GITHUB = join("ghp", "_", "a1B2c3D4".repeat(4), "e5F6");
const GITHUB_OAUTH = join("gho", "_", "Zy9Xw8Vu".repeat(4), "t7S6");
const GITHUB_PAT = join("github", "_pat_", "11ABCDE2F0", "q9W8e7R6t5Y4u3I2o1P0aS");
const SLACK = join("xox", "b-", "123456789012-", "1234567890123-", "aB3dE5fG7hJ9kL1mN3pQ5rS7");
const STRIPE_LIVE = join("sk", "_live_", "4eC39HqLyjWDarjtT1zdp7dc");
const STRIPE_TEST = join("sk", "_test_", "51Hx2Jk3Lm4Np5Qr6St7Uv8W");
const STRIPE_RESTRICTED = join("rk", "_live_", "9Zy8Xw7Vu6Ts5Rq4Po3Nm2Lk");
const GOOGLE = join("AI", "za", "Sy", "A1b2C3d4E5".repeat(3), "f6G");
const OPENAI = join("sk-", "proj-", "Ab12Cd34Ef56Gh78Ij90Kl12Mn34");
const ANTHROPIC = join("sk-", "ant-", "api03-", "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Jh1");
const JWT = join("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
const PEM_BEGIN = join("-----BEGIN ", "PRIVATE KEY-----");
const PEM_END = join("-----END ", "PRIVATE KEY-----");
const KEY_LINES = [
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj",
  "MIZ8bqOqsQ5b8h3k2R8vM1y3n0p6Q2Lr7cXtY9wHf4GJdKs1aB2cD3eF4gH5iJ6k",
  "Qx7Zr2==",
];

/** Asserts the text was masked: the secret is gone, the hint is there, the text did not grow. */
function expectMasked(input: string, secret: string, hint: string, count = 1) {
  const r = redactText(input);
  expect(r.text).not.toContain(secret);
  expect(r.text).toContain(hint);
  expect(r.text).toContain("•");
  expect(r.text.length).toBeLessThanOrEqual(input.length);
  expect(r.count).toBe(count);
  return r.text;
}

describe("redactText: credential formats", () => {
  it("masks AWS access key ids and keeps the line around them", () => {
    expect(expectMasked(`const key = "${AWS}";`, AWS, "AKIA••••")).toBe('const key = "AKIA••••••••";');
    expectMasked(`aws_access_key_id=${AWS_STS}`, AWS_STS, "ASIA••••");
  });

  it("masks GitHub tokens of every kind", () => {
    expect(expectMasked(`git clone https://${GITHUB}@github.com/acme/app`, GITHUB, "ghp_••••")).toBe(
      "git clone https://ghp_••••••••@github.com/acme/app",
    );
    expectMasked(`Authorization: token ${GITHUB_OAUTH}`, GITHUB_OAUTH, "gho_••••");
    expectMasked(`GH_TOKEN=${GITHUB_PAT}`, GITHUB_PAT, "github_pat_••••");
  });

  it("masks Slack tokens", () => {
    expectMasked(`slack = WebClient("${SLACK}")`, SLACK, "xoxb-••••");
  });

  it("masks Stripe live, test and restricted keys", () => {
    expect(expectMasked(`Stripe(${JSON.stringify(STRIPE_LIVE)})`, STRIPE_LIVE, "sk_live_••••")).toBe('Stripe("sk_live_••••••••")');
    expectMasked(`stripe.api_key = '${STRIPE_TEST}'`, STRIPE_TEST, "sk_test_••••");
    expectMasked(`key: ${STRIPE_RESTRICTED}`, STRIPE_RESTRICTED, "rk_live_••••");
  });

  it("masks Google API keys", () => {
    expectMasked(`<script src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE}"></script>`, GOOGLE, "AIza••••");
  });

  it("masks OpenAI and Anthropic style keys", () => {
    expectMasked(`client = OpenAI(api_key="${OPENAI}")`, OPENAI, "sk-proj-••••");
    expectMasked(`new Anthropic({ apiKey: "${ANTHROPIC}" })`, ANTHROPIC, "sk-ant-••••");
  });

  it("masks JWTs", () => {
    expectMasked(`curl -H "Authorization: Bearer ${JWT}" https://api.acme.dev/me`, JWT, "Bearer eyJ••••");
  });

  it("masks opaque bearer tokens but keeps the scheme", () => {
    const token = join("9944b0919", "9c62bcf9418ad846dd0e4bbdfc6ee4b");
    expect(expectMasked(`Authorization: Token ${token}`, token, "Token ••••")).toBe("Authorization: Token ••••••••");
  });

  it("masks a private key block in one string, keeping the markers", () => {
    const pem = [PEM_BEGIN, ...KEY_LINES, PEM_END].join("\n");
    const r = redactText(pem);
    expect(r.count).toBe(1);
    expect(r.text.split("\n")).toEqual([PEM_BEGIN, "••••••••", "••••••••", "••••••••", PEM_END]);
  });

  it("masks a JSON-escaped private key (service account files)", () => {
    const line = `"private_key": "${PEM_BEGIN}\\n${KEY_LINES[0]}\\n${KEY_LINES[2]}\\n${PEM_END}\\n",`;
    const r = redactText(line);
    expect(r.count).toBe(1);
    expect(r.text).toBe(`"private_key": "${PEM_BEGIN}\\n••••••••\\n••••••••\\n${PEM_END}\\n",`);
  });

  it("masks only the password of a connection URL", () => {
    const password = join("s3cr3t", "Pa55");
    expect(expectMasked(`DATABASE_URL=postgres://app:${password}@db.internal:5432/app`, password, "postgres://app:••••")).toBe(
      "DATABASE_URL=postgres://app:••••••••@db.internal:5432/app",
    );
    expect(redactText(`redis://:${password}@cache:6379/0`).text).toBe("redis://:••••••••@cache:6379/0");
    expect(redactText("mongodb+srv://admin:pw@cluster0.mongodb.net").text).toBe("mongodb+srv://admin:••@cluster0.mongodb.net");
  });
});

describe("redactText: secret-named assignments", () => {
  const cases: [string, string][] = [
    ['password = "hunter2hunter2"', 'password = "••••••••"'],
    ["DB_PASSWORD=Xk9mP2qR7vT4", "DB_PASSWORD=••••••••"],
    ["  client_secret: aB3dE5fG7hJ9kL1m", "  client_secret: ••••••••"],
    ['{"api_key": "Ab12-Cd34-Ef56"}', '{"api_key": "••••••••"}'],
    ["$apiKey = 'MySecretPassword';", "$apiKey = '••••••••';"],
    ["'passwd' => 'P@ssw0rd!',", "'passwd' => '••••••••',"],
    ['SECRET_KEY: str = "django-insecure-7x#k2m"', 'SECRET_KEY: str = "••••••••"'],
    ["const accessToken = `t0k3n-Value-99`;", "const accessToken = `••••••••`;"],
    ["export ACCESS_KEY=p@ss-W0rd-2024", "export ACCESS_KEY=••••••••"],
    ["auth: Basic dXNlcjpwYXNzd29yZA==", "auth: Basic ••••••••"],
    ["https://api.acme.dev/v1/items?api_key=a1b2c3d4e5f6&page=2", "https://api.acme.dev/v1/items?api_key=••••••••&page=2"],
    ['private_key="aB3/xY+9kL2mN4pQ6rS8tU0v=="', 'private_key="••••••••"'],
  ];
  for (const [input, expected] of cases) {
    it(`masks only the literal in ${input}`, () => {
      const r = redactText(input);
      expect(r.text).toBe(expected);
      expect(r.count).toBe(1);
    });
  }

  it("counts a secret once when a format rule already masked it", () => {
    expect(redactText(`GITHUB_TOKEN="${GITHUB}"`)).toEqual({ text: 'GITHUB_TOKEN="ghp_••••••••"', count: 1 });
    expect(redactText(`auth: "Bearer ${JWT}"`)).toEqual({ text: 'auth: "Bearer eyJ••••••••"', count: 1 });
  });
});

describe("redactText: leaves everything else alone", () => {
  const unchanged = [
    // git SHAs and UUIDs
    "commit 3f2a9c1",
    "Evidence: acme/app @ 3f2a9c1d4e5b6a7980f1e2d3c4b5a69788776655",
    'sha: "3f2a9c1d4e5b6a7980f1e2d3c4b5a69788776655"',
    "request 123e4567-e89b-12d3-a456-426614174000 failed",
    'id: "123e4567-e89b-12d3-a456-426614174000"',
    // file paths
    "lib/auth/github-token.ts:18",
    "~/.ssh/id_rsa and /etc/ssl/private/server.key",
    'private_key: "/etc/ssl/private/server-2024.key"',
    "src/secrets/token.ts",
    // URLs without credentials
    "https://github.com/acme/app/blob/main/lib/auth/session.ts",
    "postgres://localhost:5432/app",
    "https://example.com:8443/oauth/token",
    "git@github.com:acme/app.git",
    // env var references
    "const apiKey = process.env.API_KEY;",
    'token = os.environ["TOKEN"]',
    "password = os.environ.get('DB_PASSWORD')",
    'secret: "${SECRET}"',
    "TOKEN=$TOKEN",
    "export API_KEY=${API_KEY}",
    "token: ${{ secrets.GITHUB_TOKEN }}",
    'GITHUB_TOKEN: "GITHUB_TOKEN"',
    // placeholders and empty values
    'password: "changeme"',
    'api_key = "your-api-key"',
    'API_KEY="YOUR_API_KEY_HERE"',
    'token = "xxx"',
    'token: "<token>"',
    'secret = "..."',
    'password = ""',
    "API_KEY=<your-key>",
    'apiKey: "xxxxxxxxxxxxxxxxxxxxxxxx"',
    `aws_access_key_id = ${join("AKIA", "IOSFODNN7EXAMPLE")}`,
    "postgres://user:password@localhost:5432/app",
    "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
    // type annotations
    "token: string",
    "apiKey?: string;",
    "password: string | undefined;",
    "token: Optional[str] = None",
    "password: z.string().min(8),",
    "accessToken: AccessTokenResponse",
    // calls and variables
    "token = getToken()",
    "const secret = await loadSecret(name);",
    "password: await hash(input.password, 12),",
    "token = accessToken",
    "api_key = settings.API_KEY",
    "client._workloadIdentityAuth = this.#x509Authentication;",
    "if (password !== confirmPassword) return;",
    // prose and code that only look close
    "Auth: OAuth2-based sign-in",
    "Token: 15-minute expiry, refreshed silently",
    'password: "Password must be at least 8 characters"',
    "'password' => 'required|string|min:8|confirmed',",
    "const X509_SUBJECT_TOKEN = 'urn:ietf:params:oauth:token-type:jwt';",
    `Keys are stored as ${PEM_BEGIN} files on disk`,
    "max_tokens: 4096",
    "passwordHash: bcrypt12rounds",
    "Bearer tokens are verified by the middleware",
    "task-management-dashboard-for-teams-2024",
    // package.json versions under secret-named packages, translated labels, enum values
    '"next-auth": "^5.0.0-beta.25",',
    '"better-auth": "workspace:*",',
    '"password": "Passwort",',
    'secret: "Geheimnis"',
    'token_endpoint_auth: "client_secret_post"',
    "",
  ];
  for (const input of unchanged) {
    it(`keeps ${JSON.stringify(input)}`, () => {
      expect(redactText(input)).toEqual({ text: input, count: 0 });
    });
  }
});

describe("redactSecrets", () => {
  it("masks a private key quoted across a code block's lines", () => {
    const lines = ["const key = `" + PEM_BEGIN, ...KEY_LINES, PEM_END + "`;", "export default key;"];
    const { value, count } = redactSecrets({ type: "code", title: "Signing key", lines });
    expect(count).toBe(1);
    expect(value.lines).toEqual(["const key = `" + PEM_BEGIN, "••••••••", "••••••••", "••••••••", PEM_END + "`;", "export default key;"]);
  });

  it("masks key lines quoted as concatenated strings and stops at the first non-key line", () => {
    const lines = [`KEY = ("${PEM_BEGIN}\\n"`, `  "${KEY_LINES[0]}\\n"`, `  "${KEY_LINES[1]}\\n")`, "sign(payload, KEY)", "x = 'abcdefgh'"];
    const { value, count } = redactSecrets(lines);
    expect(count).toBe(1);
    expect(value).toEqual([`KEY = ("${PEM_BEGIN}\\n"`, '  "••••••••\\n"', '  "••••••••\\n")', "sign(payload, KEY)", "x = 'abcdefgh'"]);
  });

  it("masks key lines after a truncated block with no END marker", () => {
    const { value, count } = redactSecrets([PEM_BEGIN, KEY_LINES[0], KEY_LINES[1], "..."]);
    expect(count).toBe(1);
    expect(value).toEqual([PEM_BEGIN, "••••••••", "••••••••", "..."]);
  });

  it("walks a whole deck, counts every secret and leaves non-strings untouched", () => {
    const password = join("s3cr3t", "Pa55");
    const deck = {
      format: 2,
      title: "Payments service",
      showCommit: true,
      brand: null,
      slides: [
        { id: "s1", layout: "cover", title: "Billing that *never double-charges*", meta: [{ label: "Commit", value: "main · 3f2a9c1" }] },
        {
          id: "s2",
          layout: "page",
          notes: `The deploy uses ${GITHUB} for pulls.`,
          main: [
            { type: "code", title: "Config", lines: [`STRIPE_KEY=${STRIPE_LIVE}`, `DATABASE_URL=postgres://app:${password}@db:5432/app`, "PORT=8080"], claimRefs: ["C1"] },
            { type: "stats", items: [{ value: "42", label: "routes" }, { value: "7", label: "services" }] },
          ],
          side: [],
        },
      ],
    };
    const before = structuredClone(deck);
    const { value, count } = redactSecrets(deck);

    expect(count).toBe(3);
    expect(deck).toEqual(before);
    expect(value).not.toBe(deck);
    expect(value.slides[1]).not.toBe(deck.slides[1]);
    const text = JSON.stringify(value);
    for (const secret of [GITHUB, STRIPE_LIVE, password]) expect(text).not.toContain(secret);
    expect(value.slides[1].main?.[0]).toMatchObject({ lines: ["STRIPE_KEY=sk_live_••••••••", "DATABASE_URL=postgres://app:••••••••@db:5432/app", "PORT=8080"] });
    expect(value.slides[1].notes).toBe("The deploy uses ghp_•••••••• for pulls.");
    expect(value.slides[0]).toEqual(deck.slides[0]);
    expect(value.format).toBe(2);
    expect(value.showCommit).toBe(true);
    expect(value.brand).toBeNull();
  });

  it("masks a private key printed across a terminal block's { text, kind } lines", () => {
    const lines = [
      { text: "$ cat deploy/key.pem", kind: "command" },
      { text: PEM_BEGIN, kind: "output" },
      { text: KEY_LINES[0], kind: "output" },
      { text: KEY_LINES[2], kind: "output" },
      { text: PEM_END, kind: "output" },
    ];
    const { value, count } = redactSecrets({ type: "terminal", title: "Keys", lines });
    expect(count).toBe(1);
    expect(value.lines.map((l) => l.text)).toEqual(["$ cat deploy/key.pem", PEM_BEGIN, "••••••••", "••••••••", PEM_END]);
    expect(value.lines.map((l) => l.kind)).toEqual(["command", "output", "output", "output", "output"]);
  });

  it("stays linear on long lines of dotted, dashed or eyJ-prefixed words", () => {
    const started = Date.now();
    for (const text of ["a.".repeat(50_000), "eyJ-".repeat(25_000), "xoxb-a".repeat(20_000)]) expect(redactText(text).count).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("returns non-plain values as they are", () => {
    const date = new Date(0);
    const { value, count } = redactSecrets({ when: date, n: 3, flag: false, nothing: undefined });
    expect(value.when).toBe(date);
    expect(value).toEqual({ when: date, n: 3, flag: false, nothing: undefined });
    expect(count).toBe(0);
    expect(redactSecrets(`k=${AWS}`)).toEqual({ value: "k=AKIA••••••••", count: 1 });
  });
});
