import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import RankMark from "../RankMark.jsx";
import {
  BOARD_NAMES,
  C,
  DEFAULT_TITLE,
  FONT,
  fmt,
  fmtClock,
  fmtDateTime,
  rankPlayers,
  rankSng,
  signed,
} from "../utils.js";

const ROTATE_SECONDS = 20;
const VIEWS = [
  ["cash", "Cash Game"],
  ["sng", "Sit and Go"],
  ["rotate", "輪流顯示"],
];

function readView() {
  const v = new URLSearchParams(window.location.search).get("show");
  return ["cash", "sng", "rotate"].includes(v) ? v : "cash";
}

// Track changes between polls so updated rows can be highlighted for a few seconds
function useChanges(ranked, loaded, diff) {
  const [changes, setChanges] = useState({});
  const prevRef = useRef(null);
  useEffect(() => {
    if (!loaded) return;
    const cur = {};
    ranked.forEach((p) => (cur[p.id] = p));
    const prev = prevRef.current;
    prevRef.current = cur;
    if (!prev) return;
    const found = {};
    ranked.forEach((p) => {
      const o = prev[p.id];
      const d = o ? diff(o, p) : { isNew: true, move: 0 };
      if (d) found[p.id] = d;
    });
    const ids = Object.keys(found);
    if (!ids.length) return;
    const stamp = Date.now() + Math.random();
    setChanges((c) => {
      const n = { ...c };
      ids.forEach((id) => (n[id] = { ...found[id], stamp }));
      return n;
    });
    setTimeout(() => {
      setChanges((c) => {
        const n = { ...c };
        ids.forEach((id) => {
          if (n[id] && n[id].stamp === stamp) delete n[id];
        });
        return n;
      });
    }, 6000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, loaded]);
  return changes;
}

const cashDiff = (o, p) => {
  const delta = Math.round((p.points - o.points) * 100) / 100;
  const move = o.rank - p.rank;
  return delta !== 0 || move !== 0 ? { isNew: false, delta, move, highlight: delta !== 0 } : null;
};

const sngDiff = (o, p) => {
  const gained = [];
  if (p.firsts > o.firsts) gained.push(`+${p.firsts - o.firsts} 第1名`);
  if (p.seconds > o.seconds) gained.push(`+${p.seconds - o.seconds} 第2名`);
  if (p.thirds > o.thirds) gained.push(`+${p.thirds - o.thirds} 第3名`);
  const move = o.rank - p.rank;
  return gained.length || move !== 0 ? { isNew: false, gained, move, highlight: gained.length > 0 } : null;
};

function ChangeBadge({ change }) {
  if (!change) return null;
  return (
    <div className="flex flex-col items-end text-sm font-semibold tabular-nums whitespace-nowrap">
      {change.isNew && <span style={{ color: "#E9CF8E" }}>新加入</span>}
      {!change.isNew && change.delta !== undefined && change.delta !== 0 && (
        <span style={{ color: change.delta > 0 ? C.up : C.down }}>{signed(change.delta)}</span>
      )}
      {!change.isNew &&
        change.gained &&
        change.gained.map((g) => (
          <span key={g} style={{ color: C.up }}>
            {g}
          </span>
        ))}
      {!change.isNew && change.move !== 0 && (
        <span style={{ color: change.move > 0 ? C.up : C.down }}>
          {change.move > 0 ? `▲${change.move}` : `▼${-change.move}`}
        </span>
      )}
    </div>
  );
}

function Row({ p, big, change, children }) {
  const highlight = change && (change.isNew || change.highlight);
  return (
    <li
      className={`flex items-center gap-3 sm:gap-4 rounded-lg px-3 sm:px-5 ${big ? "py-4" : "py-2"} transition-colors duration-700`}
      style={{ background: highlight ? "rgba(201,162,74,0.30)" : "rgba(255,255,255,0.06)" }}
    >
      <RankMark rank={p.rank} size={big ? "lg" : "md"} dark />
      <div className="flex-1 min-w-0">
        <div className={`${big ? "text-2xl sm:text-3xl" : "text-lg sm:text-xl"} font-bold text-white truncate`}>
          {p.name}
        </div>
        <div className="text-xs sm:text-sm tabular-nums" style={{ color: "rgba(255,255,255,0.55)" }}>
          {p.phoneMasked}
        </div>
      </div>
      <ChangeBadge change={change} />
      {children}
    </li>
  );
}

function Split({ ranked, renderRow }) {
  const top = ranked.filter((p) => p.rank <= 3);
  const rest = ranked.filter((p) => p.rank > 3);
  return (
    <>
      <ol className="flex flex-col gap-2 mb-2">{top.map((p) => renderRow(p, true))}</ol>
      {rest.length > 0 && <ol className="flex flex-col gap-2">{rest.map((p) => renderRow(p, false))}</ol>}
    </>
  );
}

function CashList({ ranked, changes }) {
  const renderRow = (p, big) => (
    <Row key={p.id} p={p} big={big} change={changes[p.id]}>
      <div
        className={`${big ? "text-3xl sm:text-5xl" : "text-2xl sm:text-3xl"} font-bold tabular-nums text-white whitespace-nowrap`}
      >
        {fmt(p.points)}
      </div>
    </Row>
  );
  return <Split ranked={ranked} renderRow={renderRow} />;
}

function SngList({ ranked, changes }) {
  const renderRow = (p, big) => (
    <Row key={p.id} p={p} big={big} change={changes[p.id]}>
      <div className="flex items-end gap-3 sm:gap-5 tabular-nums">
        {[
          ["第1名", p.firsts, big ? "text-3xl sm:text-5xl" : "text-2xl sm:text-3xl"],
          ["第2名", p.seconds, big ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"],
          ["第3名", p.thirds, big ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"],
        ].map(([label, n, size]) => (
          <div key={label} className="text-center" style={{ minWidth: big ? 52 : 44 }}>
            <div className={`${size} font-bold`} style={{ color: n ? "#fff" : "rgba(255,255,255,0.45)" }}>
              {n}
            </div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
              {label}
            </div>
          </div>
        ))}
      </div>
    </Row>
  );
  return <Split ranked={ranked} renderRow={renderRow} />;
}

export default function BoardPage() {
  const [data, setData] = useState({ title: DEFAULT_TITLE, players: [], sng: [], totalGames: 0 });
  const [loaded, setLoaded] = useState(false);
  const [syncOk, setSyncOk] = useState(true);
  const [view, setView] = useState(readView);
  const [rotating, setRotating] = useState("cash");
  const [now, setNow] = useState(new Date());
  const [notice, setNotice] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const r = await api("/board");
        if (stopped) return;
        setData({ ...r, sng: r.sng || [], totalGames: r.totalGames || 0 });
        setSyncOk(true);
      } catch {
        if (!stopped) setSyncOk(false);
      } finally {
        if (!stopped) setLoaded(true);
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (view !== "rotate") return;
    const t = setInterval(() => setRotating((r) => (r === "cash" ? "sng" : "cash")), ROTATE_SECONDS * 1000);
    return () => clearInterval(t);
  }, [view]);

  useEffect(() => {
    document.title = `${data.title || DEFAULT_TITLE}｜即時排行榜`;
  }, [data.title]);

  const chooseView = (v) => {
    setView(v);
    setRotating("cash");
    const url = new URL(window.location.href);
    url.searchParams.set("show", v);
    window.history.replaceState(null, "", url);
  };

  const cashRanked = useMemo(() => rankPlayers(data.players), [data.players]);
  const sngRanked = useMemo(() => rankSng(data.sng), [data.sng]);
  const cashChanges = useChanges(cashRanked, loaded, cashDiff);
  const sngChanges = useChanges(sngRanked, loaded, sngDiff);

  const active = view === "rotate" ? rotating : view;
  const isSng = active === "sng";
  const ranked = isSng ? sngRanked : cashRanked;

  const lastUpdate = isSng
    ? data.sng.reduce((m, p) => Math.max(m, new Date(p.lastAt).getTime() || 0), 0)
    : data.players.reduce((m, p) => Math.max(m, new Date(p.updatedAt).getTime() || 0), 0);

  const goFullscreen = async () => {
    try {
      if (document.fullscreenElement) return await document.exitFullscreen();
      await rootRef.current.requestFullscreen();
    } catch {
      setNotice("這個瀏覽器不支援全螢幕，可以按 F11");
      setTimeout(() => setNotice(""), 3000);
    }
  };

  const boardBtn =
    "px-3 py-2 rounded-md text-sm font-medium border hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-yellow-600";

  return (
    <div ref={rootRef} className="min-h-screen overflow-auto" style={{ background: C.feltDeep, fontFamily: FONT }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <div className="text-sm mb-2" style={{ color: C.brass, letterSpacing: "0.35em" }} aria-hidden="true">
              ♠ ♥ ♦ ♣
            </div>
            <div className="text-lg sm:text-2xl font-bold" style={{ color: C.brass }}>
              {BOARD_NAMES[active]}
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold text-white break-words">{data.title || DEFAULT_TITLE}</h1>
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              <span className="flex items-center gap-2" aria-live="polite">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${syncOk ? "motion-safe:animate-pulse" : ""}`}
                  style={{ background: syncOk ? C.up : C.down }}
                />
                {syncOk ? "即時更新中" : "連線中斷，正在重試"}
              </span>
              <span>{ranked.length} 位玩家</span>
              {isSng && <span>共 {data.totalGames} 場</span>}
              <span>最後更新 {fmtDateTime(lastUpdate || null)}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="text-3xl sm:text-4xl font-bold tabular-nums text-white">{fmtClock(now)}</div>
            <div className="flex gap-2">
              <button
                className={boardBtn}
                style={{ borderColor: "rgba(255,255,255,0.35)", color: "#fff" }}
                onClick={goFullscreen}
              >
                全螢幕
              </button>
              <a href="/" className={boardBtn} style={{ background: C.brass, borderColor: C.brass, color: C.ink }}>
                管理登入
              </a>
            </div>
          </div>
        </div>

        <div
          className="inline-flex rounded-md overflow-hidden border mb-6"
          style={{ borderColor: "rgba(255,255,255,0.25)" }}
          role="group"
          aria-label="選擇排行榜"
        >
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => chooseView(key)}
              aria-pressed={view === key}
              className="px-3 sm:px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-yellow-600"
              style={{
                background: view === key ? C.brass : "transparent",
                color: view === key ? C.ink : "rgba(255,255,255,0.8)",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {!loaded ? (
          <p className="py-20 text-center" style={{ color: "rgba(255,255,255,0.7)" }}>
            載入中…
          </p>
        ) : ranked.length === 0 ? (
          <div className="py-20 text-center" style={{ color: "rgba(255,255,255,0.7)" }}>
            <p className="text-xl font-semibold text-white mb-2">{isSng ? "還沒有賽果" : "還沒有玩家"}</p>
            <p>
              {isSng
                ? "管理員記錄 Sit and Go 賽果後，這裡會即時顯示排名。"
                : "管理員新增玩家後，這裡會即時顯示積分。"}
            </p>
          </div>
        ) : isSng ? (
          <SngList ranked={sngRanked} changes={sngChanges} />
        ) : (
          <CashList ranked={cashRanked} changes={cashChanges} />
        )}

        <p className="text-xs mt-6" style={{ color: "rgba(255,255,255,0.5)" }}>
          {isSng ? "按第 1 名次數排名，相同時比較第 2 名、第 3 名次數。" : "積分相同並列同一名次。"}
          這個頁面公開瀏覽，手機號已遮蓋。
          {view === "rotate" && `每 ${ROTATE_SECONDS} 秒切換一次。`}
        </p>
      </div>
      {notice && (
        <div
          className="fixed left-1/2 bottom-6 z-40 px-4 py-2 rounded-md text-sm shadow-lg"
          style={{ background: C.brass, color: C.ink, transform: "translateX(-50%)" }}
          role="status"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
