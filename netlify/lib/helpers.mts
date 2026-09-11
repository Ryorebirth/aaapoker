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
  throw new HttpError(400, "請求內容格式不正確");
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
    throw new HttpError(400, "帳號名稱需為 3 至 32 個英文字母、數字、底線、點或連字號");
  }
  return s;
}

export function validPassword(v: unknown): string {
  const s = String(v ?? "");
  if (s.length < 8) throw new HttpError(400, "密碼最少需要 8 個字元");
  if (s.length > 128) throw new HttpError(400, "密碼不可超過 128 個字元");
  return s;
}

export function validPlayer(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const rawPoints = body.points;
  if (!name) throw new HttpError(400, "請輸入姓名");
  if (name.length > 50) throw new HttpError(400, "姓名不可超過 50 個字");
  if (!/^\+?[\d\s-]{6,20}$/.test(phone)) {
    throw new HttpError(400, "手機號格式不正確，只可包含數字、空格、+ 或 -");
  }
  const points = rawPoints === "" || rawPoints === undefined || rawPoints === null ? 0 : Number(rawPoints);
  if (!Number.isFinite(points) || Math.abs(points) >= 1e11) throw new HttpError(400, "積分必須是數字");
  return { name, phone, phoneNormalized: normPhone(phone), points: round2(points) };
}

export function validDelta(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) >= 1e11) throw new HttpError(400, "請輸入不是 0 的分數");
  return round2(n);
}

export function validId(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, "找不到這筆資料");
  return n;
}

// ---------- Sit and Go rewards ----------

export const REWARD_OPTIONS = ["盲盒", "20000積分", "10000積分"] as const;

export function validReward(v: unknown, label = ""): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!(REWARD_OPTIONS as readonly string[]).includes(s)) {
    throw new HttpError(400, `${label}獎勵只可以選擇：${REWARD_OPTIONS.join("、")}`);
  }
  return s;
}
