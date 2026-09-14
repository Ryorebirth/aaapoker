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
  REWARD_OPTIONS,
  dayStart,
  defaultMonthStart,
  defaultYearStart,
  validDate,
  validReward,
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
    if (count > 0) throw new HttpError(409, "系统已经设定好管理员，请直接登入");
    const [admin] = await query(
      `INSERT INTO admins (username, password_hash, last_login_at) VALUES ($1, $2, NOW()) RETURNING id, username`,
      [username, passwordHash]
    );
    const token = await createSession(query, admin.id);
    await log(query, { action: "admin_create", admin: username, detail: `建立第一个管理员 ${username}` });
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
    throw new HttpError(401, "帐号或密码不正确");
  }
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(admin.locked_until).getTime() - Date.now()) / 60000));
    throw new HttpError(429, `登入失败次数太多，请 ${mins} 分钟后再试`);
  }
  if (!verifyPassword(password, admin.password_hash)) {
    const fails = admin.failed_attempts + 1;
    if (fails >= MAX_FAILED_LOGINS) {
      await q(
        `UPDATE admins SET failed_attempts = 0, locked_until = NOW() + ($1 || ' minutes')::interval WHERE id = $2`,
        [String(LOCK_MINUTES), admin.id]
      );
      throw new HttpError(429, `登入失败次数太多，帐号已暂时锁定 ${LOCK_MINUTES} 分钟`);
    }
    await q(`UPDATE admins SET failed_attempts = $1 WHERE id = $2`, [fails, admin.id]);
    throw new HttpError(401, "帐号或密码不正确");
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
  return json({ title: setting?.value ?? "扑克积分排行榜", players: rows.map(toPlayer) });
}

async function duplicateMessage(query: Query, phoneNormalized: string, excludeId?: number) {
  const rows = await query(
    `SELECT name FROM players WHERE phone_normalized = $1 AND ($2::int IS NULL OR id <> $2::int)`,
    [phoneNormalized, excludeId ?? null]
  );
  return rows[0] ? `这个手机号已登记给「${rows[0].name}」` : null;
}

async function createPlayer(req: Request, admin: Admin) {
  const p = validPlayer(await readJson(req));
  const result = await tx(async (query) => {
    const [existing] = await query(`SELECT * FROM players WHERE phone_normalized = $1 FOR UPDATE`, [
      p.phoneNormalized,
    ]);
    if (existing && existing.in_cash) {
      throw new HttpError(409, `这个手机号已登记给「${existing.name}」，请在排名中直接加减分`);
    }
    let row;
    let detail: string | null = null;
    if (existing) {
      // Player already registered through Sit and Go: add them to 常规赛
      [row] = await query(
        `UPDATE players SET in_cash = TRUE, points = $1, updated_at = NOW(), updated_by = $2
          WHERE id = $3 RETURNING *`,
        [p.points, admin.username, existing.id]
      );
      detail =
        "已在 Sit and Go 登记的玩家加入常规赛" +
        (existing.name !== p.name ? `（沿用已登记姓名「${existing.name}」）` : "");
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
    if (!old) throw new HttpError(404, "找不到这位玩家，可能已被删除");
    const dup = await duplicateMessage(query, p.phoneNormalized, id);
    if (dup) throw new HttpError(409, dup);
    const oldPoints = Number(old.points);
    const newPoints = keepPoints ? oldPoints : p.points;
    const changes: string[] = [];
    if (old.name !== p.name) changes.push(`姓名 ${old.name} → ${p.name}`);
    if (old.phone !== p.phone) changes.push(`手机号 ${old.phone} → ${p.phone}`);
    if (oldPoints !== newPoints) changes.push(`积分 ${oldPoints} → ${newPoints}`);
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
    if (!row) throw new HttpError(404, "找不到这位玩家，可能已被删除");
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
    if (!row) throw new HttpError(404, "找不到这位玩家，可能已被删除");
    const [{ count }] = await query(`SELECT COUNT(*)::int AS count FROM sng_results WHERE player_id = $1`, [id]);
    if (count > 0) {
      // Keep the player (and their Sit and Go results), only remove from 常规赛
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
      detail: count > 0 ? "从常规赛移除，保留 Sit and Go 纪录" : null,
    });
    return { removedFromCashOnly: count > 0 };
  });
  return json({ ok: true, ...result });
}

// ---------- Sit and Go ----------

const PLACE_LABEL: Record<number, string> = { 1: "第 1 名", 2: "第 2 名", 3: "第 3 名" };

/** since = YYYY-MM-DD (a Hong Kong day) or null for all time. */
async function sngStandings(query: Query, since: string | null = null) {
  const rows = await query(
    `SELECT p.id, p.name, p.phone,
            COUNT(*) FILTER (WHERE r.place = 1)::int AS firsts,
            COUNT(*) FILTER (WHERE r.place = 2)::int AS seconds,
            COUNT(*) FILTER (WHERE r.place = 3)::int AS thirds,
            MAX(g.created_at) AS last_at
       FROM sng_results r
       JOIN players p ON p.id = r.player_id
       JOIN sng_games g ON g.id = r.game_id
      WHERE ($1::timestamptz IS NULL OR g.created_at >= $1::timestamptz)
      GROUP BY p.id, p.name, p.phone
      ORDER BY firsts DESC, seconds DESC, thirds DESC, p.name ASC`,
    [since ? dayStart(since) : null]
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

async function sngPeriods(query: Query) {
  const rows = await query(
    `SELECT key, value FROM settings WHERE key IN ('sng_month_start', 'sng_year_start')`
  );
  const map: Record<string, string> = {};
  rows.forEach((r) => (map[r.key] = r.value));
  return {
    monthStart: map.sng_month_start || defaultMonthStart(),
    yearStart: map.sng_year_start || defaultYearStart(),
  };
}

async function sngGameCount(query: Query, since: string | null) {
  const [row] = await query(
    `SELECT COUNT(*)::int AS count FROM sng_games
      WHERE ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)`,
    [since ? dayStart(since) : null]
  );
  return row.count as number;
}

async function listSng(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 1000);
  const periods = await sngPeriods(q);
  const [standings, monthStandings, yearStandings] = await Promise.all([
    sngStandings(q),
    sngStandings(q, periods.monthStart),
    sngStandings(q, periods.yearStart),
  ]);
  const games = await q(
    `SELECT g.id, g.title, g.created_by, g.created_at,
            COALESCE(
              json_agg(json_build_object('place', r.place, 'playerId', p.id, 'name', p.name, 'phone', p.phone,
                                         'reward', r.reward, 'rewardUsedAt', r.reward_used_at,
                                         'rewardUsedBy', r.reward_used_by)
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
  const [monthGames, yearGames] = await Promise.all([
    sngGameCount(q, periods.monthStart),
    sngGameCount(q, periods.yearStart),
  ]);
  return json({
    standings,
    monthStandings,
    yearStandings,
    periods: { ...periods, monthGames, yearGames },
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
  const entries: { place: number; name: string; phone: string; phoneNormalized: string; reward: string | null }[] = [];

  for (const item of raw) {
    const place = Number((item as any)?.place);
    if (![1, 2, 3].includes(place)) throw new HttpError(400, "名次只可以是第 1、2 或 3 名");
    const name = String((item as any)?.name ?? "").trim();
    const phone = String((item as any)?.phone ?? "").trim();
    const label = PLACE_LABEL[place];
    const reward = validReward((item as any)?.reward, `${label}：`);
    if (!name && !phone) {
      if (reward) throw new HttpError(400, `${label}：选择奖励前请先输入玩家姓名和手机号`);
      continue;
    }
    if (!name) throw new HttpError(400, `${label}：请输入姓名`);
    if (name.length > 50) throw new HttpError(400, `${label}：姓名不可超过 50 个字`);
    if (!/^\+?[\d\s-]{6,20}$/.test(phone)) throw new HttpError(400, `${label}：手机号格式不正确`);
    entries.push({ place, name, phone, phoneNormalized: normPhone(phone), reward });
  }

  const places = entries.map((e) => e.place);
  if (new Set(places).size !== places.length) throw new HttpError(400, "每个名次只可以有一位玩家");
  if (new Set(entries.map((e) => e.phoneNormalized)).size !== entries.length) {
    throw new HttpError(400, "同一个手机号不可以同时拿两个名次");
  }
  entries.sort((a, b) => a.place - b.place);

  const result = await tx(async (query) => {
    const [game] = await query(
      `INSERT INTO sng_games (title, created_by) VALUES ($1, $2) RETURNING *`,
      [title, admin.username]
    );
    const gameLabel = title || `第 ${game.id} 场`;
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
        note = `（手机号已登记为「${player.name}」，沿用登记姓名）`;
        notices.push(`${PLACE_LABEL[e.place]}的手机号已登记为「${player.name}」，已沿用登记姓名`);
      }
      await query(`INSERT INTO sng_results (game_id, player_id, place, reward) VALUES ($1, $2, $3, $4)`, [
        game.id,
        player.id,
        e.place,
        e.reward,
      ]);
      await log(query, {
        action: "sng_result",
        board: "sng",
        admin: admin.username,
        playerId: player.id,
        playerName: player.name,
        playerPhone: player.phone,
        detail: `${gameLabel} ${PLACE_LABEL[e.place]}${e.reward ? `　奖励：${e.reward}` : ""}${note}`,
      });
      results.push({ place: e.place, playerId: player.id, name: player.name, phone: player.phone, reward: e.reward });
    }
    return {
      game: { id: game.id, title: game.title, createdBy: game.created_by, createdAt: game.created_at, results },
      notices,
    };
  });
  return json(result, 201);
}

async function updateSngReward(req: Request, admin: Admin, gameId: number, place: number) {
  if (![1, 2, 3].includes(place)) throw new HttpError(404, "找不到这个名次");
  const body = await readJson(req);
  const reward = validReward(body.reward);
  const result = await tx(async (query) => {
    const [row] = await query(
      `SELECT r.reward, r.reward_used_at, g.id AS game_id, g.title, p.id AS player_id, p.name, p.phone
         FROM sng_results r
         JOIN sng_games g ON g.id = r.game_id
         JOIN players p ON p.id = r.player_id
        WHERE r.game_id = $1 AND r.place = $2
        FOR UPDATE OF r`,
      [gameId, place]
    );
    if (!row) throw new HttpError(404, "找不到这个名次的赛果，可能已被删除");
    const next = reward;
    if ((row.reward ?? null) === next) return { reward: next };
    if (row.reward_used_at) {
      throw new HttpError(409, "这个奖励已经使用，请先在奖励纪录表取消使用，才可以修改");
    }
    await query(`UPDATE sng_results SET reward = $1 WHERE game_id = $2 AND place = $3`, [next, gameId, place]);
    const gameLabel = row.title || `第 ${row.game_id} 场`;
    await log(query, {
      action: "sng_reward",
      board: "sng",
      admin: admin.username,
      playerId: row.player_id,
      playerName: row.name,
      playerPhone: row.phone,
      detail: `${gameLabel} ${PLACE_LABEL[place]} 奖励：${row.reward || "（未填）"} → ${next || "（未填）"}`,
    });
    return { reward: next };
  });
  return json(result);
}

// ---------- Reward ledger ----------

async function listRewards() {
  const holders = await q(
    `SELECT r.reward, p.id, p.name, p.phone,
            COUNT(*) FILTER (WHERE r.reward_used_at IS NULL)::int AS available,
            COUNT(*) FILTER (WHERE r.reward_used_at IS NOT NULL)::int AS used,
            MAX(g.created_at) AS last_won_at
       FROM sng_results r
       JOIN players p ON p.id = r.player_id
       JOIN sng_games g ON g.id = r.game_id
      WHERE r.reward IS NOT NULL
      GROUP BY r.reward, p.id, p.name, p.phone
      ORDER BY r.reward, available DESC, p.name`
  );
  const history = await q(
    `SELECT r.game_id, r.place, r.reward, r.reward_used_at, r.reward_used_by,
            p.id AS player_id, p.name, p.phone, g.title, g.created_at AS game_at
       FROM sng_results r
       JOIN players p ON p.id = r.player_id
       JOIN sng_games g ON g.id = r.game_id
      WHERE r.reward IS NOT NULL AND r.reward_used_at IS NOT NULL
      ORDER BY r.reward_used_at DESC
      LIMIT 300`
  );
  const types = [...REWARD_OPTIONS] as string[];
  holders.forEach((h) => {
    if (!types.includes(h.reward)) types.push(h.reward);
  });
  return json({
    options: REWARD_OPTIONS,
    rewards: types.map((type) => {
      const list = holders.filter((h) => h.reward === type);
      return {
        reward: type,
        available: list.reduce((n, h) => n + h.available, 0),
        used: list.reduce((n, h) => n + h.used, 0),
        holders: list.map((h) => ({
          playerId: h.id,
          name: h.name,
          phone: h.phone,
          available: h.available,
          used: h.used,
          lastWonAt: h.last_won_at,
        })),
      };
    }),
    history: history.map((h) => ({
      gameId: h.game_id,
      place: h.place,
      reward: h.reward,
      usedAt: h.reward_used_at,
      usedBy: h.reward_used_by,
      playerId: h.player_id,
      name: h.name,
      phone: h.phone,
      gameTitle: h.title || `第 ${h.game_id} 场`,
      gameAt: h.game_at,
    })),
  });
}

async function useReward(req: Request, admin: Admin) {
  const body = await readJson(req);
  const playerId = validId(String(body.playerId ?? ""));
  const reward = String(body.reward ?? "").trim();
  if (!reward) throw new HttpError(400, "请选择奖励");
  const result = await tx(async (query) => {
    // Use the oldest unused reward of this type first
    const [item] = await query(
      `SELECT r.game_id, r.place, g.title, p.name, p.phone
         FROM sng_results r
         JOIN sng_games g ON g.id = r.game_id
         JOIN players p ON p.id = r.player_id
        WHERE r.player_id = $1 AND r.reward = $2 AND r.reward_used_at IS NULL
        ORDER BY g.created_at ASC, r.game_id ASC
        LIMIT 1
        FOR UPDATE OF r`,
      [playerId, reward]
    );
    if (!item) throw new HttpError(409, `这位玩家已经没有未使用的「${reward}」`);
    await query(
      `UPDATE sng_results SET reward_used_at = NOW(), reward_used_by = $1 WHERE game_id = $2 AND place = $3`,
      [admin.username, item.game_id, item.place]
    );
    const [{ left }] = await query(
      `SELECT COUNT(*)::int AS left FROM sng_results
        WHERE player_id = $1 AND reward = $2 AND reward_used_at IS NULL`,
      [playerId, reward]
    );
    const gameLabel = item.title || `第 ${item.game_id} 场`;
    await log(query, {
      action: "reward_use",
      board: "sng",
      admin: admin.username,
      playerId,
      playerName: item.name,
      playerPhone: item.phone,
      detail: `使用「${reward}」（来自 ${gameLabel} ${PLACE_LABEL[item.place]}），尚余 ${left} 个`,
    });
    return { name: item.name, reward, left, gameId: item.game_id, place: item.place };
  });
  return json(result);
}

async function undoReward(req: Request, admin: Admin) {
  const body = await readJson(req);
  const gameId = validId(String(body.gameId ?? ""));
  const place = Number(body.place);
  if (![1, 2, 3].includes(place)) throw new HttpError(404, "找不到这个名次");
  const result = await tx(async (query) => {
    const [item] = await query(
      `SELECT r.reward, r.reward_used_at, g.title, p.id AS player_id, p.name, p.phone
         FROM sng_results r
         JOIN sng_games g ON g.id = r.game_id
         JOIN players p ON p.id = r.player_id
        WHERE r.game_id = $1 AND r.place = $2
        FOR UPDATE OF r`,
      [gameId, place]
    );
    if (!item || !item.reward) throw new HttpError(404, "找不到这个奖励，可能已被删除");
    if (!item.reward_used_at) throw new HttpError(409, "这个奖励本来就未使用");
    await query(
      `UPDATE sng_results SET reward_used_at = NULL, reward_used_by = NULL WHERE game_id = $1 AND place = $2`,
      [gameId, place]
    );
    const gameLabel = item.title || `第 ${gameId} 场`;
    await log(query, {
      action: "reward_undo",
      board: "sng",
      admin: admin.username,
      playerId: item.player_id,
      playerName: item.name,
      playerPhone: item.phone,
      detail: `取消使用「${item.reward}」（${gameLabel} ${PLACE_LABEL[place]}）`,
    });
    return { name: item.name, reward: item.reward };
  });
  return json(result);
}

async function deleteSngGame(admin: Admin, id: number) {
  await tx(async (query) => {
    const [game] = await query(`SELECT * FROM sng_games WHERE id = $1 FOR UPDATE`, [id]);
    if (!game) throw new HttpError(404, "找不到这场赛果，可能已被删除");
    const results = await query(
      `SELECT r.place, r.reward, r.reward_used_at, p.id, p.name, p.phone FROM sng_results r JOIN players p ON p.id = r.player_id
        WHERE r.game_id = $1 ORDER BY r.place`,
      [id]
    );
    await query(`DELETE FROM sng_games WHERE id = $1`, [id]);
    const gameLabel = game.title || `第 ${game.id} 场`;
    for (const r of results) {
      await log(query, {
        action: "sng_delete",
        board: "sng",
        admin: admin.username,
        playerId: r.id,
        playerName: r.name,
        playerPhone: r.phone,
        detail: `删除 ${gameLabel} ${PLACE_LABEL[r.place]}${
          r.reward ? `（奖励：${r.reward}${r.reward_used_at ? "，已使用" : "，未使用"}）` : ""
        }`,
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
  if (!list.length) throw new HttpError(400, "没有可汇入的玩家");
  const result = await tx(async (query) => {
    let imported = 0;
    const skipped: string[] = [];
    for (const item of list) {
      let p;
      try {
        p = validPlayer(item as Record<string, unknown>);
      } catch {
        skipped.push(String((item as any)?.name ?? "（资料不完整）"));
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
        detail: "从浏览器旧资料汇入",
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

  // Each field is optional, so the title form and the period form can post separately
  const updates: { key: string; value: string; action: string; label: string }[] = [];
  if (body.title !== undefined) {
    updates.push({
      key: "title",
      value: String(body.title).trim().slice(0, 60) || "扑克积分排行榜",
      action: "title_change",
      label: "排行榜名称",
    });
  }
  if (body.sngMonthStart !== undefined) {
    updates.push({
      key: "sng_month_start",
      value: validDate(body.sngMonthStart, "月度起计日期"),
      action: "sng_period",
      label: "Sit and Go 月度起计日期",
    });
  }
  if (body.sngYearStart !== undefined) {
    updates.push({
      key: "sng_year_start",
      value: validDate(body.sngYearStart, "年度起计日期"),
      action: "sng_period",
      label: "Sit and Go 年度起计日期",
    });
  }
  if (!updates.length) throw new HttpError(400, "没有要更新的设定");

  const result = await tx(async (query) => {
    for (const u of updates) {
      const [old] = await query(`SELECT value FROM settings WHERE key = $1`, [u.key]);
      if (old?.value === u.value) continue;
      await query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [u.key, u.value]
      );
      await log(query, {
        action: u.action,
        board: u.action === "sng_period" ? "sng" : null,
        admin: admin.username,
        detail: `${u.label}：${old?.value ?? "（未设定）"} → ${u.value}`,
      });
    }
    const [title] = await query(`SELECT value FROM settings WHERE key = 'title'`);
    return { title: title?.value ?? "扑克积分排行榜", periods: await sngPeriods(query) };
  });
  return json(result);
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
    if (exists.length) throw new HttpError(409, "这个帐号名称已被使用");
    const [row] = await query(
      `INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at`,
      [username, passwordHash]
    );
    await log(query, { action: "admin_create", admin: admin.username, detail: `新增管理员 ${username}` });
    return row;
  });
  return json({ admin: { id: created.id, username: created.username, createdAt: created.created_at } }, 201);
}

async function deleteAdmin(admin: Admin, id: number) {
  if (id === admin.id) throw new HttpError(400, "不可以删除自己正在使用的帐号");
  await tx(async (query) => {
    const [row] = await query(`DELETE FROM admins WHERE id = $1 RETURNING username`, [id]);
    if (!row) throw new HttpError(404, "找不到这个管理员");
    await log(query, { action: "admin_delete", admin: admin.username, detail: `删除管理员 ${row.username}` });
  });
  return json({ ok: true });
}

async function changePassword(req: Request, admin: Admin) {
  const body = await readJson(req);
  const current = String(body.currentPassword ?? "");
  const next = validPassword(body.newPassword);
  const [row] = await q(`SELECT password_hash FROM admins WHERE id = $1`, [admin.id]);
  if (!row || !verifyPassword(current, row.password_hash)) {
    throw new HttpError(400, "目前密码不正确");
  }
  const token = getCookie(req, SESSION_COOKIE) || "";
  await tx(async (query) => {
    await query(`UPDATE admins SET password_hash = $1 WHERE id = $2`, [hashPassword(next), admin.id]);
    // Sign out this admin's other devices
    await query(`DELETE FROM sessions WHERE admin_id = $1 AND token_hash <> $2`, [admin.id, sha256(token)]);
    await log(query, { action: "password_change", admin: admin.username, detail: "修改自己的密码" });
  });
  return json({ ok: true });
}

// ---------- Public board ----------

async function board() {
  const rows = await q(
    `SELECT id, name, phone, points, updated_at FROM players WHERE in_cash ORDER BY points DESC, name ASC`
  );
  const periods = await sngPeriods(q);
  const [standings, monthStandings, yearStandings] = await Promise.all([
    sngStandings(q),
    sngStandings(q, periods.monthStart),
    sngStandings(q, periods.yearStart),
  ]);
  const [{ count }] = await q(`SELECT COUNT(*)::int AS count FROM sng_games`);
  const [monthGames, yearGames] = await Promise.all([
    sngGameCount(q, periods.monthStart),
    sngGameCount(q, periods.yearStart),
  ]);
  const [setting] = await q(`SELECT value FROM settings WHERE key = 'title'`);
  const publicRow = (s: any) => ({
    id: s.id,
    name: s.name,
    phoneMasked: maskPhone(s.phone),
    firsts: s.firsts,
    seconds: s.seconds,
    thirds: s.thirds,
    lastAt: s.lastAt,
  });
  return json({
    title: setting?.value ?? "扑克积分排行榜",
    players: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phoneMasked: maskPhone(r.phone),
      points: Number(r.points),
      updatedAt: r.updated_at,
    })),
    sng: standings.map(publicRow),
    sngMonth: monthStandings.map(publicRow),
    sngYear: yearStandings.map(publicRow),
    periods: { ...periods, monthGames, yearGames },
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
      throw new HttpError(415, "请求格式不正确");
    }

    // Public routes
    if (path === "/board" && method === "GET") return await board();
    if (path === "/auth/status" && method === "GET") return await authStatus(req);
    if (path === "/auth/setup" && method === "POST") return await setup(req);
    if (path === "/auth/login" && method === "POST") return await login(req);
    if (path === "/auth/logout" && method === "POST") return await logout(req);

    // Everything below requires an admin session
    const admin = await currentAdmin(req);
    if (!admin) throw new HttpError(401, "登入已过期，请重新登入");

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
      if (seg.length === 5 && seg[1] === "games" && seg[3] === "results" && method === "PATCH") {
        return await updateSngReward(req, admin, validId(seg[2]), Number(seg[4]));
      }
      if (seg.length === 3 && seg[1] === "games" && method === "DELETE") {
        return await deleteSngGame(admin, validId(seg[2]));
      }
    }
    if (path === "/rewards" && method === "GET") return await listRewards();
    if (path === "/rewards/use" && method === "POST") return await useReward(req, admin);
    if (path === "/rewards/undo" && method === "POST") return await undoReward(req, admin);
    if (path === "/logs" && method === "GET") return await listLogs(url);
    if (path === "/settings" && method === "PUT") return await updateSettings(req, admin);
    if (seg[0] === "admins") {
      if (seg.length === 1 && method === "GET") return await listAdmins();
      if (seg.length === 1 && method === "POST") return await createAdmin(req, admin);
      if (path === "/admins/me/password" && method === "POST") return await changePassword(req, admin);
      if (seg.length === 2 && method === "DELETE") return await deleteAdmin(admin, validId(seg[1]));
    }

    throw new HttpError(404, "找不到这个功能");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if ((e as any)?.code === "23505") return json({ error: "资料重复，请检查手机号或帐号名称" }, 409);
    console.error(e);
    return json({ error: "伺服器发生错误，请稍后再试" }, 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
