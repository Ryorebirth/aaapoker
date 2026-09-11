import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import RankMark from "../RankMark.jsx";
import { C, DEFAULT_TITLE, FONT, fmt, fmtClock, fmtDateTime, rankPlayers, signed } from "../utils.js";

function BoardRow({ p, big, change }) {
  const highlight = change && (change.isNew || change.delta !== 0);
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
      {change && (
        <div className="flex flex-col items-end text-sm font-semibold tabular-nums whitespace-nowrap">
          {change.isNew ? (
            <span style={{ color: "#E9CF8E" }}>新加入</span>
          ) : (
            change.delta !== 0 && <span style={{ color: change.delta > 0 ? C.up : C.down }}>{signed(change.delta)}</span>
          )}
          {!change.isNew && change.move !== 0 && (
            <span style={{ color: change.move > 0 ? C.up : C.down }}>
              {change.move > 0 ? `▲${change.move}` : `▼${-change.move}`}
            </span>
          )}
        </div>
      )}
      <div
        className={`${big ? "text-3xl sm:text-5xl" : "text-2xl sm:text-3xl"} font-bold tabular-nums text-white whitespace-nowrap`}
      >
        {fmt(p.points)}
      </div>
    </li>
  );
}

export default function BoardPage() {
  const [data, setData] = useState({ title: DEFAULT_TITLE, players: [] });
  const [loaded, setLoaded] = useState(false);
  const [syncOk, setSyncOk] = useState(true);
  const [changes, setChanges] = useState({});
  const [now, setNow] = useState(new Date());
  const [notice, setNotice] = useState("");
  const prevRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const r = await api("/board");
        if (stopped) return;
        setData(r);
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
    document.title = data.title || DEFAULT_TITLE;
  }, [data.title]);

  const ranked = useMemo(() => rankPlayers(data.players), [data.players]);

  // Highlight point and rank changes for a few seconds
  useEffect(() => {
    if (!loaded) return;
    const cur = {};
    ranked.forEach((p) => (cur[p.id] = { points: p.points, rank: p.rank }));
    const prev = prevRef.current;
    prevRef.current = cur;
    if (!prev) return;
    const found = {};
    ranked.forEach((p) => {
      const o = prev[p.id];
      if (!o) found[p.id] = { isNew: true, delta: p.points, move: 0 };
      else {
        const delta = Math.round((p.points - o.points) * 100) / 100;
        const move = o.rank - p.rank;
        if (delta !== 0 || move !== 0) found[p.id] = { isNew: false, delta, move };
      }
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
  }, [ranked, loaded]);

  const lastUpdate = data.players.reduce((m, p) => {
    const t = new Date(p.updatedAt).getTime() || 0;
    return t > m ? t : m;
  }, 0);

  const goFullscreen = async () => {
    try {
      if (document.fullscreenElement) return await document.exitFullscreen();
      await rootRef.current.requestFullscreen();
    } catch {
      setNotice("這個瀏覽器不支援全螢幕，可以按 F11");
      setTimeout(() => setNotice(""), 3000);
    }
  };

  const top = ranked.filter((p) => p.rank <= 3);
  const rest = ranked.filter((p) => p.rank > 3);
  const boardBtn =
    "px-3 py-2 rounded-md text-sm font-medium border hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-yellow-600";

  return (
    <div ref={rootRef} className="min-h-screen overflow-auto" style={{ background: C.feltDeep, fontFamily: FONT }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6 sm:mb-8">
          <div className="min-w-0">
            <div className="text-sm mb-2" style={{ color: C.brass, letterSpacing: "0.35em" }} aria-hidden="true">
              ♠ ♥ ♦ ♣
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
              <span>{data.players.length} 位玩家</span>
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
              <a
                href="/"
                className={boardBtn}
                style={{ background: C.brass, borderColor: C.brass, color: C.ink }}
              >
                管理登入
              </a>
            </div>
          </div>
        </div>

        {!loaded ? (
          <p className="py-20 text-center" style={{ color: "rgba(255,255,255,0.7)" }}>
            載入中…
          </p>
        ) : ranked.length === 0 ? (
          <div className="py-20 text-center" style={{ color: "rgba(255,255,255,0.7)" }}>
            <p className="text-xl font-semibold text-white mb-2">還沒有玩家</p>
            <p>管理員新增玩家後，這裡會即時顯示積分。</p>
          </div>
        ) : (
          <>
            <ol className="flex flex-col gap-2 mb-2">
              {top.map((p) => (
                <BoardRow key={p.id} p={p} big change={changes[p.id]} />
              ))}
            </ol>
            {rest.length > 0 && (
              <ol className="flex flex-col gap-2">
                {rest.map((p) => (
                  <BoardRow key={p.id} p={p} change={changes[p.id]} />
                ))}
              </ol>
            )}
          </>
        )}
        <p className="text-xs mt-6" style={{ color: "rgba(255,255,255,0.5)" }}>
          積分相同並列同一名次。這個頁面公開瀏覽，手機號已遮蓋。
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
