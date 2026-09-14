import { useEffect, useMemo, useState } from "react";
import RankMark from "../RankMark.jsx";
import { buildSngImage } from "../exportImage.js";
import {
  C,
  CHIP,
  DEFAULT_REWARD,
  DEFAULT_TITLE,
  REWARD_OPTIONS,
  btnPrimary,
  btnRow,
  btnSecondary,
  copyText,
  downloadCSV,
  fmtDate,
  fmtDateTime,
  inputCls,
  isEnter,
  maskPhone,
  normPhone,
  rankSng,
  safeName,
  today,
} from "../utils.js";

const MASK_KEY = "poker-ranking:mask-export";
const SCOPES = [
  ["month", "月度"],
  ["year", "年度"],
  ["all", "全部"],
];

const todayHK = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const PLACES = [1, 2, 3];
const emptyEntry = (place) => ({ name: "", phone: "", reward: DEFAULT_REWARD[place] });
const emptyForm = () => ({ title: "", 1: emptyEntry(1), 2: emptyEntry(2), 3: emptyEntry(3) });

const selectCls =
  "w-full px-3 py-2 rounded-md border text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700";

function RewardSelect({ id, value, onChange, disabled }) {
  const options = value && !REWARD_OPTIONS.includes(value) ? [...REWARD_OPTIONS, value] : REWARD_OPTIONS;
  return (
    <select
      id={id}
      className={selectCls}
      style={{ borderColor: C.line }}
      value={value || ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">不设奖励</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function readMask() {
  try {
    return window.localStorage.getItem(MASK_KEY) === "1";
  } catch {
    return false;
  }
}

export default function SngTab({ sng, loaded, players, title, call, refresh, flash }) {
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [maskOn, setMaskOn] = useState(readMask);
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [confirmGame, setConfirmGame] = useState(null);
  const [rewardEdit, setRewardEdit] = useState(null);
  const [rewardError, setRewardError] = useState("");
  const [rewardBusy, setRewardBusy] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [scope, setScope] = useState("month");
  const [periodDraft, setPeriodDraft] = useState(null);
  const [periodError, setPeriodError] = useState("");
  const [periodBusy, setPeriodBusy] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(MASK_KEY, maskOn ? "1" : "0");
    } catch {
      // ignore
    }
  }, [maskOn]);

  useEffect(() => {
    if (!imageUrl) return;
    const onKey = (e) => e.key === "Escape" && setImageUrl(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageUrl]);

  useEffect(() => {
    if (sng.periods && !periodDraft) {
      setPeriodDraft({ monthStart: sng.periods.monthStart, yearStart: sng.periods.yearStart });
    }
  }, [sng.periods, periodDraft]);

  // The API field names are sngMonthStart / sngYearStart
  const savePeriods = async (key) => {
    if (periodBusy) return;
    const field = key === "monthStart" ? "sngMonthStart" : "sngYearStart";
    const patch = { [field]: periodDraft[key] };
    setPeriodBusy(true);
    setPeriodError("");
    try {
      const r = await call("/settings", { method: "PUT", body: patch });
      setPeriodDraft({ monthStart: r.periods.monthStart, yearStart: r.periods.yearStart });
      await refresh();
      flash("已更新结算日期");
    } catch (e) {
      setPeriodError(e.message);
    } finally {
      setPeriodBusy(false);
    }
  };

  const byPhone = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(normPhone(p.phone), p));
    return m;
  }, [players]);

  const scopedStandings =
    scope === "month" ? sng.monthStandings : scope === "year" ? sng.yearStandings : sng.standings;
  const ranked = useMemo(() => rankSng(scopedStandings || []), [scopedStandings]);
  const scopeLabel = SCOPES.find(([k]) => k === scope)[1];
  const q = query.trim().toLowerCase();
  const visible = q
    ? ranked.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (normPhone(q) && normPhone(p.phone).includes(normPhone(q)))
      )
    : ranked;
  const empty = ranked.length === 0;
  const phoneOut = (p) => (maskOn ? maskPhone(p.phone) : p.phone);

  const setPlace = (place, patch) => setForm((f) => ({ ...f, [place]: { ...f[place], ...patch } }));

  const saveGame = async () => {
    if (saving) return;
    setSaving(true);
    setFormError("");
    try {
      const r = await call("/sng/games", {
        method: "POST",
        body: {
          title: form.title,
          // A reward is only sent for places that have a player
          results: PLACES.map((place) => {
            const e = form[place];
            const hasPlayer = e.name.trim() || e.phone.trim();
            return { place, name: e.name, phone: e.phone, reward: hasPlayer ? e.reward : "" };
          }),
        },
      });
      setForm(emptyForm());
      await refresh();
      const winner = r.game.results.find((x) => x.place === 1);
      flash(
        r.notices.length
          ? r.notices.join("；")
          : winner
          ? `已记录赛果，第 1 名：${winner.name}`
          : "已记录赛果"
      );
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (editBusy) return;
    setEditBusy(true);
    setEditError("");
    try {
      await call(`/players/${editing.id}`, {
        method: "PATCH",
        body: { name: editing.name, phone: editing.phone, board: "sng" },
      });
      setEditing(null);
      await refresh();
      flash("已更新玩家资料");
    } catch (e) {
      setEditError(e.message);
    } finally {
      setEditBusy(false);
    }
  };

  const saveReward = async () => {
    if (rewardBusy) return;
    setRewardBusy(true);
    setRewardError("");
    try {
      await call(`/sng/games/${rewardEdit.gameId}/results/${rewardEdit.place}`, {
        method: "PATCH",
        body: { reward: rewardEdit.value },
      });
      setRewardEdit(null);
      await refresh();
      flash("已更新奖励");
    } catch (e) {
      setRewardError(e.message);
    } finally {
      setRewardBusy(false);
    }
  };

  const deleteGame = async (g) => {
    try {
      await call(`/sng/games/${g.id}`, { method: "DELETE" });
      setConfirmGame(null);
      await refresh();
      flash("已删除这场赛果");
    } catch (e) {
      flash(e.message);
    }
  };

  const exportCSV = () => {
    downloadCSV(
      `${safeName(title)}_SitAndGo_${scopeLabel}_${today()}.csv`,
      ["排名", "姓名", "手机号", "第1名次数", "第2名次数", "第3名次数", "前三名总次数", "最近入围日期"],
      ranked.map((p) => [
        p.rank,
        p.name,
        `="${phoneOut(p)}"`,
        p.firsts,
        p.seconds,
        p.thirds,
        p.firsts + p.seconds + p.thirds,
        fmtDateTime(p.lastAt),
      ])
    );
    flash("已汇出 Excel 档（CSV）");
  };

  const exportGames = () => {
    const name = (g, place) => g.results.find((r) => r.place === place);
    downloadCSV(
      `${safeName(title)}_SitAndGo赛果_${today()}.csv`,
      [
        "日期",
        "场次",
        "第1名",
        "第1名手机号",
        "第1名奖励",
        "第2名",
        "第2名手机号",
        "第2名奖励",
        "第3名",
        "第3名手机号",
        "第3名奖励",
        "记录人",
      ],
      sng.games.map((g) => {
        const cells = [fmtDateTime(g.createdAt), g.title || `第 ${g.id} 场`];
        PLACES.forEach((place) => {
          const r = name(g, place);
          cells.push(
            r ? r.name : "",
            r ? `="${maskOn ? maskPhone(r.phone) : r.phone}"` : "",
            r ? (r.reward ? `${r.reward}${r.rewardUsedAt ? "（已使用）" : ""}` : "") : ""
          );
        });
        cells.push(g.createdBy);
        return cells;
      })
    );
    flash("已汇出赛果纪录");
  };

  const copyRanking = async () => {
    const lines = [
      `${title || DEFAULT_TITLE} Sit and Go ${scopeLabel}排行榜（${today()}）`,
      ...ranked.map(
        (p) =>
          `${p.rank}. ${p.name}（${phoneOut(p)}）第1名 ${p.firsts} 次　第2名 ${p.seconds} 次　第3名 ${p.thirds} 次`
      ),
    ];
    const ok = await copyText(lines.join("\n"));
    flash(ok ? "已复制排名文字" : "无法复制，请改用汇出 Excel");
  };

  return (
    <>
      <div className="grid gap-6 md:grid-cols-3 items-start">
        {/* left column: cut-off dates + result entry; right column: standings + history */}
        <div className="md:col-span-1 flex flex-col gap-6">
        <section
          className="bg-white rounded-lg border p-5"
          style={{ borderColor: C.line }}
          aria-labelledby="sng-period"
        >
          <h2 id="sng-period" className="text-lg font-bold">
            结算日期
          </h2>
          <p className="text-xs mb-4" style={{ color: C.muted }}>
            月度和年度排行榜只计算起计日期当天（香港时间）之后的赛果。改了日期即等于重新开始一期。
          </p>
          {!periodDraft ? (
            <p className="text-sm" style={{ color: C.muted }}>
              载入中…
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {[
                ["monthStart", "月度起计日期", sng.periods && sng.periods.monthGames, () => todayHK().slice(0, 8) + "01", "本月 1 日"],
                ["yearStart", "年度起计日期", sng.periods && sng.periods.yearGames, () => todayHK().slice(0, 4) + "-01-01", "本年 1 月 1 日"],
              ].map(([key, label, games, quick, quickLabel]) => (
                <div key={key}>
                  <label htmlFor={`sng-${key}`} className="block text-sm font-medium mb-1">
                    {label}
                  </label>
                  <input
                    id={`sng-${key}`}
                    type="date"
                    className={inputCls}
                    style={{ borderColor: C.line }}
                    value={periodDraft[key]}
                    onChange={(e) => setPeriodDraft({ ...periodDraft, [key]: e.target.value })}
                  />
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <button
                      className={btnPrimary}
                      style={{ background: C.felt }}
                      onClick={() => savePeriods(key)}
                      disabled={periodBusy || !periodDraft[key]}
                    >
                      储存
                    </button>
                    <button
                      className={btnSecondary}
                      style={{ borderColor: C.line, color: C.ink }}
                      onClick={() => setPeriodDraft({ ...periodDraft, [key]: quick() })}
                      disabled={periodBusy}
                    >
                      {quickLabel}
                    </button>
                    <button
                      className={btnSecondary}
                      style={{ borderColor: C.line, color: C.ink }}
                      onClick={() => setPeriodDraft({ ...periodDraft, [key]: todayHK() })}
                      disabled={periodBusy}
                    >
                      今天
                    </button>
                    <span className="text-xs" style={{ color: C.muted }}>
                      现有 {games ?? 0} 场
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {periodError && (
            <p className="text-sm mt-3" style={{ color: C.red }} role="alert">
              {periodError}
            </p>
          )}
          <p className="text-xs mt-4 leading-relaxed" style={{ color: C.muted }}>
            旧赛果不会被删除，只是不再计入这一期。把日期调回去就能重新看到。
          </p>
        </section>

        <section
          className="bg-white rounded-lg border p-5"
          style={{ borderColor: C.line }}
          aria-labelledby="sng-form"
        >
          <h2 id="sng-form" className="text-lg font-bold">
            记录赛果
          </h2>
          <p className="text-xs mb-4" style={{ color: C.muted }}>
            头三名全部选填，没有的名次留空即可。日期会自动记录。
          </p>

          <label htmlFor="sng-title" className="block text-sm font-medium mb-1">
            场次名称（选填）
          </label>
          <input
            id="sng-title"
            className={inputCls}
            style={{ borderColor: C.line }}
            value={form.title}
            maxLength={60}
            placeholder="例如：周五 SnG #12"
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />

          <div className="flex flex-col gap-3 mt-4">
            {PLACES.map((place) => {
              const entry = form[place];
              const match = entry.phone.trim() ? byPhone.get(normPhone(entry.phone)) : null;
              const nameQ = entry.name.trim().toLowerCase();
              const suggestions =
                nameQ && !entry.phone.trim()
                  ? players.filter((p) => p.name.toLowerCase().includes(nameQ)).slice(0, 3)
                  : [];
              return (
                <fieldset
                  key={place}
                  className="rounded-md p-3"
                  style={{ background: C.tint, borderLeft: `4px solid ${CHIP[place]}` }}
                >
                  <legend className="sr-only">第 {place} 名</legend>
                  <div className="flex items-center gap-2 mb-2">
                    <RankMark rank={place} />
                    <span className="font-semibold">第 {place} 名</span>
                    <span className="text-xs" style={{ color: C.muted }}>
                      选填
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label htmlFor={`sng-n-${place}`} className="block text-xs font-medium mb-1">
                        姓名
                      </label>
                      <input
                        id={`sng-n-${place}`}
                        className={inputCls}
                        style={{ borderColor: C.line }}
                        value={entry.name}
                        maxLength={50}
                        autoComplete="off"
                        onChange={(e) => setPlace(place, { name: e.target.value })}
                        onKeyDown={(e) => isEnter(e) && saveGame()}
                      />
                      {suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {suggestions.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="px-2 py-1 rounded border text-xs bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                              style={{ borderColor: C.line }}
                              onClick={() => setPlace(place, { name: p.name, phone: p.phone })}
                            >
                              {p.name}　{p.phone}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label htmlFor={`sng-p-${place}`} className="block text-xs font-medium mb-1">
                        手机号
                      </label>
                      <input
                        id={`sng-p-${place}`}
                        type="tel"
                        inputMode="tel"
                        className={inputCls}
                        style={{ borderColor: C.line }}
                        value={entry.phone}
                        autoComplete="off"
                        onChange={(e) => setPlace(place, { phone: e.target.value })}
                        onKeyDown={(e) => isEnter(e) && saveGame()}
                      />
                      {match && (
                        <p className="text-xs mt-1" style={{ color: match.name === entry.name.trim() ? C.felt : "#8A5A00" }}>
                          {match.name === entry.name.trim()
                            ? "已登记的玩家"
                            : `这个手机号已登记为「${match.name}」，会沿用登记姓名`}
                        </p>
                      )}
                    </div>
                    <div>
                      <label htmlFor={`sng-r-${place}`} className="block text-xs font-medium mb-1">
                        奖励
                      </label>
                      <RewardSelect
                        id={`sng-r-${place}`}
                        value={entry.reward}
                        onChange={(v) => setPlace(place, { reward: v })}
                      />
                      {!entry.name.trim() && !entry.phone.trim() && entry.reward && (
                        <p className="text-xs mt-1" style={{ color: C.muted }}>
                          没有输入玩家时不会记录奖励
                        </p>
                      )}
                    </div>
                  </div>
                </fieldset>
              );
            })}
          </div>

          {formError && (
            <p className="text-sm mt-3" style={{ color: C.red }} role="alert">
              {formError}
            </p>
          )}
          <button
            className={btnPrimary + " w-full mt-4"}
            style={{ background: C.felt }}
            onClick={saveGame}
            disabled={saving}
          >
            {saving ? "储存中…" : "储存赛果"}
          </button>
          <p className="text-xs mt-3 leading-relaxed" style={{ color: C.muted }}>
            如果输入某个名次，姓名和手机号都要填。同一个手机号会被视为同一位玩家。奖励只在后台显示，不会出现在即时排行榜。
          </p>
        </section>
        </div>

        <div className="md:col-span-2 flex flex-col gap-6">
          <section className="bg-white rounded-lg border" style={{ borderColor: C.line }} aria-labelledby="sng-rank">
            <div className="p-4 border-b flex flex-col gap-3" style={{ borderColor: C.line }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="sng-rank" className="text-lg font-bold">
                    Sit and Go {scopeLabel}排名
                  </h2>
                  <p className="text-xs" style={{ color: C.muted }}>
                    第 1 名次数最多排最前；相同时比较第 2 名，再比较第 3 名次数。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={btnPrimary} style={{ background: C.felt }} onClick={exportCSV} disabled={empty}>
                    汇出 Excel
                  </button>
                  <button
                    className={btnSecondary}
                    style={{ borderColor: C.line, color: C.ink }}
                    onClick={() =>
                      setImageUrl(buildSngImage({ title: `${title} ${scopeLabel}`, ranked, phoneOf: phoneOut }))
                    }
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
                <div className="flex rounded-md border overflow-hidden" style={{ borderColor: C.line }} role="group">
                  {SCOPES.map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setScope(key)}
                      aria-pressed={scope === key}
                      className="px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      style={{
                        background: scope === key ? C.felt : "#fff",
                        color: scope === key ? "#fff" : C.ink,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  className={inputCls + " flex-1"}
                  style={{ borderColor: C.line, minWidth: 150 }}
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
                <p className="font-semibold mb-1">还没有赛果</p>
                <p className="text-sm" style={{ color: C.muted }}>
                  记录第一场 Sit and Go 的头三名后，排名会自动计算。
                </p>
              </div>
            ) : visible.length === 0 ? (
              <p className="p-10 text-center text-sm" style={{ color: C.muted }}>
                找不到「{query}」，请检查姓名或手机号。
              </p>
            ) : (
              <ol>
                <li
                  className="hidden sm:flex items-center gap-3 px-4 py-2 border-b text-xs"
                  style={{ borderColor: C.line, color: C.muted }}
                  aria-hidden="true"
                >
                  <span className="w-10" />
                  <span className="flex-1">玩家</span>
                  <span className="w-14 text-center">第1名</span>
                  <span className="w-14 text-center">第2名</span>
                  <span className="w-14 text-center">第3名</span>
                  <span style={{ width: 44 }} />
                </li>
                {visible.map((p) => {
                  const isEditing = editing && editing.id === p.id;
                  return (
                    <li key={p.id} className="border-b" style={{ borderColor: C.line }}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                        <RankMark rank={p.rank} />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">{p.name}</div>
                          <div className="text-sm tabular-nums" style={{ color: C.muted }}>
                            {p.phone}
                          </div>
                          <div className="text-xs" style={{ color: C.muted }}>
                            最近入围 {fmtDateTime(p.lastAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          {[
                            ["第1名", p.firsts, "text-2xl font-bold"],
                            ["第2名", p.seconds, "text-lg font-semibold"],
                            ["第3名", p.thirds, "text-lg font-semibold"],
                          ].map(([label, n, cls]) => (
                            <div key={label} className="w-14 text-center">
                              <div className={cls} style={{ color: n ? C.ink : "#9AA39F" }}>
                                {n}
                              </div>
                              <div className="text-xs sm:hidden" style={{ color: C.muted }}>
                                {label}
                              </div>
                            </div>
                          ))}
                          <span className="sr-only">
                            第1名 {p.firsts} 次，第2名 {p.seconds} 次，第3名 {p.thirds} 次
                          </span>
                        </div>
                        <button
                          className={btnRow}
                          style={{ color: C.felt }}
                          onClick={() => {
                            setEditError("");
                            setEditing(isEditing ? null : { id: p.id, name: p.name, phone: p.phone });
                          }}
                          aria-expanded={!!isEditing}
                        >
                          编辑
                        </button>
                      </div>
                      {isEditing && (
                        <div className="px-4 pb-4">
                          <div className="rounded-md p-3" style={{ background: C.tint }}>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {[
                                ["name", "姓名", "text"],
                                ["phone", "手机号", "tel"],
                              ].map(([key, label, type]) => (
                                <div key={key}>
                                  <label htmlFor={`se-${key}-${p.id}`} className="block text-xs font-medium mb-1">
                                    {label}
                                  </label>
                                  <input
                                    id={`se-${key}-${p.id}`}
                                    type={type}
                                    className={inputCls}
                                    style={{ borderColor: C.line }}
                                    value={editing[key]}
                                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                                    onKeyDown={(e) => isEnter(e) && saveEdit()}
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2 mt-3">
                              <button
                                className={btnPrimary}
                                style={{ background: C.felt }}
                                onClick={saveEdit}
                                disabled={editBusy}
                              >
                                储存
                              </button>
                              <button
                                className={btnSecondary}
                                style={{ borderColor: C.line, color: C.ink }}
                                onClick={() => setEditing(null)}
                              >
                                取消
                              </button>
                            </div>
                            {editError && (
                              <p className="text-sm mt-2" style={{ color: C.red }} role="alert">
                                {editError}
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
          </section>

          <section className="bg-white rounded-lg border" style={{ borderColor: C.line }} aria-labelledby="sng-games">
            <div className="p-4 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: C.line }}>
              <div>
                <h2 id="sng-games" className="text-lg font-bold">
                  赛果纪录
                </h2>
                <p className="text-xs" style={{ color: C.muted }}>
                  共 {sng.totalGames} 场{sng.totalGames > sng.games.length ? `，显示最近 ${sng.games.length} 场` : ""}。记录错了可以删除后重新输入。
                </p>
              </div>
              <button
                className={btnSecondary}
                style={{ borderColor: C.line, color: C.ink }}
                onClick={exportGames}
                disabled={!sng.games.length}
              >
                汇出赛果
              </button>
            </div>
            {!sng.games.length ? (
              <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
                还没有赛果纪录
              </p>
            ) : (
              <ul>
                {sng.games.map((g) => (
                  <li
                    key={g.id}
                    className="px-4 py-3 border-b flex flex-wrap items-start gap-x-4 gap-y-2"
                    style={{ borderColor: C.line }}
                  >
                    <div style={{ width: 120 }}>
                      <div className="text-sm font-semibold">{g.title || `第 ${g.id} 场`}</div>
                      <div className="text-xs tabular-nums" style={{ color: C.muted }}>
                        {fmtDate(g.createdAt)}
                      </div>
                      <div className="text-xs" style={{ color: C.muted }}>
                        {g.createdBy}
                      </div>
                    </div>
                    <ol className="flex-1 flex flex-col gap-2" style={{ minWidth: 220 }}>
                      {!g.results.length && (
                        <li className="text-sm" style={{ color: C.muted }}>
                          没有输入名次
                        </li>
                      )}
                      {g.results.map((r) => {
                        const isEditing =
                          rewardEdit && rewardEdit.gameId === g.id && rewardEdit.place === r.place;
                        return (
                          <li key={r.place} className="text-sm">
                            <div className="flex flex-wrap items-center gap-x-2">
                              <span
                                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white shrink-0"
                                style={{ background: CHIP[r.place] }}
                                aria-label={`第 ${r.place} 名`}
                              >
                                {r.place}
                              </span>
                              <span className="font-medium">{r.name}</span>
                              <span className="tabular-nums" style={{ color: C.muted }}>
                                {r.phone}
                              </span>
                            </div>
                            {isEditing ? (
                              <div className="mt-1 flex flex-wrap items-center gap-2" style={{ paddingLeft: 32 }}>
                                <label htmlFor={`rw-${g.id}-${r.place}`} className="sr-only">
                                  第 {r.place} 名奖励
                                </label>
                                <div style={{ width: 180 }}>
                                  <RewardSelect
                                    id={`rw-${g.id}-${r.place}`}
                                    value={rewardEdit.value}
                                    onChange={(v) => setRewardEdit({ ...rewardEdit, value: v })}
                                  />
                                </div>
                                <button
                                  className={btnPrimary}
                                  style={{ background: C.felt }}
                                  onClick={saveReward}
                                  disabled={rewardBusy}
                                >
                                  储存
                                </button>
                                <button
                                  className={btnSecondary}
                                  style={{ borderColor: C.line, color: C.ink }}
                                  onClick={() => setRewardEdit(null)}
                                >
                                  取消
                                </button>
                                {rewardError && (
                                  <span className="w-full text-sm" style={{ color: C.red }} role="alert">
                                    {rewardError}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-x-2" style={{ paddingLeft: 32 }}>
                                <span style={{ color: r.reward ? C.ink : C.muted }}>
                                  奖励：{r.reward || "不设奖励"}
                                </span>
                                {r.reward && r.rewardUsedAt ? (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-xs font-semibold"
                                    style={{ background: "#FBEAE8", color: C.red }}
                                    title={`${fmtDateTime(r.rewardUsedAt)}　${r.rewardUsedBy || ""}`}
                                  >
                                    已使用 {fmtDate(r.rewardUsedAt)}
                                  </span>
                                ) : r.reward ? (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-xs font-semibold"
                                    style={{ background: C.tint, color: C.felt }}
                                  >
                                    未使用
                                  </span>
                                ) : null}
                                {!r.rewardUsedAt && (
                                <button
                                  className="px-1 rounded text-sm underline focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                  style={{ color: C.felt }}
                                  onClick={() => {
                                    setRewardError("");
                                    setRewardEdit({ gameId: g.id, place: r.place, value: r.reward || "" });
                                  }}
                                  aria-label={`修改 ${r.name} 的奖励`}
                                >
                                  修改
                                </button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                    {confirmGame === g.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm">删除这场？</span>
                        <button className={btnPrimary} style={{ background: C.red }} onClick={() => deleteGame(g)}>
                          删除
                        </button>
                        <button
                          className={btnSecondary}
                          style={{ borderColor: C.line, color: C.ink }}
                          onClick={() => setConfirmGame(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button className={btnRow} style={{ color: C.red }} onClick={() => setConfirmGame(g.id)}>
                        删除
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
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
              <img src={imageUrl} alt="Sit and Go 排名图片" className="w-full block" />
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
                download={`${safeName(title)}_SitAndGo_${scopeLabel}_${today()}.png`}
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
