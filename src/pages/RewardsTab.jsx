import { useState } from "react";
import {
  C,
  CHIP,
  btnPrimary,
  btnRow,
  btnSecondary,
  downloadCSV,
  fmtDate,
  fmtDateTime,
  inputCls,
  normPhone,
  safeName,
  today,
} from "../utils.js";

const ACCENT = ["#9A7420", "#1E4A3B", "#5B6B8C", "#8C5530"];

export default function RewardsTab({ data, loaded, title, call, refresh, flash }) {
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [lastUse, setLastUse] = useState(null);
  const [confirmUndo, setConfirmUndo] = useState(null);

  const rewards = data.rewards || [];
  const history = data.history || [];
  const q = query.trim().toLowerCase();
  const matches = (h) =>
    !q || h.name.toLowerCase().includes(q) || (normPhone(q) && normPhone(h.phone).includes(normPhone(q)));

  const deductOne = async (reward, holder) => {
    const key = `${reward}-${holder.playerId}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const r = await call("/rewards/use", { method: "POST", body: { playerId: holder.playerId, reward } });
      setLastUse({ key, ...r });
      await refresh();
      flash(`${r.name} 已使用 1 个「${reward}」，尚余 ${r.left} 个`);
    } catch (e) {
      flash(e.message);
      refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const undo = async (gameId, place) => {
    try {
      const r = await call("/rewards/undo", { method: "POST", body: { gameId, place } });
      setLastUse(null);
      setConfirmUndo(null);
      await refresh();
      flash(`已取消 ${r.name} 使用「${r.reward}」`);
    } catch (e) {
      flash(e.message);
    }
  };

  const exportLedger = () => {
    const rows = [];
    rewards.forEach((rw) =>
      rw.holders.forEach((h) =>
        rows.push([rw.reward, h.name, `="${h.phone}"`, h.available, h.used, fmtDateTime(h.lastWonAt)])
      )
    );
    downloadCSV(
      `${safeName(title)}_奖励纪录表_${today()}.csv`,
      ["奖励", "姓名", "手机号", "未使用", "已使用", "最近获得"],
      rows
    );
    flash("已汇出奖励纪录表");
  };

  const exportHistory = () => {
    downloadCSV(
      `${safeName(title)}_奖励使用纪录_${today()}.csv`,
      ["使用时间", "奖励", "姓名", "手机号", "来自场次", "名次", "处理管理员"],
      history.map((h) => [
        fmtDateTime(h.usedAt),
        h.reward,
        h.name,
        `="${h.phone}"`,
        h.gameTitle,
        `第 ${h.place} 名`,
        h.usedBy || "",
      ])
    );
    flash("已汇出使用纪录");
  };

  if (!loaded) {
    return (
      <p className="p-10 text-center text-sm" style={{ color: C.muted }}>
        载入中…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-white rounded-lg border p-4" style={{ borderColor: C.line }} aria-labelledby="rw-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="rw-head" className="text-lg font-bold">
              奖励纪录表
            </h2>
            <p className="text-xs" style={{ color: C.muted }}>
              Sit and Go 获得的奖励会自动记录在这里。玩家使用奖励时按「使用 1 个」即时减除，按错可以复原。
            </p>
          </div>
          <button
            className={btnSecondary}
            style={{ borderColor: C.line, color: C.ink }}
            onClick={exportLedger}
            disabled={!rewards.some((r) => r.holders.length)}
          >
            汇出纪录表
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 mt-4">
          {rewards.map((rw, i) => (
            <div
              key={rw.reward}
              className="rounded-md p-3"
              style={{ background: C.tint, borderLeft: `4px solid ${ACCENT[i % ACCENT.length]}` }}
            >
              <div className="text-sm font-semibold">{rw.reward}</div>
              <div className="flex items-baseline gap-3 mt-1 tabular-nums">
                <span className="text-2xl font-bold">{rw.available}</span>
                <span className="text-sm" style={{ color: C.muted }}>
                  个未使用
                </span>
                <span className="text-sm ml-auto" style={{ color: C.muted }}>
                  已使用 {rw.used}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <input
            className={inputCls + " flex-1"}
            style={{ borderColor: C.line, minWidth: 180 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜寻姓名或手机号"
            aria-label="搜寻奖励持有人"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
            />
            显示已用完的玩家
          </label>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-3 items-start">
        {rewards.map((rw, i) => {
          const list = rw.holders.filter((h) => (showEmpty || h.available > 0) && matches(h));
          return (
            <section
              key={rw.reward}
              className="bg-white rounded-lg border"
              style={{ borderColor: C.line, borderTop: `4px solid ${ACCENT[i % ACCENT.length]}` }}
              aria-labelledby={`rw-${i}`}
            >
              <div className="p-4 border-b flex items-baseline justify-between gap-2" style={{ borderColor: C.line }}>
                <h3 id={`rw-${i}`} className="text-base font-bold">
                  {rw.reward}
                </h3>
                <span className="text-sm tabular-nums" style={{ color: C.muted }}>
                  {rw.holders.filter((h) => h.available > 0).length} 人持有
                </span>
              </div>
              {!list.length ? (
                <p className="p-6 text-center text-sm" style={{ color: C.muted }}>
                  {q ? "没有符合的玩家" : "目前没有人持有"}
                </p>
              ) : (
                <ul>
                  {list.map((h) => {
                    const key = `${rw.reward}-${h.playerId}`;
                    const justUsed = lastUse && lastUse.key === key;
                    return (
                      <li key={key} className="px-4 py-3 border-b" style={{ borderColor: C.line }}>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold truncate">{h.name}</div>
                            <div className="text-sm tabular-nums" style={{ color: C.muted }}>
                              {h.phone}
                            </div>
                            <div className="text-xs" style={{ color: C.muted }}>
                              已使用 {h.used}　最近获得 {fmtDate(h.lastWonAt)}
                            </div>
                          </div>
                          <div className="text-right tabular-nums">
                            <div
                              className="text-2xl font-bold"
                              style={{ color: h.available ? C.ink : "#9AA39F" }}
                              aria-label={`未使用 ${h.available} 个`}
                            >
                              {h.available}
                            </div>
                            <div className="text-xs" style={{ color: C.muted }}>
                              未使用
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
                          {justUsed && (
                            <span className="text-xs mr-auto" style={{ color: C.felt }} role="status">
                              已减除 1 个
                              <button
                                className="ml-2 underline font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-700 rounded"
                                onClick={() => undo(lastUse.gameId, lastUse.place)}
                              >
                                复原
                              </button>
                            </span>
                          )}
                          <button
                            className={btnPrimary}
                            style={{ background: C.red }}
                            onClick={() => deductOne(rw.reward, h)}
                            disabled={!h.available || busyKey === key}
                            aria-label={`${h.name} 使用 1 个${rw.reward}`}
                          >
                            {busyKey === key ? "处理中…" : "使用 1 个"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section className="bg-white rounded-lg border" style={{ borderColor: C.line }} aria-labelledby="rw-history">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: C.line }}>
          <div>
            <h2 id="rw-history" className="text-lg font-bold">
              使用纪录
            </h2>
            <p className="text-xs" style={{ color: C.muted }}>
              最近 300 次。系统会先扣除玩家最早获得的同类奖励。
            </p>
          </div>
          <button
            className={btnSecondary}
            style={{ borderColor: C.line, color: C.ink }}
            onClick={exportHistory}
            disabled={!history.length}
          >
            汇出使用纪录
          </button>
        </div>
        {!history.length ? (
          <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
            还没有人使用奖励
          </p>
        ) : (
          <ul>
            {history
              .filter((h) => matches(h))
              .map((h) => {
                const key = `${h.gameId}-${h.place}`;
                return (
                  <li
                    key={key}
                    className="px-4 py-3 border-b flex flex-wrap items-center gap-x-4 gap-y-2"
                    style={{ borderColor: C.line }}
                  >
                    <div className="text-xs tabular-nums" style={{ color: C.muted, width: 110 }}>
                      {fmtDateTime(h.usedAt)}
                    </div>
                    <div className="flex-1 min-w-0 text-sm">
                      <div>
                        <span className="font-semibold">{h.name}</span>
                        <span className="ml-2 tabular-nums" style={{ color: C.muted }}>
                          {h.phone}
                        </span>
                      </div>
                      <div style={{ color: C.muted }}>
                        使用「<span style={{ color: C.ink }}>{h.reward}</span>」，来自 {h.gameTitle}
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white mx-1 align-middle"
                          style={{ background: CHIP[h.place] }}
                          aria-label={`第 ${h.place} 名`}
                        >
                          {h.place}
                        </span>
                        （{fmtDate(h.gameAt)}）
                      </div>
                    </div>
                    <div className="text-xs" style={{ color: C.muted }}>
                      {h.usedBy}
                    </div>
                    {confirmUndo === key ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm">取消这次使用？</span>
                        <button
                          className={btnPrimary}
                          style={{ background: C.felt }}
                          onClick={() => undo(h.gameId, h.place)}
                        >
                          确定
                        </button>
                        <button
                          className={btnSecondary}
                          style={{ borderColor: C.line, color: C.ink }}
                          onClick={() => setConfirmUndo(null)}
                        >
                          保留
                        </button>
                      </div>
                    ) : (
                      <button className={btnRow} style={{ color: C.felt }} onClick={() => setConfirmUndo(key)}>
                        取消使用
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}
