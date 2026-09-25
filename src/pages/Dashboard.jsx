import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { C, DEFAULT_TITLE, FONT, isEnter } from "../utils.js";
import RankingTab from "./RankingTab.jsx";
import SngTab from "./SngTab.jsx";
import RewardsTab from "./RewardsTab.jsx";
import PrizesTab from "./PrizesTab.jsx";
import LogsTab from "./LogsTab.jsx";
import AdminsTab from "./AdminsTab.jsx";

const TABS = [
  ["ranking", "常规赛"],
  ["sng", "Sit and Go"],
  ["rewards", "奖励纪录表"],
  ["prizes", "客户奖品"],
  ["logs", "修改纪录"],
  ["admins", "管理员"],
];

export default function Dashboard({ admin, onSignedOut }) {
  const [tab, setTab] = useState("ranking");
  const [players, setPlayers] = useState([]);
  const [sng, setSng] = useState({ standings: [], games: [], totalGames: 0 });
  const [sngLoaded, setSngLoaded] = useState(false);
  const [rewards, setRewards] = useState({ rewards: [], history: [] });
  const [prizes, setPrizes] = useState({ types: [], totals: [], players: [], history: [], knownPeriods: [] });
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [titleDraft, setTitleDraft] = useState(DEFAULT_TITLE);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  const titleFocused = useRef(false);

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);

  // Wraps api() so an expired session sends the admin back to the login screen
  const call = useCallback(
    async (path, opts) => {
      try {
        return await api(path, opts);
      } catch (e) {
        if (e.status === 401) onSignedOut();
        throw e;
      }
    },
    [onSignedOut]
  );

  const refresh = useCallback(async () => {
    try {
      const [r, s, rw, pz] = await Promise.all([
        call("/players"),
        call("/sng"),
        call("/rewards"),
        call("/prizes"),
      ]);
      setRewards(rw);
      setPrizes(pz);
      setPlayers(r.players);
      setTitle(r.title);
      if (!titleFocused.current) setTitleDraft(r.title);
      setSng(s);
      setSngLoaded(true);
      setSyncError("");
    } catch (e) {
      if (e.status !== 401) setSyncError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [call]);

  // Initial load + refresh every 5 seconds so changes by other admins show up
  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const saveTitle = async () => {
    titleFocused.current = false;
    const next = titleDraft.trim() || DEFAULT_TITLE;
    if (next === title) return setTitleDraft(next);
    try {
      const r = await call("/settings", { method: "PUT", body: { title: next } });
      setTitle(r.title);
      setTitleDraft(r.title);
      flash("已更新排行榜名称");
    } catch (e) {
      setTitleDraft(title);
      flash(e.message);
    }
  };

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    onSignedOut();
  };

  return (
    <div className="min-h-screen" style={{ background: C.page, fontFamily: FONT, color: C.ink }}>
      <header style={{ background: C.felt }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm mb-4">
            <span style={{ color: C.brass, letterSpacing: "0.35em" }} aria-hidden="true">
              ♠ ♥ ♦ ♣
            </span>
            <div className="flex items-center gap-3" style={{ color: "rgba(255,255,255,0.8)" }}>
              <span>
                已登入：<span className="font-semibold text-white">{admin.username}</span>
              </span>
              <button
                onClick={logout}
                className="px-2 py-1 rounded underline hover:text-white focus:outline-none focus:ring-2 focus:ring-yellow-600"
              >
                登出
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
            <div className="min-w-0 flex-1">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onFocus={() => (titleFocused.current = true)}
                onBlur={saveTitle}
                onKeyDown={(e) => isEnter(e) && e.currentTarget.blur()}
                maxLength={60}
                placeholder="排行榜名称"
                aria-label="排行榜名称（汇出和即时排行榜会使用）"
                className="w-full max-w-xl bg-transparent text-white text-2xl sm:text-3xl font-bold border-b-2 border-transparent focus:border-yellow-600 focus:outline-none pb-1"
              />
              <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.65)" }}>
                点击名称可修改，汇出档案和即时排行榜都会使用
              </p>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="/board"
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-md text-sm font-semibold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-600"
                style={{ background: C.brass, color: C.ink }}
              >
                即时排行榜
              </a>
              <div className="text-sm text-right" style={{ color: "rgba(255,255,255,0.85)" }}>
                <div className="font-semibold text-white">
                  {tab === "sng"
                    ? `${sng.standings.length} 位玩家　${sng.totalGames} 场`
                    : tab === "rewards"
                    ? `${rewards.rewards.reduce((n, r) => n + r.available, 0)} 个未使用奖励`
                    : tab === "prizes"
                    ? `${(prizes.totals || []).reduce((n, t) => n + t.balance, 0)} 张奖品未取走`
                    : `${players.filter((p) => p.inCash).length} 位玩家`}
                </div>
                <div
                  className="text-xs"
                  style={{ color: syncError ? "#F3B3AD" : "rgba(255,255,255,0.65)" }}
                  aria-live="polite"
                >
                  {syncError ? "暂时无法同步" : "已连接资料库"}
                </div>
              </div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto" aria-label="功能">
            {TABS.map(([key, label]) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  aria-current={active ? "page" : undefined}
                  className="px-3 sm:px-4 py-2 text-sm font-semibold rounded-t-md whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-yellow-600"
                  style={{
                    background: active ? C.page : "transparent",
                    color: active ? C.ink : "rgba(255,255,255,0.8)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {syncError && (
          <p
            className="mb-4 px-4 py-3 rounded-md text-sm"
            style={{ background: "#FBEAE8", color: C.red }}
            role="alert"
          >
            {syncError}。画面显示的可能不是最新资料，系统会自动重试。
          </p>
        )}
        {tab === "ranking" && (
          <RankingTab
            players={players}
            setPlayers={setPlayers}
            title={title}
            loaded={loaded}
            call={call}
            refresh={refresh}
            flash={flash}
          />
        )}
        {tab === "sng" && (
          <SngTab
            sng={sng}
            loaded={sngLoaded}
            players={players}
            title={title}
            call={call}
            refresh={refresh}
            flash={flash}
          />
        )}
        {tab === "rewards" && (
          <RewardsTab data={rewards} loaded={sngLoaded} title={title} call={call} refresh={refresh} flash={flash} />
        )}
        {tab === "prizes" && (
          <PrizesTab
            data={prizes}
            loaded={sngLoaded}
            players={players}
            title={title}
            call={call}
            refresh={refresh}
            flash={flash}
          />
        )}
        {tab === "logs" && <LogsTab call={call} title={title} />}
        {tab === "admins" && <AdminsTab admin={admin} call={call} flash={flash} />}
      </main>

      {toast && (
        <div
          className="fixed left-1/2 bottom-6 z-40 px-4 py-2 rounded-md text-sm text-white shadow-lg"
          style={{ background: C.felt, transform: "translateX(-50%)" }}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
