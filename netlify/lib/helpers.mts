import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pk_session";
export const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "请求内容格式不正确");
}

// ---------- Cookies & sessions ----------

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${
    SESSION_DAYS * 24 * 60 * 60
  }`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------- Passwords (scrypt, built into Node) ----------

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, keyHex] = String(stored).split("$");
  if (alg !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Used to keep response time similar when the username does not exist
let dummyHash: string | null = null;
export function getDummyHash(): string {
  if (!dummyHash) dummyHash = hashPassword("not-a-real-password");
  return dummyHash;
}

// ---------- Validation ----------

export function normPhone(phone: string): string {
  return String(phone).replace(/[\s-]/g, "");
}

export function maskPhone(phone: string): string {
  const s = normPhone(phone);
  if (s.length < 6) return s;
  const head = s.length >= 10 ? 3 : 2;
  return s.slice(0, head) + "*".repeat(s.length - head - 2) + s.slice(-2);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function validUsername(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(s)) {
    throw new HttpError(400, "帐号名称需为 3 至 32 个英文字母、数字、底线、点或连字号");
  }
  return s;
}

export function validPassword(v: unknown): string {
  const s = String(v ?? "");
  if (s.length < 8) throw new HttpError(400, "密码最少需要 8 个字元");
  if (s.length > 128) throw new HttpError(400, "密码不可超过 128 个字元");
  return s;
}

export function validPlayer(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const rawPoints = body.points;
  if (!name) throw new HttpError(400, "请输入姓名");
  if (name.length > 50) throw new HttpError(400, "姓名不可超过 50 个字");
  if (!/^\+?[\d\s-]{6,20}$/.test(phone)) {
    throw new HttpError(400, "手机号格式不正确，只可包含数字、空格、+ 或 -");
  }
  const points = rawPoints === "" || rawPoints === undefined || rawPoints === null ? 0 : Number(rawPoints);
  if (!Number.isFinite(points) || Math.abs(points) >= 1e11) throw new HttpError(400, "积分必须是数字");
  return { name, phone, phoneNormalized: normPhone(phone), points: round2(points) };
}

export function validDelta(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) >= 1e11) throw new HttpError(400, "请输入不是 0 的分数");
  return round2(n);
}

export function validId(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, "找不到这笔资料");
  return n;
}

// ---------- Sit and Go rewards ----------

export const REWARD_OPTIONS = ["盲盒", "20000积分", "10000积分"] as const;

export function validReward(v: unknown, label = ""): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!(REWARD_OPTIONS as readonly string[]).includes(s)) {
    throw new HttpError(400, `${label}奖励只可以选择：${REWARD_OPTIONS.join("、")}`);
  }
  return s;
}

// ---------- Sit and Go periods ----------

export const HK_OFFSET = "+08:00";

/** Today's date in Hong Kong as YYYY-MM-DD. */
export function hkToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function defaultMonthStart(): string {
  return hkToday().slice(0, 8) + "01";
}

export function defaultYearStart(): string {
  return hkToday().slice(0, 4) + "-01-01";
}

export function validDate(v: unknown, label: string): string {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${label}格式不正确，请用 2026-09-01 这种格式`);
  const d = new Date(`${s}T00:00:00${HK_OFFSET}`);
  if (isNaN(d.getTime())) throw new HttpError(400, `${label}不是有效日期`);
  return s;
}

/** Start of that Hong Kong day, as a value Postgres can compare against timestamptz. */
export function dayStart(date: string): string {
  return `${date}T00:00:00${HK_OFFSET}`;
}
