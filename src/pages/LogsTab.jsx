import { useCallback, useEffect, useState } from "react";
import {
  C,
  btnPrimary,
  btnSecondary,
  downloadCSV,
  fmt,
  fmtDateTime,
  inputCls,
  normPhone,
  safeName,
  signed,
  today,
} from "../utils.js";

const ACTIONS = {
  create: "新增玩家",
  adjust: "加减分",
  edit: "修改资料",
  delete: "删除玩家",
  import: "汇入玩家",
  title_change: "修改名称",
  login: "登入",
  admin_create: "新增管理员",
  admin_delete: "删除管理员",
  password_change: "修改密码",
  sng_result: "记录赛果",
  sng_delete: "删除赛果",
  sng_reward: "修改奖励",
  reward_use: "使用奖励",
  reward_undo: "取消使用奖励",
  sng_period: "修改结算日期",
};

const FILTERS = [
  ["all", "全部"],
  ["cash", "常规赛"],
  ["sng", "Sit and Go"],
  ["admin", "帐号"],
];

function describe(l) {
  const parts = [];
  if (l.action === "adjust" || l.action === "create" || l.action === "import") {
    if (l.delta !== null) parts.push(`${signed(l.delta)} 分`);
  }
  if (l.action === "delete" && l.pointsBefore !== null) parts.push(`删除前 ${fmt(l.pointsBefore)} 分`);
  if (l.detail) parts.push(l.detail);
  return parts.join("　");
}

export default function LogsTab({ call, title }) {
  const [logs, setLogs] = useState([]);
  const [limit, setLimit] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call("/logs?limit=1000");
      setLogs(r.logs);
      setLimit(r.limit);
      setError("");
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const shown = logs.filter((l) => {
    if (filter === "cash" && l.board !== "cash") return false;
    if (filter === "sng" && l.board !== "sng") return false;
    if (filter === "admin" && l.board) return false;
    if (!q) return true;
    return (
      (l.playerName || "").toLowerCase().includes(q) ||
      (normPhone(q) && normPhone(l.playerPhone || "").includes(normPhone(q))) ||
      l.adminUsername.toLowerCase().includes(q) ||
      (l.detail || "").toLowerCase().includes(q)
    );
  });

  const exportLogs = () =>
    downloadCSV(
      `${safeName(title)}_修改纪录_${today()}.csv`,
      ["时间", "管理员", "计分器", "动作", "玩家", "手机号", "分数变化", "修改前积分", "修改后积分", "备注"],
      shown.map((l) => [
        fmtDateTime(l.createdAt),
        l.adminUsername,
        l.board === "cash" ? "常规赛" : l.board === "sng" ? "Sit and Go" : "",
        ACTIONS[l.action] || l.action,
        l.playerName || "",
        l.playerPhone ? `="${l.playerPhone}"` : "",
        l.delta ?? "",
        l.pointsBefore ?? "",
        l.pointsAfter ?? "",
        l.detail || "",
      ])
    );

  return (
    <section className="bg-white rounded-lg border" style={{ borderColor: C.line }} aria-labelledby="logs-heading">
      <div className="p-4 border-b flex flex-col gap-3" style={{ borderColor: C.line }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="logs-heading" className="text-lg font-bold">
              修改纪录
            </h2>
            <p className="text-xs" style={{ color: C.muted }}>
              常规赛 和 Sit and Go 的每次修改都会记录管理员和时间。显示最近 {limit} 笔。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className={btnSecondary}
              style={{ borderColor: C.line, color: C.ink }}
              onClick={load}
              disabled={loading}
            >
              {loading ? "载入中…" : "重新整理"}
            </button>
            <button
              className={btnPrimary}
              style={{ background: C.felt }}
              onClick={exportLogs}
              disabled={!shown.length}
            >
              汇出纪录
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={inputCls + " flex-1"}
            style={{ borderColor: C.line, minWidth: 180 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜寻玩家、手机号、管理员或备注"
            aria-label="搜寻纪录"
          />
          <div className="flex rounded-md border overflow-hidden" style={{ borderColor: C.line }} role="group">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className="px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                style={{
                  background: filter === key ? C.felt : "#fff",
                  color: filter === key ? "#fff" : C.ink,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <p className="p-8 text-center text-sm" style={{ color: C.red }} role="alert">
          {error}
        </p>
      ) : loading && !logs.length ? (
        <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
          载入中…
        </p>
      ) : !shown.length ? (
        <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
          {logs.length ? "没有符合条件的纪录" : "还没有任何纪录"}
        </p>
      ) : (
        <ul>
          {shown.map((l) => (
            <li
              key={l.id}
              className="px-4 py-3 border-b flex flex-wrap items-start gap-x-4 gap-y-1"
              style={{ borderColor: C.line }}
            >
              <div className="text-xs tabular-nums pt-1" style={{ color: C.muted, width: 110 }}>
                {fmtDateTime(l.createdAt)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  {l.board && (
                    <span
                      className="inline-block mr-2 px-1.5 py-0.5 rounded text-xs font-semibold"
                      style={{ background: l.board === "sng" ? "#F3EBD6" : C.tint, color: l.board === "sng" ? "#6B4E12" : C.felt }}
                    >
                      {l.board === "sng" ? "SnG" : "Cash"}
                    </span>
                  )}
                  <span className="font-semibold">{ACTIONS[l.action] || l.action}</span>
                  {l.playerName && <span className="ml-2">{l.playerName}</span>}
                  {l.playerPhone && (
                    <span className="ml-2 tabular-nums" style={{ color: C.muted }}>
                      {l.playerPhone}
                    </span>
                  )}
                </div>
                {describe(l) && (
                  <div className="text-sm break-words" style={{ color: C.muted }}>
                    {describe(l)}
                  </div>
                )}
              </div>
              <div className="text-right">
                {l.pointsAfter !== null && (
                  <div className="text-sm font-semibold tabular-nums">{fmt(l.pointsAfter)} 分</div>
                )}
                <div className="text-xs" style={{ color: C.muted }}>
                  {l.adminUsername}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
