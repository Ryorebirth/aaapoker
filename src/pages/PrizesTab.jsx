import { useCallback, useEffect, useMemo, useState } from "react";
import {
  C,
  btnPrimary,
  btnRow,
  btnSecondary,
  downloadCSV,
  fmtDate,
  fmtDateTime,
  inputCls,
  isEnter,
  normPhone,
  safeName,
  today,
} from "../utils.js";

const selectCls =
  "w-full px-3 py-2 rounded-md border text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700";

export default function PrizesTab({ data, loaded, players, title, call, refresh, flash }) {
  const [form, setForm] = useState({ name: "", phone: "", typeId: "", quantity: "1", note: "", period: "" });
  const [formError, setFormError] = useState("");
  const [granting, setGranting] = useState(false);
  const [query, setQuery] = useState("");
  const [take, setTake] = useState(null); // { playerId, typeId, name, typeName, balance, qty }
  const [takeError, setTakeError] = useState("");
  const [busy, setBusy] = useState(false);
  const [periodFilter, setPeriodFilter] = useState("all");
  const [confirmUndo, setConfirmUndo] = useState(null);
  const [newType, setNewType] = useState("");
  const [typeError, setTypeError] = useState("");
  const [renaming, setRenaming] = useState(null);

  const types = useMemo(() => data.types || [], [data.types]);
  const activeTypes = types.filter((t) => t.active);

  useEffect(() => {
    if (!form.typeId && activeTypes.length) {
      setForm((f) => ({ ...f, typeId: String(activeTypes[0].id), period: data.currentPeriod || "" }));
    }
  }, [activeTypes, form.typeId, data.currentPeriod]);

  const typeName = useCallback(
    (id) => (types.find((t) => t.id === id) || {}).name || "已删除的奖品",
    [types]
  );

  const q = query.trim().toLowerCase();
  const matches = (p) =>
    !q ||
    p.name.toLowerCase().includes(q) ||
    (normPhone(q) && normPhone(p.phone).includes(normPhone(q)));

  // Only players who still hold something, unless you are searching
  const holders = (data.players || [])
    .map((p) => ({ ...p, items: p.items.filter((i) => i.balance > 0 || q) }))
    .filter((p) => p.items.length && matches(p));

  const history = (data.history || []).filter(
    (h) => (periodFilter === "all" || h.period === periodFilter) && matches(h)
  );

  const onForm = (patch) => {
    setForm({ ...form, ...patch });
    setFormError("");
  };

  // Typing a phone that already exists fills in the registered name
  const known = form.phone.trim() ? players.find((p) => normPhone(p.phone) === normPhone(form.phone)) : null;

  const grant = async () => {
    if (granting) return;
    setGranting(true);
    setFormError("");
    try {
      const r = await call("/prizes/entries", {
        method: "POST",
        body: {
          typeId: Number(form.typeId),
          quantity: Math.abs(Number(form.quantity) || 0),
          name: form.name,
          phone: form.phone,
          note: form.note,
          period: form.period,
        },
      });
      setForm({ ...form, name: "", phone: "", note: "", quantity: "1" });
      await refresh();
      flash(`已发放 ${Math.abs(Number(form.quantity))} 张「${r.typeName}」给 ${r.player.name}，共 ${r.balance} 张`);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setGranting(false);
    }
  };

  const applyTake = async () => {
    if (busy || !take) return;
    const qty = Math.abs(Number(take.qty) || 0);
    if (!qty) return setTakeError("请输入大于 0 的数量");
    setBusy(true);
    setTakeError("");
    try {
      const r = await call("/prizes/entries", {
        method: "POST",
        body: {
          typeId: take.typeId,
          playerId: take.playerId,
          quantity: -qty,
          note: take.note || "客人取走",
          period: data.currentPeriod,
        },
      });
      setTake(null);
      await refresh();
      flash(`${r.player.name} 取走 ${qty} 张「${r.typeName}」，尚馀 ${r.balance} 张`);
    } catch (e) {
      setTakeError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async (id) => {
    try {
      const r = await call(`/prizes/entries/${id}/undo`, { method: "POST" });
      setConfirmUndo(null);
      await refresh();
      flash(`已撤销，${r.name} 的「${r.typeName}」现时 ${r.balance} 张`);
    } catch (e) {
      flash(e.message);
    }
  };

  const addType = async () => {
    if (!newType.trim()) return setTypeError("请输入奖品名称");
    setTypeError("");
    try {
      await call("/prizes/types", { method: "POST", body: { name: newType } });
      setNewType("");
      await refresh();
      flash("已新增奖品种类");
    } catch (e) {
      setTypeError(e.message);
    }
  };

  const updateType = async (id, patch) => {
    try {
      await call(`/prizes/types/${id}`, { method: "PATCH", body: patch });
      setRenaming(null);
      await refresh();
      flash("已更新奖品种类");
    } catch (e) {
      flash(e.message);
    }
  };

  const exportStock = () => {
    const rows = [];
    holders.forEach((p) =>
      p.items.forEach((i) =>
        rows.push([p.name, `="${p.phone}"`, typeName(i.typeId), i.balance, i.granted, i.taken, fmtDateTime(i.lastAt)])
      )
    );
    downloadCSV(
      `${safeName(title)}_客户奖品存量_${today()}.csv`,
      ["姓名", "手机号", "奖品", "未取走", "累计发放", "累计取走", "最后异动"],
      rows
    );
    flash("已汇出存量表");
  };

  const exportHistory = () => {
    downloadCSV(
      `${safeName(title)}_奖品异动纪录_${today()}.csv`,
      ["时间", "月份", "姓名", "手机号", "奖品", "数量", "备注", "经手人"],
      history.map((h) => [
        fmtDateTime(h.createdAt),
        h.period || "",
        h.name,
        `="${h.phone}"`,
        h.typeName,
        h.quantity,
        h.note || "",
        h.adminUsername,
      ])
    );
    flash("已汇出异动纪录");
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
      <section className="bg-white rounded-lg border p-4" style={{ borderColor: C.line }} aria-labelledby="pz-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="pz-head" className="text-lg font-bold">
              客户奖品存量
            </h2>
            <p className="text-xs" style={{ color: C.muted }}>
              每月按积分发放的奖品都记录在这里。客人取走时按「取走」即时扣减，所有异动都有纪录。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className={btnSecondary}
              style={{ borderColor: C.line, color: C.ink }}
              onClick={exportStock}
              disabled={!holders.length}
            >
              汇出存量
            </button>
            <button
              className={btnSecondary}
              style={{ borderColor: C.line, color: C.ink }}
              onClick={exportHistory}
              disabled={!history.length}
            >
              汇出纪录
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 mt-4">
          {(data.totals || []).map((t) => (
            <div key={t.typeId} className="rounded-md p-3" style={{ background: C.tint, borderLeft: `4px solid ${C.felt}` }}>
              <div className="text-sm font-semibold">{t.name}</div>
              <div className="flex items-baseline gap-2 mt-1 tabular-nums">
                <span className="text-2xl font-bold">{t.balance}</span>
                <span className="text-sm" style={{ color: C.muted }}>
                  张未取走
                </span>
                <span className="text-xs ml-auto" style={{ color: C.muted }}>
                  {t.holders} 人持有
                </span>
              </div>
              <div className="text-xs mt-1" style={{ color: C.muted }}>
                累计发放 {t.granted}　已取走 {t.taken}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-3 items-start">
        <div className="md:col-span-1 flex flex-col gap-6">
          <section className="bg-white rounded-lg border p-5" style={{ borderColor: C.line }} aria-labelledby="pz-grant">
            <h2 id="pz-grant" className="text-lg font-bold">
              发放奖品
            </h2>
            <p className="text-xs mb-4" style={{ color: C.muted }}>
              输入手机号即可，已登记的玩家会自动对应。新客人请连姓名一起输入。
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="pz-type" className="block text-sm font-medium mb-1">
                  奖品
                </label>
                <select
                  id="pz-type"
                  className={selectCls}
                  style={{ borderColor: C.line }}
                  value={form.typeId}
                  onChange={(e) => onForm({ typeId: e.target.value })}
                >
                  {activeTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pz-phone" className="block text-sm font-medium mb-1">
                  手机号
                </label>
                <input
                  id="pz-phone"
                  type="tel"
                  className={inputCls}
                  style={{ borderColor: C.line }}
                  value={form.phone}
                  onChange={(e) => onForm({ phone: e.target.value })}
                  onKeyDown={(e) => isEnter(e) && grant()}
                  placeholder="例如：9123 4567"
                />
                {known && (
                  <p className="text-xs mt-1" style={{ color: C.felt }}>
                    已登记玩家：{known.name}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="pz-name" className="block text-sm font-medium mb-1">
                  姓名{known ? "（可留空）" : ""}
                </label>
                <input
                  id="pz-name"
                  className={inputCls}
                  style={{ borderColor: C.line }}
                  value={form.name}
                  onChange={(e) => onForm({ name: e.target.value })}
                  onKeyDown={(e) => isEnter(e) && grant()}
                  placeholder={known ? known.name : "新客人请输入姓名"}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pz-qty" className="block text-sm font-medium mb-1">
                    数量
                  </label>
                  <input
                    id="pz-qty"
                    type="number"
                    min="1"
                    className={inputCls}
                    style={{ borderColor: C.line }}
                    value={form.quantity}
                    onChange={(e) => onForm({ quantity: e.target.value })}
                    onKeyDown={(e) => isEnter(e) && grant()}
                  />
                </div>
                <div>
                  <label htmlFor="pz-period" className="block text-sm font-medium mb-1">
                    月份
                  </label>
                  <input
                    id="pz-period"
                    type="month"
                    className={inputCls}
                    style={{ borderColor: C.line }}
                    value={form.period}
                    onChange={(e) => onForm({ period: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="pz-note" className="block text-sm font-medium mb-1">
                  备注（选填）
                </label>
                <input
                  id="pz-note"
                  className={inputCls}
                  style={{ borderColor: C.line }}
                  value={form.note}
                  maxLength={200}
                  onChange={(e) => onForm({ note: e.target.value })}
                  onKeyDown={(e) => isEnter(e) && grant()}
                  placeholder="例如：9月积分第 3 名"
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
              onClick={grant}
              disabled={granting || !activeTypes.length}
            >
              {granting ? "发放中…" : "发放奖品"}
            </button>
          </section>

          <section className="bg-white rounded-lg border p-5" style={{ borderColor: C.line }} aria-labelledby="pz-types">
            <h2 id="pz-types" className="text-lg font-bold mb-3">
              奖品种类
            </h2>
            <ul className="mb-3">
              {types.map((t) => (
                <li key={t.id} className="py-2 border-b" style={{ borderColor: C.line }}>
                  {renaming && renaming.id === t.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className={inputCls}
                        style={{ borderColor: C.line, maxWidth: 200 }}
                        value={renaming.name}
                        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                        onKeyDown={(e) => isEnter(e) && updateType(t.id, { name: renaming.name })}
                        autoFocus
                      />
                      <button
                        className={btnPrimary}
                        style={{ background: C.felt }}
                        onClick={() => updateType(t.id, { name: renaming.name })}
                      >
                        储存
                      </button>
                      <button
                        className={btnSecondary}
                        style={{ borderColor: C.line, color: C.ink }}
                        onClick={() => setRenaming(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="flex-1" style={{ color: t.active ? C.ink : C.muted }}>
                        {t.name}
                        {!t.active && <span className="text-xs ml-2">（已停用）</span>}
                      </span>
                      <button
                        className={btnRow}
                        style={{ color: C.felt }}
                        onClick={() => setRenaming({ id: t.id, name: t.name })}
                      >
                        改名
                      </button>
                      <button
                        className={btnRow}
                        style={{ color: t.active ? C.red : C.felt }}
                        onClick={() => updateType(t.id, { active: !t.active })}
                      >
                        {t.active ? "停用" : "启用"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                className={inputCls}
                style={{ borderColor: C.line }}
                value={newType}
                maxLength={40}
                onChange={(e) => setNewType(e.target.value)}
                onKeyDown={(e) => isEnter(e) && addType()}
                placeholder="例如：现金券 $500"
              />
              <button className={btnPrimary} style={{ background: C.felt }} onClick={addType}>
                新增
              </button>
            </div>
            {typeError && (
              <p className="text-sm mt-2" style={{ color: C.red }} role="alert">
                {typeError}
              </p>
            )}
            <p className="text-xs mt-3" style={{ color: C.muted }}>
              停用后不能再发放，但已发放的纪录和存量会保留。
            </p>
          </section>
        </div>

        <div className="md:col-span-2 flex flex-col gap-6">
          <section className="bg-white rounded-lg border" style={{ borderColor: C.line }} aria-labelledby="pz-stock">
            <div className="p-4 border-b" style={{ borderColor: C.line }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="pz-stock" className="text-lg font-bold">
                  客户存量
                </h2>
                <span className="text-sm" style={{ color: C.muted }}>
                  {holders.length} 位客人
                </span>
              </div>
              <input
                className={inputCls + " mt-3"}
                style={{ borderColor: C.line }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜寻姓名或手机号"
                aria-label="搜寻客人"
              />
            </div>

            {!holders.length ? (
              <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
                {q ? "没有符合的客人" : "还没有发放任何奖品"}
              </p>
            ) : (
              <ul>
                {holders.map((p) => (
                  <li key={p.playerId} className="px-4 py-3 border-b" style={{ borderColor: C.line }}>
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-sm tabular-nums" style={{ color: C.muted }}>
                        {p.phone}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-col gap-2">
                      {p.items.map((i) => {
                        const open = take && take.playerId === p.playerId && take.typeId === i.typeId;
                        return (
                          <div key={i.typeId}>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="flex-1 min-w-0">{typeName(i.typeId)}</span>
                              <span className="tabular-nums">
                                <span className="text-xl font-bold">{i.balance}</span>
                                <span className="text-xs ml-1" style={{ color: C.muted }}>
                                  张未取走
                                </span>
                              </span>
                              <span className="text-xs" style={{ color: C.muted }}>
                                发放 {i.granted}　取走 {i.taken}
                              </span>
                              <button
                                className={btnPrimary}
                                style={{ background: C.red }}
                                disabled={!i.balance}
                                onClick={() =>
                                  setTake(
                                    open
                                      ? null
                                      : {
                                          playerId: p.playerId,
                                          typeId: i.typeId,
                                          name: p.name,
                                          typeName: typeName(i.typeId),
                                          balance: i.balance,
                                          qty: "1",
                                          note: "",
                                        }
                                  )
                                }
                              >
                                取走
                              </button>
                            </div>
                            {open && (
                              <div className="rounded-md p-3 mt-2" style={{ background: C.tint }}>
                                <div className="flex flex-wrap items-end gap-2">
                                  <div>
                                    <label htmlFor="tk-qty" className="block text-xs font-medium mb-1">
                                      取走数量（最多 {take.balance}）
                                    </label>
                                    <input
                                      id="tk-qty"
                                      type="number"
                                      min="1"
                                      max={take.balance}
                                      autoFocus
                                      className={inputCls}
                                      style={{ borderColor: C.line, width: 110 }}
                                      value={take.qty}
                                      onChange={(e) => setTake({ ...take, qty: e.target.value })}
                                      onKeyDown={(e) => isEnter(e) && applyTake()}
                                    />
                                  </div>
                                  <div className="flex-1" style={{ minWidth: 160 }}>
                                    <label htmlFor="tk-note" className="block text-xs font-medium mb-1">
                                      备注（选填）
                                    </label>
                                    <input
                                      id="tk-note"
                                      className={inputCls}
                                      style={{ borderColor: C.line }}
                                      value={take.note}
                                      onChange={(e) => setTake({ ...take, note: e.target.value })}
                                      onKeyDown={(e) => isEnter(e) && applyTake()}
                                      placeholder="例如：换 10 月 MTT"
                                    />
                                  </div>
                                  <button
                                    className={btnPrimary}
                                    style={{ background: C.red }}
                                    onClick={applyTake}
                                    disabled={busy}
                                  >
                                    确认取走
                                  </button>
                                  <button
                                    className={btnSecondary}
                                    style={{ borderColor: C.line, color: C.ink }}
                                    onClick={() => setTake(null)}
                                  >
                                    取消
                                  </button>
                                </div>
                                {takeError && (
                                  <p className="text-sm mt-2" style={{ color: C.red }} role="alert">
                                    {takeError}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-lg border" style={{ borderColor: C.line }} aria-labelledby="pz-hist">
            <div className="p-4 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: C.line }}>
              <div>
                <h2 id="pz-hist" className="text-lg font-bold">
                  异动纪录
                </h2>
                <p className="text-xs" style={{ color: C.muted }}>
                  发放和取走都会记录经手人和时间。按「撤销」会补回一笔相反纪录，不会删除原纪录。
                </p>
              </div>
              <select
                className={selectCls}
                style={{ borderColor: C.line, width: "auto" }}
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                aria-label="筛选月份"
              >
                <option value="all">全部月份</option>
                {(data.knownPeriods || []).map((p) => (
                  <option key={p.period} value={p.period}>
                    {p.period}（{p.count}）
                  </option>
                ))}
              </select>
            </div>

            {!history.length ? (
              <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
                没有异动纪录
              </p>
            ) : (
              <ul>
                {history.map((h) => (
                  <li
                    key={h.id}
                    className="px-4 py-3 border-b flex flex-wrap items-center gap-x-4 gap-y-2"
                    style={{ borderColor: C.line }}
                  >
                    <div className="text-xs tabular-nums" style={{ color: C.muted, width: 110 }}>
                      {fmtDateTime(h.createdAt)}
                    </div>
                    <div className="flex-1 min-w-0 text-sm">
                      <div>
                        <span
                          className="px-1.5 py-0.5 rounded text-xs font-semibold mr-2"
                          style={{
                            background: h.quantity > 0 ? C.tint : "#FBEAE8",
                            color: h.quantity > 0 ? C.felt : C.red,
                          }}
                        >
                          {h.quantity > 0 ? `发放 ${h.quantity}` : `取走 ${-h.quantity}`}
                        </span>
                        <span className="font-semibold">{h.name}</span>
                        <span className="ml-2 tabular-nums" style={{ color: C.muted }}>
                          {h.phone}
                        </span>
                      </div>
                      <div style={{ color: C.muted }}>
                        {h.typeName}
                        {h.period ? `　${h.period}` : ""}
                        {h.note ? `　${h.note}` : ""}
                      </div>
                    </div>
                    <div className="text-xs" style={{ color: C.muted }}>
                      {h.adminUsername}
                    </div>
                    {confirmUndo === h.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm">撤销这一笔？</span>
                        <button className={btnPrimary} style={{ background: C.felt }} onClick={() => undo(h.id)}>
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
                      <button className={btnRow} style={{ color: C.felt }} onClick={() => setConfirmUndo(h.id)}>
                        撤销
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
