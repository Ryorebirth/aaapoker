import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import {
  HttpError,
  LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  SESSION_COOKIE,
  SESSION_DAYS,
  clearSessionCookie,
  getCookie,
  getDummyHash,
  hashPassword,
  json,
  maskPhone,
  newSessionToken,
  readJson,
  sessionCookie,
  sha256,
  validDelta,
  validId,
  validPassword,
  validPlayer,
  validUsername,
  verifyPassword,
} from "../lib/helpers.mts";

type Db = ReturnType<typeof getDatabase>;
type Query = (text: string, params?: unknown[]) => Promise<any[]>;
type Admin = { id: number; username: string };

let cachedDb: Db | null = null;
function db(): Db {
  if (!cachedDb) cachedDb = getDatabase();
  return cachedDb;
}

const q: Query = async (text, params = []) => (await db().pool.query(text, params)).rows;

async function tx<T>(fn: (query: Query) => Promise<T>): Promise<T> {
  const client = await db().pool.connect();
  const query: Query = async (text, params = []) => (await client.query(text, params)).rows;
  try {
    await client.query("BEGIN");
    const result = await fn(query);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------- Row mappers ----------

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toPlayer(r: any) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    points: Number(r.points),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
  };
}

function toLog(r: any) {
  return {
    id: Number(r.id),
    action: r.action,
    playerId: r.player_id,
    playerName: r.player_name,
    playerPhone: r.player_phone,
    delta: num(r.delta),
    pointsBefore: num(r.points_before),
    pointsAfter: num(r.points_after),
    detail: r.detail,
    adminUsername: r.admin_username,
    createdAt: r.created_at,
  };
}

async function log(query: Query, entry: {
  action: string;
  admin: string;
  playerId?: number | null;
  playerName?: string | null;
  playerPhone?: string | null;
  delta?: number | null;
  before?: number | null;
  after?: number | null;
  detail?: string | null;
}) {
  await query(
    `INSERT INTO activity_logs
       (action, player_id, player_name, player_phone, delta, points_before, points_after, detail, admin_username)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.action,
      entry.playerId ?? null,
      entry.playerName ?? null,
      entry.playerPhone ?? null,
      entry.delta ?? null,
      entry.before ?? null,
      entry.after ?? null,
      entry.detail ?? null,
      entry.admin,
    ]
  );
}

// ---------- Auth ----------

async function currentAdmin(req: Request): Promise<Admin | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const rows = await q(
    `SELECT a.id, a.username
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [sha256(token)]
  );
  return rows[0] ? { id: rows[0].id, username: rows[0].username } : null;
}

async function createSession(query: Query, adminId: number): Promise<string> {
  const token = newSessionToken();
  await query(
    `INSERT INTO sessions (token_hash, admin_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' days')::interval)`,
    [sha256(token), adminId, String(SESSION_DAYS)]
  );
  return token;
}

async function authStatus(req: Request) {
  const [{ count }] = await q(`SELECT COUNT(*)::int AS count FROM admins`);
  const admin = count > 0 ? await currentAdmin(req) : null;
  return json({ needsSetup: count === 0, admin });
}

async function setup(req: Request) {
  const body = await readJson(req);
  const username = validUsername(body.username);
  const password = validPassword(body.password);
  const passwordHash = hashPassword(password);
  const result = await tx(async (query) => {
    await query(`LOCK TABLE admins IN EXCLUSIVE MODE`);
    const [{ count }] = await query(`SELECT COUNT(*)::int AS count FROM admins`);
    if (count > 0) throw new HttpError(409, "系統已經設定好管理員，請直接登入");
    const [admin] = await query(
      `INSERT INTO admins (username, password_hash, last_login_at) VALUES ($1, $2, NOW()) RETURNING id, username`,
      [username, passwordHash]
    );
    const token = await createSession(query, admin.id);
    await log(query, { action: "admin_create", admin: username, detail: `建立第一個管理員 ${username}` });
    return { admin, token };
  });
  return json({ admin: result.admin }, 201, { "Set-Cookie": sessionCookie(result.token) });
}

async function login(req: Request) {
  const body = await readJson(req);
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const [admin] = await q(
    `SELECT id, username, password_hash, failed_attempts, locked_until FROM admins WHERE LOWER(username) = LOWER($1)`,
    [username]
  );
  if (!admin) {
    verifyPassword(password, getDummyHash());
    throw new HttpError(401, "帳號或密碼不正確");
  }
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(admin.locked_until).getTime() - Date.now()) / 60000));
    throw new HttpError(429, `登入失敗次數太多，請 ${mins} 分鐘後再試`);
  }
  if (!verifyPassword(password, admin.password_hash)) {
    const fails = admin.failed_attempts + 1;
    if (fails >= MAX_FAILED_LOGINS) {
      await q(
        `UPDATE admins SET failed_attempts = 0, locked_until = NOW() + ($1 || ' minutes')::interval WHERE id = $2`,
        [String(LOCK_MINUTES), admin.id]
      );
      throw new HttpError(429, `登入失敗次數太多，帳號已暫時鎖定 ${LOCK_MINUTES} 分鐘`);
    }
    await q(`UPDATE admins SET failed_attempts = $1 WHERE id = $2`, [fails, admin.id]);
    throw new HttpError(401, "帳號或密碼不正確");
  }
  const token = await tx(async (query) => {
    await query(`DELETE FROM sessions WHERE expires_at < NOW()`);
    await query(
      `UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1`,
      [admin.id]
    );
    await log(query, { action: "login", admin: admin.username });
    return createSession(query, admin.id);
  });
  return json({ admin: { id: admin.id, username: admin.username } }, 200, {
    "Set-Cookie": sessionCookie(token),
  });
}

async function logout(req: Request) {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await q(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

// ---------- Players ----------

async function listPlayers() {
  const rows = await q(`SELECT * FROM players ORDER BY points DESC, name ASC`);
  const [setting] = await q(`SELECT value FROM settings WHERE key = 'title'`);
  return json({ title: setting?.value ?? "撲克積分排行榜", players: rows.map(toPlayer) });
}

async function duplicateMessage(query: Query, phoneNormalized: string, excludeId?: number) {
  const rows = await query(
    `SELECT name FROM players WHERE phone_normalized = $1 AND ($2::int IS NULL OR id <> $2::int)`,
    [phoneNormalized, excludeId ?? null]
  );
  return rows[0] ? `這個手機號已登記給「${rows[0].name}」` : null;
}

async function createPlayer(req: Request, admin: Admin) {
  const p = validPlayer(await readJson(req));
  const player = await tx(async (query) => {
    const dup = await duplicateMessage(query, p.phoneNormalized);
    if (dup) throw new HttpError(409, `${dup}，請在排名中直接加減分`);
    const [row] = await query(
      `INSERT INTO players (name, phone, phone_normalized, points, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
      [p.name, p.phone, p.phoneNormalized, p.points, admin.username]
    );
    await log(query, {
      action: "create",
      admin: admin.username,
      playerId: row.id,
      playerName: row.name,
      playerPhone: row.phone,
      delta: p.points,
      before: 0,
      after: Number(row.points),
    });
    return row;
  });
  return json({ player: toPlayer(player) }, 201);
}

async function editPlayer(req: Request, admin: Admin, id: number) {
  const p = validPlayer(await readJson(req));
  const player = await tx(async (query) => {
    const [old] = await query(`SELECT * FROM players WHERE id = $1 FOR UPDATE`, [id]);
    if (!old) throw new HttpError(404, "找不到這位玩家，可能已被刪除");
    const dup = await duplicateMessage(query, p.phoneNormalized, id);
    if (dup) throw new HttpError(409, dup);
    const oldPoints = Number(old.points);
    const changes: string[] = [];
    if (old.name !== p.name) changes.push(`姓名 ${old.name} → ${p.name}`);
    if (old.phone !== p.phone) changes.push(`手機號 ${old.phone} → ${p.phone}`);
    if (oldPoints !== p.points) changes.push(`積分 ${oldPoints} → ${p.points}`);
    if (!changes.length) return old;
    const [row] = await query(
      `UPDATE players SET name = $1, phone = $2, phone_normalized = $3, points = $4,
              updated_at = NOW(), updated_by = $5
        WHERE id = $6 RETURNING *`,
      [p.name, p.phone, p.phoneNormalized, p.points, admin.username, id]
    );
    await log(query, {
      action: "edit",
      admin: admin.username,
      playerId: id,
      playerName: row.name,
      playerPhone: row.phone,
      delta: Math.round((p.points - oldPoints) * 100) / 100,
      before: oldPoints,
      after: Number(row.points),
      detail: changes.join("；"),
    });
    return row;
  });
  return json({ player: toPlayer(player) });
}

async function adjustPlayer(req: Request, admin: Admin, id: number) {
  const body = await readJson(req);
  const delta = validDelta(body.delta);
  const note = String(body.note ?? "").trim().slice(0, 200) || null;
  const player = await tx(async (query) => {
    const [row] = await query(
      `UPDATE players SET points = points + $1, updated_at = NOW(), updated_by = $2
        WHERE id = $3 RETURNING *`,
      [delta, admin.username, id]
    );
    if (!row) throw new HttpError(404, "找不到這位玩家，可能已被刪除");
    const after = Number(row.points);
    await log(query, {
      action: "adjust",
      admin: admin.username,
      playerId: id,
      playerName: row.name,
      playerPhone: row.phone,
      delta,
      before: Math.round((after - delta) * 100) / 100,
      after,
      detail: note,
    });
    return row;
  });
  return json({ player: toPlayer(player) });
}

async function deletePlayer(admin: Admin, id: number) {
  await tx(async (query) => {
    const [row] = await query(`DELETE FROM players WHERE id = $1 RETURNING *`, [id]);
    if (!row) throw new HttpError(404, "找不到這位玩家，可能已被刪除");
    await log(query, {
      action: "delete",
      admin: admin.username,
      playerId: id,
      playerName: row.name,
      playerPhone: row.phone,
      before: Number(row.points),
      after: null,
    });
  });
  return json({ ok: true });
}

async function importPlayers(req: Request, admin: Admin) {
  const body = await readJson(req);
  const list = Array.isArray(body.players) ? body.players.slice(0, 2000) : [];
  if (!list.length) throw new HttpError(400, "沒有可匯入的玩家");
  const result = await tx(async (query) => {
    let imported = 0;
    const skipped: string[] = [];
    for (const item of list) {
      let p;
      try {
        p = validPlayer(item as Record<string, unknown>);
      } catch {
        skipped.push(String((item as any)?.name ?? "（資料不完整）"));
        continue;
      }
      const createdAt = Number((item as any).createdAt) || Date.parse((item as any).createdAt) || null;
      const updatedAt = Number((item as any).updatedAt) || Date.parse((item as any).updatedAt) || createdAt;
      const rows = await query(
        `INSERT INTO players (name, phone, phone_normalized, points, created_at, updated_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4,
                 COALESCE(to_timestamp($5::double precision / 1000), NOW()),
                 COALESCE(to_timestamp($6::double precision / 1000), NOW()),
                 $7, $7)
         ON CONFLICT (phone_normalized) DO NOTHING
         RETURNING *`,
        [p.name, p.phone, p.phoneNormalized, p.points, createdAt, updatedAt, admin.username]
      );
      if (!rows[0]) {
        skipped.push(p.name);
        continue;
      }
      imported++;
      await log(query, {
        action: "import",
        admin: admin.username,
        playerId: rows[0].id,
        playerName: p.name,
        playerPhone: p.phone,
        delta: p.points,
        before: 0,
        after: p.points,
        detail: "從瀏覽器舊資料匯入",
      });
    }
    return { imported, skipped };
  });
  return json(result);
}

// ---------- Logs, settings, admins ----------

async function listLogs(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 300, 1), 1000);
  const playerId = Number(url.searchParams.get("playerId")) || null;
  const rows = await q(
    `SELECT * FROM activity_logs
      WHERE ($1::int IS NULL OR player_id = $1::int)
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [playerId, limit]
  );
  return json({ logs: rows.map(toLog), limit });
}

async function updateSettings(req: Request, admin: Admin) {
  const body = await readJson(req);
  const title = String(body.title ?? "").trim().slice(0, 60) || "撲克積分排行榜";
  await tx(async (query) => {
    const [old] = await query(`SELECT value FROM settings WHERE key = 'title'`);
    if (old?.value === title) return;
    await query(
      `INSERT INTO settings (key, value) VALUES ('title', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [title]
    );
    await log(query, {
      action: "title_change",
      admin: admin.username,
      detail: `${old?.value ?? ""} → ${title}`,
    });
  });
  return json({ title });
}

async function listAdmins() {
  const rows = await q(
    `SELECT id, username, created_at, last_login_at FROM admins ORDER BY created_at ASC`
  );
  return json({
    admins: rows.map((r) => ({
      id: r.id,
      username: r.username,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    })),
  });
}

async function createAdmin(req: Request, admin: Admin) {
  const body = await readJson(req);
  const username = validUsername(body.username);
  const password = validPassword(body.password);
  const passwordHash = hashPassword(password);
  const created = await tx(async (query) => {
    const exists = await query(`SELECT 1 FROM admins WHERE LOWER(username) = LOWER($1)`, [username]);
    if (exists.length) throw new HttpError(409, "這個帳號名稱已被使用");
    const [row] = await query(
      `INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at`,
      [username, passwordHash]
    );
    await log(query, { action: "admin_create", admin: admin.username, detail: `新增管理員 ${username}` });
    return row;
  });
  return json({ admin: { id: created.id, username: created.username, createdAt: created.created_at } }, 201);
}

async function deleteAdmin(admin: Admin, id: number) {
  if (id === admin.id) throw new HttpError(400, "不可以刪除自己正在使用的帳號");
  await tx(async (query) => {
    const [row] = await query(`DELETE FROM admins WHERE id = $1 RETURNING username`, [id]);
    if (!row) throw new HttpError(404, "找不到這個管理員");
    await log(query, { action: "admin_delete", admin: admin.username, detail: `刪除管理員 ${row.username}` });
  });
  return json({ ok: true });
}

async function changePassword(req: Request, admin: Admin) {
  const body = await readJson(req);
  const current = String(body.currentPassword ?? "");
  const next = validPassword(body.newPassword);
  const [row] = await q(`SELECT password_hash FROM admins WHERE id = $1`, [admin.id]);
  if (!row || !verifyPassword(current, row.password_hash)) {
    throw new HttpError(400, "目前密碼不正確");
  }
  const token = getCookie(req, SESSION_COOKIE) || "";
  await tx(async (query) => {
    await query(`UPDATE admins SET password_hash = $1 WHERE id = $2`, [hashPassword(next), admin.id]);
    // Sign out this admin's other devices
    await query(`DELETE FROM sessions WHERE admin_id = $1 AND token_hash <> $2`, [admin.id, sha256(token)]);
    await log(query, { action: "password_change", admin: admin.username, detail: "修改自己的密碼" });
  });
  return json({ ok: true });
}

// ---------- Public board ----------

async function board() {
  const rows = await q(
    `SELECT id, name, phone, points, updated_at FROM players ORDER BY points DESC, name ASC`
  );
  const [setting] = await q(`SELECT value FROM settings WHERE key = 'title'`);
  return json({
    title: setting?.value ?? "撲克積分排行榜",
    players: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phoneMasked: maskPhone(r.phone),
      points: Number(r.points),
      updatedAt: r.updated_at,
    })),
  });
}

// ---------- Router ----------

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();
  const seg = path.split("/").filter(Boolean);

  try {
    if (method !== "GET" && !(req.headers.get("content-type") || "").includes("application/json")) {
      throw new HttpError(415, "請求格式不正確");
    }

    // Public routes
    if (path === "/board" && method === "GET") return await board();
    if (path === "/auth/status" && method === "GET") return await authStatus(req);
    if (path === "/auth/setup" && method === "POST") return await setup(req);
    if (path === "/auth/login" && method === "POST") return await login(req);
    if (path === "/auth/logout" && method === "POST") return await logout(req);

    // Everything below requires an admin session
    const admin = await currentAdmin(req);
    if (!admin) throw new HttpError(401, "登入已過期，請重新登入");

    if (seg[0] === "players") {
      if (seg.length === 1 && method === "GET") return await listPlayers();
      if (seg.length === 1 && method === "POST") return await createPlayer(req, admin);
      if (seg.length === 2 && seg[1] === "import" && method === "POST") return await importPlayers(req, admin);
      if (seg.length === 2 && method === "PATCH") return await editPlayer(req, admin, validId(seg[1]));
      if (seg.length === 2 && method === "DELETE") return await deletePlayer(admin, validId(seg[1]));
      if (seg.length === 3 && seg[2] === "adjust" && method === "POST") {
        return await adjustPlayer(req, admin, validId(seg[1]));
      }
    }
    if (path === "/logs" && method === "GET") return await listLogs(url);
    if (path === "/settings" && method === "PUT") return await updateSettings(req, admin);
    if (seg[0] === "admins") {
      if (seg.length === 1 && method === "GET") return await listAdmins();
      if (seg.length === 1 && method === "POST") return await createAdmin(req, admin);
      if (path === "/admins/me/password" && method === "POST") return await changePassword(req, admin);
      if (seg.length === 2 && method === "DELETE") return await deleteAdmin(admin, validId(seg[1]));
    }

    throw new HttpError(404, "找不到這個功能");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if ((e as any)?.code === "23505") return json({ error: "資料重複，請檢查手機號或帳號名稱" }, 409);
    console.error(e);
    return json({ error: "伺服器發生錯誤，請稍後再試" }, 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
