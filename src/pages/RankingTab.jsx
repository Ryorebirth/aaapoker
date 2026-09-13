import { useEffect, useMemo, useRef, useState } from "react";
import RankMark from "../RankMark.jsx";
import { buildRankingImage } from "../exportImage.js";
import {
  C,
  DEFAULT_TITLE,
  btnPrimary,
  btnRow,
  btnSecondary,
  copyText,
  downloadCSV,
  fmt,
  fmtDate,
  fmtDateTime,
  inputCls,
  isEnter,
  maskPhone,
  normPhone,
  rankPlayers,
  safeName,
  today,
} from "../utils.js";

const LEGACY_KEY = "poker-ranking:v1";
const LEGACY_DONE_KEY = "poker-ranking:legacy-handled";
const MASK_KEY = "poker-ranking:mask-export";

function readLocal(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export default function RankingTab({ players, setPlayers, title, loaded, call, refresh, flash }) {
  const [form, setForm] = useState({ name: "", phone: "", points: "" });
  const [formError, setFormError] = useState("");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [openRow, setOpenRow] = useState(null);
  const [draft, setDraft] = useState({});
  const [rowError, setRowError] = useState("");
  const [rowBusy, setRowBusy] = useState(false);
  const [maskOn, setMaskOn] = useState(() => readLocal(MASK_KEY) === "1");
  const [imageUrl, setImageUrl] = useState(null);
  const [legacy, setLegacy] = useState(null);
  const [importing, setImporting] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => writeLocal(MASK_KEY, maskOn ? "1" : "0"), [maskOn]);

  // Offer to import data saved by the old browser-only version
  useEffect(() => {
    if (readLocal(LEGACY_DONE_KEY)) return;
    try {
      const d = JSON.parse(readLocal(LEGACY_KEY) || "null");
      if (d && Array.isArray(d.players) && d.players.length) setLegacy(d.players);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!imageUrl) return;
    const onKey = (e) => e.key === "Escape" && setImageUrl(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageUrl]);

  const cashPlayers = useMemo(() => players.filter((p) => p.inCash), [players]);
  const ranked = useMemo(() => rankPlayers(cashPlayers), [cashPlayers]);
  const q = query.trim().toLowerCase();
  const visible = q
    ? ranked.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (normPhone(q) && normPhone(p.phone).includes(normPhone(q)))
      )
    : ranked;

  const upsertLocal = (player) =>
    setPlayers((ps) => (ps.some((x) => x.id === player.id) ? ps.map((x) => (x.id === player.id ? player : x)) : [...ps, player]));

  const addPlayer = async () => {
    if (adding) return;
    setAdding(true);
    setFormError("");
    try {
      const r = await call("/players", { method: "POST", body: form });
      upsertLocal(r.player);
      setForm({ name: "", phone: "", points: "" });
      flash(
        r.joinedExisting
          ? `${r.player.name} 已在 Sit and Go 登记，已加入常规赛`
          : `已新增 ${r.player.name}`
      );
      nameRef.current && nameRef.current.focus();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const closeRow = () => {
    setOpenRow(null);
    setRowError("");
  };

  const toggleRow = (p, mode) => {
    if (openRow && openRow.id === p.id && openRow.mode === mode) return closeRow();
    setOpenRow({ id: p.id, mode });
    setRowError("");
    setDraft(
      mode === "edit"
        ? { name: p.name, phone: p.phone, points: String(p.points) }
        : { amount: "", note: "" }
    );
  };

  const runRow = async (fn) => {
    if (rowBusy) return;
    setRowBusy(true);
    setRowError("");
    try {
      await fn();
      closeRow();
    } catch (e) {
      setRowError(e.message);
      if (e.status === 404) refresh();
    } finally {
      setRowBusy(false);
    }
  };

  const applyAdjust = (p, sign) =>
    runRow(async () => {
      const v = Math.abs(Number(draft.amount));
      if (String(draft.amount || "").trim() === "" || !Number.isFinite(v) || v === 0) {
        throw new Error("请输入大于 0 的分数");
      }
      const delta = v * sign;
      const r = await call(`/players/${p.id}/adjust`, {
        method: "POST",
        body: { delta, note: draft.note },
      });
      upsertLocal(r.player);
      flash(`${p.name} ${delta > 0 ? "+" : ""}${fmt(delta)} 分`);
    });

  const saveEdit = (p) =>
    runRow(async () => {
      const r = await call(`/players/${p.id}`, { method: "PATCH", body: draft });
      upsertLocal(r.player);
      flash("已更新玩家资料");
    });

  const removePlayer = (p) =>
    runRow(async () => {
      const r = await call(`/players/${p.id}`, { method: "DELETE" });
      if (r.removedFromCashOnly) {
        setPlayers((ps) => ps.map((x) => (x.id === p.id ? { ...x, inCash: false, points: 0 } : x)));
        flash(`已从常规赛移除 ${p.name}，Sit and Go 纪录保留`);
      } else {
        setPlayers((ps) => ps.filter((x) => x.id !== p.id));
        flash(`已删除 ${p.name}`);
      }
    });

  const importLegacy = async () => {
    setImporting(true);
    try {
      const r = await call("/players/import", { method: "POST", body: { players: legacy } });
      writeLocal(LEGACY_DONE_KEY, "1");
      setLegacy(null);
      await refresh();
      flash(
        r.skipped.length
          ? `已汇入 ${r.imported} 位，略过 ${r.skipped.length} 位（手机号已存在或资料不完整）`
          : `已汇入 ${r.imported} 位玩家`
      );
    } catch (e) {
      flash(e.message);
    } finally {
      setImporting(false);
    }
  };

  const dismissLegacy = () => {
    writeLocal(LEGACY_DONE_KEY, "1");
    setLegacy(null);
  };

  const phoneOut = (p) => (maskOn ? maskPhone(p.phone) : p.phone);
  const empty = cashPlayers.length === 0;

  const exportCSV = () => {
    downloadCSV(
      `${safeName(title)}_常规赛_${today()}.csv`,
      ["排名", "姓名", "手机号", "积分", "登记日期", "最后更新", "最后修改人"],
      ranked.map((p) => [
        p.rank,
        p.name,
        `="${phoneOut(p)}"`,
        p.points,
        fmtDateTime(p.createdAt),
        fmtDateTime(p.updatedAt),
        p.updatedBy || "",
      ])
    );
    flash("已汇出 Excel 档（CSV）");
  };

  const copyRanking = async () => {
    const lines = [
      `${title || DEFAULT_TITLE} 常规赛（${today()}）`,
      ...ranked.map(
        (p) => `${p.rank}. ${p.name}（${phoneOut(p)}）${fmt(p.points)} 分　更新 ${fmtDate(p.updatedAt)}`
      ),
    ];
    const ok = await copyText(lines.join("\n"));
    flash(ok ? "已复制排名文字" : "无法复制，请改用汇出 Excel");
  };

  const exportImage = () => setImageUrl(buildRankingImage({ title, ranked, phoneOf: phoneOut }));

  return (
    <>
      {legacy && (
        <div
          className="mb-6 rounded-lg border p-4 flex flex-wrap items-center gap-3"
          style={{ background: "#FBF5E6", borderColor: "#E6D3A3" }}
        >
          <p className="text-sm flex-1" style={{ minWidth: 220 }}>
            这部装置有旧版储存在浏览器的资料（{legacy.length} 位玩家）。要汇入到资料库吗？手机号已存在的玩家会略过。
          </p>
          <div className="flex gap-2">
            <button
              className={btnPrimary}
              style={{ background: C.felt }}
              onClick={importLegacy}
              disabled={importing}
            >
              {importing ? "汇入中…" : "汇入到资料库"}
            </button>
            <button
              className={btnSecondary}
              style={{ borderColor: C.line, color: C.ink }}
              onClick={dismissLegacy}
              disabled={importing}
            >
              不用了
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3 items-start">
        <section
          className="md:col-span-1 bg-white rounded-lg border p-5"
          style={{ borderColor: C.line }}
          aria-labelledby="add-heading"
        >
          <h2 id="add-heading" className="text-lg font-bold mb-4">
            新增玩家
          </h2>
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="f-name" className="block text-sm font-medium mb-1">
                姓名
              </label>
              <input
                id="f-name"
                ref={nameRef}
                className={inputCls}
                style={{ borderColor: C.line }}
                value={form.name}
                maxLength={50}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => isEnter(e) && addPlayer()}
                placeholder="例如：陈大文"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="f-phone" className="block text-sm font-medium mb-1">
                手机号
              </label>
              <input
                id="f-phone"
                type="tel"
                inputMode="tel"
                className={inputCls}
                style={{ borderColor: C.line }}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                onKeyDown={(e) => isEnter(e) && addPlayer()}
                placeholder="例如：9123 4567"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="f-points" className="block text-sm font-medium mb-1">
                积分
              </label>
              <input
                id="f-points"
                type="number"
                step="any"
                className={inputCls}
                style={{ borderColor: C.line }}
                value={form.points}
                onChange={(e) => setForm({ ...form, points: e.target.value })}
                onKeyDown={(e) => isEnter(e) && addPlayer()}
                placeholder="留空即 0"
              />
            </div>
          </div>
          {formError && (
            <p className="text-sm mt-3" style={{ color: C.red }} role="alert">
              {formError}
            </p>
          )}
          <button
            className={btnPrimary + " w-full mt-4"}
            style={{ background: C.felt }}
            onClick={addPlayer}
            disabled={adding}
          >
            {adding ? "新增中…" : "新增玩家"}
          </button>
          <p className="text-xs mt-3 leading-relaxed" style={{ color: C.muted }}>
            按 Enter 也可以新增。手机号不可重复。日期和修改人会自动记录在资料库。
          </p>
        </section>

        <section
          className="md:col-span-2 bg-white rounded-lg border"
          style={{ borderColor: C.line }}
          aria-labelledby="rank-heading"
        >
          <div className="p-4 border-b flex flex-col gap-3" style={{ borderColor: C.line }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="rank-heading" className="text-lg font-bold">
                常规赛排名
              </h2>
              <div className="flex flex-wrap gap-2">
                <button
                  className={btnPrimary}
                  style={{ background: C.felt }}
                  onClick={exportCSV}
                  disabled={empty}
                >
                  汇出 Excel
                </button>
                <button
                  className={btnSecondary}
                  style={{ borderColor: C.line, color: C.ink }}
                  onClick={exportImage}
                  disabled={empty}
                >
                  汇出图片
                </button>
                <button
                  className={btnSecondary}
                  style={{ borderColor: C.line, color: C.ink }}
                  onClick={copyRanking}
                  disabled={empty}
                >
                  复制文字
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                className={inputCls + " flex-1"}
                style={{ borderColor: C.line, minWidth: 180 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜寻姓名或手机号"
                aria-label="搜寻姓名或手机号"
                disabled={empty}
              />
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={maskOn}
                  onChange={(e) => setMaskOn(e.target.checked)}
                />
                汇出时遮盖手机号
              </label>
            </div>
          </div>

          {!loaded ? (
            <p className="p-10 text-center text-sm" style={{ color: C.muted }}>
              载入中…
            </p>
          ) : empty ? (
            <div className="p-10 text-center">
              <p className="font-semibold mb-1">还没有玩家</p>
              <p className="text-sm" style={{ color: C.muted }}>
                输入姓名、手机号和积分新增玩家，排名会按积分自动排好。
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p className="p-10 text-center text-sm" style={{ color: C.muted }}>
              找不到「{query}」，请检查姓名或手机号。
            </p>
          ) : (
            <ol>
              {visible.map((p) => {
                const open = openRow && openRow.id === p.id ? openRow.mode : null;
                return (
                  <li key={p.id} className="border-b" style={{ borderColor: C.line }}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                      <RankMark rank={p.rank} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{p.name}</div>
                        <div className="text-sm tabular-nums" style={{ color: C.muted }}>
                          {p.phone}
                        </div>
                        <div className="text-xs tabular-nums flex flex-wrap gap-x-3" style={{ color: C.muted }}>
                          <span>登记 {fmtDateTime(p.createdAt)}</span>
                          <span>
                            更新 {fmtDateTime(p.updatedAt)}
                            {p.updatedBy ? `（${p.updatedBy}）` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="text-xl font-bold tabular-nums whitespace-nowrap">
                        {fmt(p.points)}
                        <span className="text-xs font-normal ml-1" style={{ color: C.muted }}>
                          分
                        </span>
                      </div>
                      <div className="w-full sm:w-auto flex justify-end gap-1">
                        <button
                          className={btnRow}
                          style={{ color: C.felt }}
                          onClick={() => toggleRow(p, "adjust")}
                          aria-expanded={open === "adjust"}
                        >
                          加减分
                        </button>
                        <button
                          className={btnRow}
                          style={{ color: C.felt }}
                          onClick={() => toggleRow(p, "edit")}
                          aria-expanded={open === "edit"}
                        >
                          编辑
                        </button>
                        <button
                          className={btnRow}
                          style={{ color: C.red }}
                          onClick={() => toggleRow(p, "delete")}
                          aria-expanded={open === "delete"}
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div className="px-4 pb-4">
                        <div className="rounded-md p-3" style={{ background: C.tint }}>
                          {open === "adjust" && (
                            <>
                              <div className="grid gap-2 sm:grid-cols-3">
                                <div>
                                  <label htmlFor={`adj-${p.id}`} className="block text-xs font-medium mb-1">
                                    分数
                                  </label>
                                  <input
                                    id={`adj-${p.id}`}
                                    type="number"
                                    min="0"
                                    step="any"
                                    autoFocus
                                    className={inputCls}
                                    style={{ borderColor: C.line }}
                                    value={draft.amount || ""}
                                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                                    onKeyDown={(e) => isEnter(e) && applyAdjust(p, 1)}
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <label htmlFor={`note-${p.id}`} className="block text-xs font-medium mb-1">
                                    备注（选填，会记录在修改纪录）
                                  </label>
                                  <input
                                    id={`note-${p.id}`}
                                    className={inputCls}
                                    style={{ borderColor: C.line }}
                                    value={draft.note || ""}
                                    maxLength={200}
                                    placeholder="例如：9月12日第三局冠军"
                                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                                    onKeyDown={(e) => isEnter(e) && applyAdjust(p, 1)}
                                  />
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-3">
                                <button
                                  className={btnPrimary}
                                  style={{ background: C.felt }}
                                  onClick={() => applyAdjust(p, 1)}
                                  disabled={rowBusy}
                                >
                                  加分
                                </button>
                                <button
                                  className={btnPrimary}
                                  style={{ background: C.red }}
                                  onClick={() => applyAdjust(p, -1)}
                                  disabled={rowBusy}
                                >
                                  扣分
                                </button>
                                <button
                                  className={btnSecondary}
                                  style={{ borderColor: C.line, color: C.ink }}
                                  onClick={closeRow}
                                >
                                  取消
                                </button>
                                <span className="text-xs" style={{ color: C.muted }}>
                                  目前 {fmt(p.points)} 分
                                </span>
                              </div>
                            </>
                          )}

                          {open === "edit" && (
                            <>
                              <div className="grid gap-2 sm:grid-cols-3">
                                {[
                                  ["name", "姓名", "text"],
                                  ["phone", "手机号", "tel"],
                                  ["points", "积分", "number"],
                                ].map(([key, label, type]) => (
                                  <div key={key}>
                                    <label htmlFor={`e-${key}-${p.id}`} className="block text-xs font-medium mb-1">
                                      {label}
                                    </label>
                                    <input
                                      id={`e-${key}-${p.id}`}
                                      type={type}
                                      step={type === "number" ? "any" : undefined}
                                      className={inputCls}
                                      style={{ borderColor: C.line }}
                                      value={draft[key] ?? ""}
                                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                                      onKeyDown={(e) => isEnter(e) && saveEdit(p)}
                                    />
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-2 mt-3">
                                <button
                                  className={btnPrimary}
                                  style={{ background: C.felt }}
                                  onClick={() => saveEdit(p)}
                                  disabled={rowBusy}
                                >
                                  储存
                                </button>
                                <button
                                  className={btnSecondary}
                                  style={{ borderColor: C.line, color: C.ink }}
                                  onClick={closeRow}
                                >
                                  取消
                                </button>
                              </div>
                            </>
                          )}

                          {open === "delete" && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm flex-1">
                                删除「{p.name}」？玩家会从常规赛排名移除，修改纪录和 Sit and Go 成绩会保留。
                              </span>
                              <button
                                className={btnPrimary}
                                style={{ background: C.red }}
                                onClick={() => removePlayer(p)}
                                disabled={rowBusy}
                              >
                                删除
                              </button>
                              <button
                                className={btnSecondary}
                                style={{ borderColor: C.line, color: C.ink }}
                                onClick={closeRow}
                              >
                                取消
                              </button>
                            </div>
                          )}

                          {rowError && (
                            <p className="text-sm mt-2" style={{ color: C.red }} role="alert">
                              {rowError}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {!empty && (
            <p className="p-4 text-sm" style={{ color: C.muted }}>
              积分相同会并列同一名次
            </p>
          )}
        </section>
      </div>

      {imageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(10,25,18,0.6)" }}
          onClick={() => setImageUrl(null)}
        >
          <div
            className="bg-white rounded-lg w-full max-w-lg p-4 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="排名图片"
          >
            <div className="overflow-auto rounded border" style={{ maxHeight: "62vh", borderColor: C.line }}>
              <img src={imageUrl} alt="排名图片" className="w-full block" />
            </div>
            <p className="text-sm" style={{ color: C.muted }}>
              手机上可以长按图片储存，或直接分享到群组。
            </p>
            <div className="flex justify-end gap-2">
              <button
                className={btnSecondary}
                style={{ borderColor: C.line, color: C.ink }}
                onClick={() => setImageUrl(null)}
              >
                关闭
              </button>
              <a
                href={imageUrl}
                download={`${safeName(title)}_常规赛_${today()}.png`}
                className={btnPrimary + " inline-block"}
                style={{ background: C.felt }}
              >
                下载图片
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
