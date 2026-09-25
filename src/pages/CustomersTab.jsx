import { useCallback, useEffect, useMemo, useState } from "react";
import {
  C,
  btnPrimary,
  btnRow,
  btnSecondary,
  downloadCSV,
  fmt,
  fmtDate,
  fmtDateTime,
  inputCls,
  maskPhone,
  normPhone,
  safeName,
  today,
} from "../utils.js";

const SORTS = [
  ["points", "按积分"],
  ["sng", "按 SnG 成绩"],
  ["prizes", "按奖品"],
  ["name", "按姓名"],
  ["new", "按登记日期"],
];

const ACTIONS = {
  create: "新增玩家",
  adjust: "加减分",
  edit: "修改资料",
  delete: "移除玩家",
  import: "汇入玩家",
  sng_result: "记录赛果",
  sng_delete: "删除赛果",
  sng_reward: "修改奖励",
  reward_use: "使用奖励",
  reward_undo: "取消使用奖励",
  prize_grant: "发放奖品",
  prize_take: "客人取走奖品",
  prize_undo: "撤销奖品纪录",
};

const selectCls =
  "px-3 py-2 rounded-md border text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700";

export default function CustomersTab({ call, title, flash }) {
  const [data, setData] = useState({ customers: [], prizeTypes: [], periods: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("points");
  const [filter, setFilter] = useState("all");
  const [maskOn, setMaskOn] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await call("/customers");
      setData(r);
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

  const openCustomer = async (id) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await call(`/customers/${id}`));
    } catch (e) {
      flash(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = (data.customers || []).filter((c) => {
      if (filter === "cash" && !c.inCash) return false;
      if (filter === "sng" && c.sngAll.firsts + c.sngAll.seconds + c.sngAll.thirds === 0) return false;
      if (filter === "prizes" && c.prizeTotal + c.rewardTotal === 0) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) || (normPhone(q) && normPhone(c.phone).includes(normPhone(q)))
      );
    });
    const sng = (c) => c.sngAll.firsts * 10000 + c.sngAll.seconds * 100 + c.sngAll.thirds;
    const sorted = list.slice();
    if (sort === "points") sorted.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "zh-Hans"));
    if (sort === "sng") sorted.sort((a, b) => sng(b) - sng(a) || a.name.localeCompare(b.name, "zh-Hans"));
    if (sort === "prizes")
      sorted.sort((a, b) => b.prizeTotal + b.rewardTotal - (a.prizeTotal + a.rewardTotal) || a.name.localeCompare(b.name, "zh-Hans"));
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans"));
    if (sort === "new") sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sorted;
  }, [data.customers, q, sort, filter]);

  const phoneOut = (c) => (maskOn ? maskPhone(c.phone) : c.phone);
  const types = data.prizeTypes || [];

  const exportAll = () => {
    downloadCSV(
      `${safeName(title)}_客户名单_${today()}.csv`,
      [
        "姓名",
        "手机号",
        "常规赛积分",
        "常规赛名次",
        "SnG 第1名",
        "SnG 第2名",
        "SnG 第3名",
        "月度 第1名",
        "年度 第1名",
        ...types.map((t) => t.name),
        "未使用奖励",
        "登记日期",
        "最后异动",
      ],
      rows.map((c) => [
        c.name,
        `="${phoneOut(c)}"`,
        c.inCash ? c.points : "",
        c.cashRank || "",
        c.sngAll.firsts,
        c.sngAll.seconds,
        c.sngAll.thirds,
        c.sngMonth.firsts,
        c.sngYear.firsts,
        ...types.map((t) => {
          const hit = c.prizes.find((p) => p.typeId === t.id);
          return hit ? hit.balance : 0;
        }),
        c.rewards.map((r) => `${r.reward}x${r.available}`).join("、"),
        fmtDate(c.createdAt),
        fmtDateTime(c.updatedAt),
      ])
    );
    flash("已汇出客户名单");
  };

  const totalPrizes = rows.reduce((n, c) => n + c.prizeTotal, 0);
  const totalRewards = rows.reduce((n, c) => n + c.rewardTotal, 0);

  if (loading) {
    return (
      <p className="p-10 text-center text-sm" style={{ color: C.muted }}>
        载入中…
      </p>
    );
  }

  return (
    <section className="bg-white rounded-lg border" style={{ borderColor: C.line }} aria-labelledby="cust-head">
      <div className="p-4 border-b flex flex-col gap-3" style={{ borderColor: C.line }}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="cust-head" className="text-lg font-bold">
              客户名单
            </h2>
            <p className="text-xs" style={{ color: C.muted }}>
              {rows.length} 位客户　手上共有 {totalPrizes} 张奖品、{totalRewards} 个未使用奖励。点客户可以看完整纪录。
            </p>
          </div>
          <button
            className={btnPrimary}
            style={{ background: C.felt }}
            onClick={exportAll}
            disabled={!rows.length}
          >
            汇出名单
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            className={inputCls + " flex-1"}
            style={{ borderColor: C.line, minWidth: 180 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜寻姓名或手机号"
            aria-label="搜寻客户"
          />
          <select
            className={selectCls}
            style={{ borderColor: C.line }}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="排序"
          >
            {SORTS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select
            className={selectCls}
            style={{ borderColor: C.line }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="筛选"
          >
            <option value="all">全部客户</option>
            <option value="cash">有常规赛积分</option>
            <option value="sng">有 SnG 成绩</option>
            <option value="prizes">手上有奖品</option>
          </select>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4" checked={maskOn} onChange={(e) => setMaskOn(e.target.checked)} />
            遮盖手机号
          </label>
        </div>
      </div>

      {error ? (
        <p className="p-8 text-center text-sm" style={{ color: C.red }} role="alert">
          {error}
        </p>
      ) : !rows.length ? (
        <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
          {query ? "没有符合的客户" : "还没有客户"}
        </p>
      ) : (
        <ul>
          {rows.map((c) => (
            <li key={c.id} className="border-b" style={{ borderColor: C.line }}>
              <div
                className="px-4 py-3 cursor-pointer hover:bg-gray-50"
                onClick={() => openCustomer(c.id)}
                role="button"
                tabIndex={0}
                aria-expanded={openId === c.id}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openCustomer(c.id)}
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold text-base">{c.name}</span>
                  <span className="text-sm tabular-nums" style={{ color: C.muted }}>
                    {phoneOut(c)}
                  </span>
                  {!c.inCash && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: C.tint, color: C.muted }}>
                      只打 Sit and Go
                    </span>
                  )}
                  <span className="text-xs ml-auto" style={{ color: C.muted }}>
                    登记 {fmtDate(c.createdAt)}
                  </span>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md px-3 py-2" style={{ background: C.tint }}>
                    <div className="text-xs" style={{ color: C.muted }}>
                      常规赛
                    </div>
                    {c.inCash ? (
                      <div className="tabular-nums">
                        <span className="text-lg font-bold">{fmt(c.points)}</span>
                        <span className="text-xs ml-1" style={{ color: C.muted }}>
                          分　第 {c.cashRank} 名
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm" style={{ color: C.muted }}>
                        未参加
                      </div>
                    )}
                  </div>

                  <div className="rounded-md px-3 py-2" style={{ background: C.tint }}>
                    <div className="text-xs" style={{ color: C.muted }}>
                      Sit and Go（全部）
                    </div>
                    <div className="tabular-nums text-sm">
                      <span className="text-lg font-bold">{c.sngAll.firsts}</span>
                      {` 冠　${c.sngAll.seconds} 亚　${c.sngAll.thirds} 季`}
                    </div>
                    <div className="text-xs" style={{ color: C.muted }}>
                      月度 {c.sngMonth.firsts} 冠　年度 {c.sngYear.firsts} 冠
                    </div>
                  </div>

                  <div className="rounded-md px-3 py-2" style={{ background: C.tint }}>
                    <div className="text-xs" style={{ color: C.muted }}>
                      现存奖品
                    </div>
                    {c.prizes.length || c.rewards.length ? (
                      <div className="text-sm">
                        {c.prizes.map((p) => (
                          <span key={p.typeId} className="mr-2">
                            {p.name} <b className="tabular-nums">{p.balance}</b>
                          </span>
                        ))}
                        {c.rewards.map((r) => (
                          <span key={r.reward} className="mr-2" style={{ color: "#6B4E12" }}>
                            {r.reward} <b className="tabular-nums">{r.available}</b>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm" style={{ color: C.muted }}>
                        没有
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {openId === c.id && (
                <div className="px-4 pb-4">
                  {detailLoading || !detail ? (
                    <p className="text-sm py-4 text-center" style={{ color: C.muted }}>
                      载入纪录中…
                    </p>
                  ) : (
                    <div className="rounded-md p-3 grid gap-4 md:grid-cols-3" style={{ background: C.tint }}>
                      <div>
                        <div className="font-semibold mb-2">Sit and Go 战绩</div>
                        {!detail.games.length ? (
                          <p className="text-sm" style={{ color: C.muted }}>
                            没有参赛纪录
                          </p>
                        ) : (
                          <ul className="text-sm flex flex-col gap-1">
                            {detail.games.slice(0, 12).map((g) => (
                              <li key={`${g.gameId}-${g.place}`}>
                                <span className="tabular-nums" style={{ color: C.muted }}>
                                  {fmtDate(g.playedAt)}
                                </span>
                                <span className="ml-2">{g.title}</span>
                                <span className="ml-2 font-semibold">第 {g.place} 名</span>
                                {g.reward && (
                                  <span className="ml-2" style={{ color: g.rewardUsedAt ? C.muted : "#6B4E12" }}>
                                    {g.reward}
                                    {g.rewardUsedAt ? "（已使用）" : ""}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <div className="font-semibold mb-2">奖品异动</div>
                        {!detail.prizeHistory.length ? (
                          <p className="text-sm" style={{ color: C.muted }}>
                            没有奖品纪录
                          </p>
                        ) : (
                          <ul className="text-sm flex flex-col gap-1">
                            {detail.prizeHistory.slice(0, 12).map((h) => (
                              <li key={h.id}>
                                <span className="tabular-nums" style={{ color: C.muted }}>
                                  {fmtDate(h.createdAt)}
                                </span>
                                <span
                                  className="ml-2 font-semibold"
                                  style={{ color: h.quantity > 0 ? C.felt : C.red }}
                                >
                                  {h.quantity > 0 ? `+${h.quantity}` : h.quantity}
                                </span>
                                <span className="ml-2">{h.typeName}</span>
                                {h.note && (
                                  <span className="ml-2" style={{ color: C.muted }}>
                                    {h.note}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <div className="font-semibold mb-2">所有异动</div>
                        <ul className="text-sm flex flex-col gap-1">
                          {detail.logs.slice(0, 12).map((l) => (
                            <li key={l.id}>
                              <span className="tabular-nums" style={{ color: C.muted }}>
                                {fmtDateTime(l.createdAt)}
                              </span>
                              <span className="ml-2 font-semibold">{ACTIONS[l.action] || l.action}</span>
                              {l.delta !== null && l.delta !== 0 && (
                                <span className="ml-2 tabular-nums">
                                  {l.delta > 0 ? "+" : ""}
                                  {fmt(l.delta)} 分
                                </span>
                              )}
                              {l.detail && (
                                <span className="ml-2" style={{ color: C.muted }}>
                                  {l.detail}
                                </span>
                              )}
                              <span className="ml-2 text-xs" style={{ color: C.muted }}>
                                {l.adminUsername}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end mt-2">
                    <button className={btnSecondary} style={{ borderColor: C.line, color: C.ink }} onClick={() => openCustomer(c.id)}>
                      收起
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
