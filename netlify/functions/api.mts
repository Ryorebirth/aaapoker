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
  normPhone,
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
    inCash: r.in_cash !== false,
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
    board: r.board ?? null,
    createdAt: r.created_at,
  };
}

async function log(query: Query, entry: {
  action: string;
  board?: "cash" | "sng" | null;
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
       (action, player_id, player_name, player_phone, delta, points_before, points_after, detail, admin_username, board)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
      entry.board ?? null,
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
  const result = await tx(async (query) => {
    const [existing] = await query(`SELECT * FROM players WHERE phone_normalized = $1 FOR UPDATE`, [
      p.phoneNormalized,
    ]);
    if (existing && existing.in_cash) {
      throw new HttpError(409, `這個手機號已登記給「${existing.name}」，請在排名中直接加減分`);
    }
    let row;
    let detail: string | null = null;
    if (existing) {
      // Player already registered through Sit and Go: add them to Cash Game
      [row] = await query(
        `UPDATE players SET in_cash = TRUE, points = $1, updated_at = NOW(), updated_by = $2
          WHERE id = $3 RETURNING *`,
        [p.points, admin.username, existing.id]
      );
      detail =
        "已在 Sit and Go 登記的玩家加入 Cash Game" +
        (existing.name !== p.name ? `（沿用已登記姓名「${existing.name}」）` : "");
    } else {
      [row] = await query(
        `INSERT INTO players (name, phone, phone_normalized, points, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
        [p.name, p.phone, p.phoneNormalized, p.points, admin.username]
      );
    }
    await log(query, {
      action: "create",
      board: "cash",
      admin: admin.username,
      playerId: row.id,
      playerName: row.name,
      playerPhone: row.phone,
      delta: p.points,
      before: 0,
      after: Number(row.points),
      detail,
    });
    return { row, joinedExisting: !!existing };
  });
  return json({ player: toPlayer(result.row), joinedExisting: result.joinedExisting }, 201);
}

async function editPlayer(req: Request, admin: Admin, id: number) {
  const body = await readJson(req);
  const keepPoints = body.points === undefined;
  const p = validPlayer(body);
  const board = body.board === "sng" ? "sng" : "cash";
  const player = await tx(async (query) => {
    const [old] = await query(`SELECT * FROM players WHERE id = $1 FOR UPDATE`, [id]);
    if (!old) throw new HttpError(404, "找不到這位玩家，可能已被刪除");
    const dup = await duplicateMessage(query, p.phoneNormalized, id);
    if (dup) throw new HttpError(409, dup);
    const oldPoints = Number(old.points);
    const newPoints = keepPoints ? oldPoints : p.points;
    const changes: string[] = [];
    if (old.name !== p.name) changes.push(`姓名 ${old.name} → ${p.name}`);
    if (old.phone !== p.phone) changes.push(`手機號 ${old.phone} → ${p.phone}`);
    if (oldPoints !== newPoints) changes.push(`積分 ${oldPoints} → ${newPoints}`);
    if (!changes.length) return old;
    const [row] = await query(
      `UPDATE players SET name = $1, phone = $2, phone_normalized = $3, points = $4,
              updated_at = NOW(), updated_by = $5
        WHERE id = $6 RETURNING *`,
      [p.name, p.phone, p.phoneNormalized, newPoints, admin.username, id]
    );
    await log(query, {
      action: "edit",
      board,
      admin: admin.username,
      playerId: id,
      playerName: row.name,
      playerPhone: row.phone,
      delta: oldPoints !== newPoints ? Math.round((newPoints - oldPoints) * 100) / 100 : null,
      before: oldPoints !== newPoints ? oldPoints : null,
      after: oldPoints !== newPoints ? Number(row.points) : null,
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
        WHERE id = $3 AND in_cash RETURNING *`,
      [delta, admin.username, id]
    );
    if (!row) throw new HttpError(404, "找不到這位玩家，可能已被刪除");
    const after = Number(row.points);
    await log(query, {
      action: "adjust",
      board: "cash",
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
  const result = await tx(async (query) => {
    const [row] = await query(`SELECT * FROM players WHERE id = $1 FOR UPDATE`, [id]);
    if (!row) throw new HttpError(404, "找不到這位玩家，可能已被刪除");
    const [{ count }] = await query(`SELECT COUNT(*)::int AS count FROM sng_results WHERE player_id = $1`, [id]);
    if (count > 0) {
      // Keep the player (and their Sit and Go results), only remove from Cash Game
      await query(
        `UPDATE players SET in_cash = FALSE, points = 0, updated_at = NOW(), updated_by = $1 WHERE id = $2`,
        [admin.username, id]
      );
    } else {
      await query(`DELETE FROM players WHERE id = $1`, [id]);
    }
    await log(query, {
      action: "delete",
      board: "cash",
      admin: admin.username,
      playerId: id,
      playerName: row.name,
      playerPhone: row.phone,
      before: Number(row.points),
      after: null,
      detail: count > 0 ? "從 Cash Game 移除，保留 Sit and Go 紀錄" : null,
    });
    return { removedFromCashOnly: count > 0 };
  });
  return json({ ok: true, ...result });
}

// ---------- Sit and Go ----------

const PLACE_LABEL: Record<number, string> = { 1: "第 1 名", 2: "第 2 名", 3: "第 3 名" };

async function sngStandings(query: Query) {
  const rows = await query(
    `SELECT p.id, p.name, p.phone,
            COUNT(*) FILTER (WHERE r.place = 1)::int AS firsts,
            COUNT(*) FILTER (WHERE r.place = 2)::int AS seconds,
            COUNT(*) FILTER (WHERE r.place = 3)::int AS thirds,
            MAX(g.created_at) AS last_at
       FROM sng_results r
       JOIN players p ON p.id = r.player_id
       JOIN sng_games g ON g.id = r.game_id
      GROUP BY p.id, p.name, p.phone
      ORDER BY firsts DESC, seconds DESC, thirds DESC, p.name ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    firsts: r.firsts,
    seconds: r.seconds,
    thirds: r.thirds,
    lastAt: r.last_at,
  }));
}

async function listSng(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 1000);
  const standings = await sngStandings(q);
  const games = await q(
    `SELECT g.id, g.title, g.created_by, g.created_at,
            COALESCE(
              json_agg(json_build_object('place', r.place, 'playerId', p.id, 'name', p.name, 'phone', p.phone)
                       ORDER BY r.place) FILTER (WHERE r.place IS NOT NULL),
              '[]'
            ) AS results
       FROM sng_games g
       LEFT JOIN sng_results r ON r.game_id = g.id
       LEFT JOIN players p ON p.id = r.player_id
      GROUP BY g.id
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT $1`,
    [limit]
  );
  const [{ count }] = await q(`SELECT COUNT(*)::int AS count FROM sng_games`);
  return json({
    standings,
    totalGames: count,
    games: games.map((g) => ({
      id: g.id,
      title: g.title,
      createdBy: g.created_by,
      createdAt: g.created_at,
      results: g.results,
    })),
  });
}

async function createSngGame(req: Request, admin: Admin) {
  const body = await readJson(req);
  const title = String(body.title ?? "").trim().slice(0, 60) || null;
  const raw = Array.isArray(body.results) ? body.results : [];
  const entries: { place: number; name: string; phone: string; phoneNormalized: string }[] = [];

  for (const item of raw) {
    const place = Number((item as any)?.place);
    if (![1, 2, 3].includes(place)) throw new HttpError(400, "名次只可以是第 1、2 或 3 名");
    const name = String((item as any)?.name ?? "").trim();
    const phone = String((item as any)?.phone ?? "").trim();
    if (!name && !phone) continue;
    const label = PLACE_LABEL[place];
    if (!name) throw new HttpError(400, `${label}：請輸入姓名`);
    if (name.length > 50) throw new HttpError(400, `${label}：姓名不可超過 50 個字`);
    if (!/^\+?[\d\s-]{6,20}$/.test(phone)) throw new HttpError(400, `${label}：手機號格式不正確`);
    entries.push({ place, name, phone, phoneNormalized: normPhone(phone) });
  }

  const places = entries.map((e) => e.place);
  if (!places.includes(1)) throw new HttpError(400, "請輸入第 1 名的姓名和手機號");
  if (new Set(places).size !== places.length) throw new HttpError(400, "每個名次只可以有一位玩家");
  if (places.includes(3) && !places.includes(2)) throw new HttpError(400, "請先輸入第 2 名");
  if (new Set(entries.map((e) => e.phoneNormalized)).size !== entries.length) {
    throw new HttpError(400, "同一個手機號不可以同時拿兩個名次");
  }
  entries.sort((a, b) => a.place - b.place);

  const result = await tx(async (query) => {
    const [game] = await query(
      `INSERT INTO sng_games (title, created_by) VALUES ($1, $2) RETURNING *`,
      [title, admin.username]
    );
    const gameLabel = title || `第 ${game.id} 場`;
    const notices: string[] = [];
    const results = [];
    for (const e of entries) {
      let [player] = await query(`SELECT * FROM players WHERE phone_normalized = $1 FOR UPDATE`, [
        e.phoneNormalized,
      ]);
      let note = "";
      if (!player) {
        [player] = await query(
          `INSERT INTO players (name, phone, phone_normalized, points, in_cash, created_by, updated_by)
           VALUES ($1, $2, $3, 0, FALSE, $4, $4) RETURNING *`,
          [e.name, e.phone, e.phoneNormalized, admin.username]
        );
      } else if (player.name !== e.name) {
        note = `（手機號已登記為「${player.name}」，沿用登記姓名）`;
        notices.push(`${PLACE_LABEL[e.place]}的手機號已登記為「${player.name}」，已沿用登記姓名`);
      }
      await query(`INSERT INTO sng_results (game_id, player_id, place) VALUES ($1, $2, $3)`, [
        game.id,
        player.id,
        e.place,
      ]);
      await log(query, {
        action: "sng_result",
        board: "sng",
        admin: admin.username,
        playerId: player.id,
        playerName: player.name,
        playerPhone: player.phone,
        detail: `${gameLabel} ${PLACE_LABEL[e.place]}${note}`,
      });
      results.push({ place: e.place, playerId: player.id, name: player.name, phone: player.phone });
    }
    return {
      game: { id: game.id, title: game.title, createdBy: game.created_by, createdAt: game.created_at, results },
      notices,
    };
  });
  return json(result, 201);
}

async function deleteSngGame(admin: Admin, id: number) {
  await tx(async (query) => {
    const [game] = await query(`SELECT * FROM sng_games WHERE id = $1 FOR UPDATE`, [id]);
    if (!game) throw new HttpError(404, "找不到這場賽果，可能已被刪除");
    const results = await query(
      `SELECT r.place, p.id, p.name, p.phone FROM sng_results r JOIN players p ON p.id = r.player_id
        WHERE r.game_id = $1 ORDER BY r.place`,
      [id]
    );
    await query(`DELETE FROM sng_games WHERE id = $1`, [id]);
    const gameLabel = game.title || `第 ${game.id} 場`;
    for (const r of results) {
      await log(query, {
        action: "sng_delete",
        board: "sng",
        admin: admin.username,
        playerId: r.id,
        playerName: r.name,
        playerPhone: r.phone,
        detail: `刪除 ${gameLabel} ${PLACE_LABEL[r.place]}`,
      });
    }
    // Remove players who were only in this Sit and Go and have no other records
    await query(
      `DELETE FROM players p
        WHERE p.id = ANY($1::int[]) AND NOT p.in_cash
          AND NOT EXISTS (SELECT 1 FROM sng_results r WHERE r.player_id = p.id)`,
      [results.map((r) => r.id)]
    );
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
        board: "cash",
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
    `SELECT id, name, phone, points, updated_at FROM players WHERE in_cash ORDER BY points DESC, name ASC`
  );
  const standings = await sngStandings(q);
  const [{ count }] = await q(`SELECT COUNT(*)::int AS count FROM sng_games`);
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
    sng: standings.map((s) => ({
      id: s.id,
      name: s.name,
      phoneMasked: maskPhone(s.phone),
      firsts: s.firsts,
      seconds: s.seconds,
      thirds: s.thirds,
      lastAt: s.lastAt,
    })),
    totalGames: count,
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
    if (seg[0] === "sng") {
      if (path === "/sng" && method === "GET") return await listSng(url);
      if (path === "/sng/games" && method === "POST") return await createSngGame(req, admin);
      if (seg.length === 3 && seg[1] === "games" && method === "DELETE") {
        return await deleteSngGame(admin, validId(seg[2]));
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
