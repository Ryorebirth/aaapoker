import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  ["cash", "常规赛"],
  ["sng", "Sit and Go"],
  ["rotate", "轮流显示"],
];

// Below this many players the whole Cash Game list gets the large treatment
const BIG_ROW_LIMIT = 6;
// Sit and Go always shows its leading players in double size
const SNG_BIG_ROWS = 4;
// Two columns once the list gets long, so twice as many players fit on screen
const TWO_COLUMN_FROM = 9;
const MIN_SCALE = 0.4;

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

function ChangeBadge({ change, big }) {
  if (!change) return null;
  return (
    <div
      className={`${big ? "text-sm" : "text-xs"} font-semibold tabular-nums whitespace-nowrap text-right ml-2`}
    >
      {change.isNew && <div style={{ color: "#E9CF8E" }}>新加入</div>}
      {!change.isNew && change.delta !== undefined && change.delta !== 0 && (
        <div style={{ color: change.delta > 0 ? C.up : C.down }}>{signed(change.delta)}</div>
      )}
      {!change.isNew &&
        change.gained &&
        change.gained.map((g) => (
          <div key={g} style={{ color: C.up }}>
            {g}
          </div>
        ))}
      {!change.isNew && change.move !== 0 && (
        <div style={{ color: change.move > 0 ? C.up : C.down }}>
          {change.move > 0 ? `▲${change.move}` : `▼${-change.move}`}
        </div>
      )}
    </div>
  );
}

/*
 * Spacing uses margins instead of flex `gap`, because the browser built into
 * older TVs does not support gap in flexbox and would render everything squashed.
 */
function Row({ p, big, change, children }) {
  const highlight = change && (change.isNew || change.highlight);
  return (
    <li
      className={`flex items-center rounded-lg ${big ? "px-4 py-3" : "px-3 py-2"} mb-2 transition-colors duration-700`}
      style={{ background: highlight ? "rgba(201,162,74,0.30)" : "rgba(255,255,255,0.06)" }}
    >
      <div className={big ? "mr-4" : "mr-3"}>
        <RankMark rank={p.rank} size={big ? "lg" : "md"} dark />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`${big ? "text-4xl" : "text-xl"} font-bold text-white truncate leading-tight`}>
          {p.name}
        </div>
        <div
          className={`${big ? "text-lg" : "text-sm"} tabular-nums truncate`}
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          {p.phoneMasked}
        </div>
      </div>
      <ChangeBadge change={change} big={big} />
      {children}
    </li>
  );
}

function CashRow({ p, big, change }) {
  return (
    <Row p={p} big={big} change={change}>
      <div
        className={`${big ? "text-5xl" : "text-3xl"} font-bold tabular-nums text-white whitespace-nowrap ml-4 leading-none`}
      >
        {fmt(p.points)}
      </div>
    </Row>
  );
}

function SngRow({ p, big, change }) {
  // The 1st-place count decides the ranking, so it is the largest number on the row
  const stats = [
    ["第1名", p.firsts, big ? "text-8xl" : "text-4xl"],
    ["第2名", p.seconds, big ? "text-6xl" : "text-3xl"],
    ["第3名", p.thirds, big ? "text-6xl" : "text-3xl"],
  ];
  return (
    <Row p={p} big={big} change={change}>
      <div className="flex items-end tabular-nums ml-3">
        {stats.map(([label, n, size], i) => (
          <div
            key={label}
            className={i ? "text-center ml-4" : "text-center"}
            style={{ minWidth: big ? 118 : 58 }}
          >
            <div
              className={`${size} font-bold leading-none`}
              style={{ color: n ? "#fff" : "rgba(255,255,255,0.35)" }}
            >
              {n}
            </div>
            <div
              className={big ? "text-lg mt-1" : "text-xs mt-1"}
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>
    </Row>
  );
}

/** Splits the list into one or two columns and shrinks it until everything fits the screen. */
function AutoFitList({ ranked, changes, RowComponent, signature, bigCount, bigRank }) {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(1);

  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const available = window.innerHeight - wrap.getBoundingClientRect().top - 40;
    const natural = inner.scrollHeight;
    if (available <= 0 || natural <= 0) return;
    const next = Math.min(1, Math.max(MIN_SCALE, available / natural));
    setScale((prev) => (Math.abs(prev - next) > 0.01 ? next : prev));
  }, []);

  useLayoutEffect(() => {
    setScale(1);
  }, [signature]);

  useLayoutEffect(() => {
    fit();
  });

  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  const twoColumns = ranked.length >= TWO_COLUMN_FROM;
  // bigCount rows at the top are shown double size; the rest stay compact
  const bigRows = bigCount === undefined ? (ranked.length <= BIG_ROW_LIMIT && !twoColumns ? ranked.length : 0) : bigCount;
  const half = Math.ceil(ranked.length / 2);
  const columns = twoColumns
    ? [
        { rows: ranked.slice(0, half), offset: 0 },
        { rows: ranked.slice(half), offset: half },
      ]
    : [{ rows: ranked, offset: 0 }];

  return (
    <div ref={wrapRef} style={{ overflow: "hidden" }}>
      <div
        ref={innerRef}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: `${100 / scale}%`,
        }}
      >
        <div className={twoColumns ? "flex" : ""}>
          {columns.map((col, i) => (
            <ol
              key={i}
              className={twoColumns ? "flex-1 min-w-0" : ""}
              style={twoColumns && i === 0 ? { marginRight: 16 } : undefined}
            >
              {col.rows.map((p, j) => (
                <RowComponent
                  key={p.id}
                  p={p}
                  big={bigRank ? p.rank <= bigRank : col.offset + j < bigRows}
                  change={changes[p.id]}
                />
              ))}
            </ol>
          ))}
        </div>
      </div>
    </div>
  );
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
    document.title = `${data.title || DEFAULT_TITLE}｜即时排行榜`;
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
      setNotice("这个浏览器不支援全屏，可以按 F11");
      setTimeout(() => setNotice(""), 3000);
    }
  };

  const boardBtn =
    "px-3 py-1 rounded-md text-sm font-medium border hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-yellow-600";

  return (
    <div
      ref={rootRef}
      className="min-h-screen overflow-hidden"
      style={{ background: C.feltDeep, fontFamily: FONT }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-bold leading-tight" style={{ color: C.brass }}>
              {BOARD_NAMES[active]}
            </div>
            <h1 className="text-2xl sm:text-4xl font-bold text-white leading-tight truncate">
              {data.title || DEFAULT_TITLE}
            </h1>
            <div className="text-xs sm:text-sm mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>
              <span className="inline-flex items-center mr-4" aria-live="polite">
                <span
                  className={`inline-block w-2 h-2 rounded-full mr-2 ${syncOk ? "motion-safe:animate-pulse" : ""}`}
                  style={{ background: syncOk ? C.up : C.down }}
                />
                {syncOk ? "即时更新中" : "连线中断，正在重试"}
              </span>
              <span className="mr-4">{ranked.length} 位玩家</span>
              {isSng && <span className="mr-4">共 {data.totalGames} 场</span>}
              <span className="mr-4">最后更新 {fmtDateTime(lastUpdate || null)}</span>
            </div>
          </div>
          <div className="text-right shrink-0 ml-4">
            <div className="text-2xl sm:text-3xl font-bold tabular-nums text-white leading-none">
              {fmtClock(now)}
            </div>
            <div className="mt-2">
              <button
                className={boardBtn + " mr-2"}
                style={{ borderColor: "rgba(255,255,255,0.35)", color: "#fff" }}
                onClick={goFullscreen}
              >
                全屏
              </button>
              <a href="/" className={boardBtn} style={{ background: C.brass, borderColor: C.brass, color: C.ink }}>
                管理登入
              </a>
            </div>
          </div>
        </div>

        <div
          className="inline-flex rounded-md overflow-hidden border mb-3"
          style={{ borderColor: "rgba(255,255,255,0.25)" }}
          role="group"
          aria-label="选择排行榜"
        >
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => chooseView(key)}
              aria-pressed={view === key}
              className="px-3 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-yellow-600"
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
            载入中…
          </p>
        ) : ranked.length === 0 ? (
          <div className="py-20 text-center" style={{ color: "rgba(255,255,255,0.7)" }}>
            <p className="text-xl font-semibold text-white mb-2">{isSng ? "还没有赛果" : "还没有玩家"}</p>
            <p>
              {isSng
                ? "管理员记录 Sit and Go 赛果后，这里会即时显示排名。"
                : "管理员新增玩家后，这里会即时显示积分。"}
            </p>
          </div>
        ) : (
          <AutoFitList
            ranked={ranked}
            changes={isSng ? sngChanges : cashChanges}
            RowComponent={isSng ? SngRow : CashRow}
            bigRank={isSng ? SNG_BIG_ROWS : undefined}
            signature={`${active}-${ranked.length}`}
          />
        )}
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
