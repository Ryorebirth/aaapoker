export const C = {
  felt: "#1E4A3B",
  feltDeep: "#143A2F",
  page: "#E8ECE9",
  paper: "#FFFFFF",
  tint: "#F2F5F3",
  ink: "#1A1F1C",
  muted: "#5F6B66",
  line: "#D5DCD8",
  red: "#A8322A",
  brass: "#C9A24A",
  up: "#7FD1A3",
  down: "#F3A29B",
};

export const CHIP = { 1: "#9A7420", 2: "#6E7A80", 3: "#8C5530" };

export const FONT =
  '"Noto Sans SC","PingFang SC","Microsoft YaHei","Heiti SC","Noto Sans TC","PingFang HK",system-ui,sans-serif';

export const DEFAULT_TITLE = "扑克积分排行榜";

export const normPhone = (p) => String(p).replace(/[\s-]/g, "");
export const maskPhone = (p) => {
  const s = normPhone(p);
  if (s.length < 6) return s;
  const head = s.length >= 10 ? 3 : 2;
  return s.slice(0, head) + "*".repeat(s.length - head - 2) + s.slice(-2);
};
export const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const signed = (n) => (n > 0 ? "+" : "") + fmt(n);

const pad2 = (x) => String(x).padStart(2, "0");
export const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return "—";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
export const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return "—";
  return `${fmtDate(v)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
export const fmtClock = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
export const today = () => fmtDate(Date.now());
export const safeName = (s) => (s || "排行榜").replace(/[\\/:*?"<>|]/g, "_").trim() || "排行榜";
export const isEnter = (e) => e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;

// Competition ranking: equal points share a rank (1, 1, 3)
export function rankPlayers(players) {
  const sorted = [...players].sort(
    (a, b) => b.points - a.points || a.name.localeCompare(b.name, "zh-CN")
  );
  let prevPts = null;
  let prevRank = 0;
  return sorted.map((p, i) => {
    const rank = p.points === prevPts ? prevRank : i + 1;
    prevPts = p.points;
    prevRank = rank;
    return { ...p, rank };
  });
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCSV(filename, header, rows) {
  const esc = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@]/.test(s) && !/^=".*"$/.test(s) && isNaN(Number(s))) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header, ...rows].map((r) => r.map(esc).join(","));
  downloadBlob(filename, new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export const inputCls =
  "w-full px-3 py-2 rounded-md border text-base bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700";
export const btnPrimary =
  "px-4 py-2 rounded-md text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-700";
export const btnSecondary =
  "px-3 py-2 rounded-md text-sm font-medium border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-700";
export const btnRow =
  "px-2 py-1 rounded text-sm font-medium hover:bg-gray-100 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-700";

// Sit and Go: most 1st places first, then 2nd, then 3rd. Identical records share a rank.
export function rankSng(standings) {
  const sorted = [...standings].sort(
    (a, b) =>
      b.firsts - a.firsts ||
      b.seconds - a.seconds ||
      b.thirds - a.thirds ||
      a.name.localeCompare(b.name, "zh-CN")
  );
  let prev = null;
  let prevRank = 0;
  return sorted.map((p, i) => {
    const key = `${p.firsts}-${p.seconds}-${p.thirds}`;
    const rank = key === prev ? prevRank : i + 1;
    prev = key;
    prevRank = rank;
    return { ...p, rank };
  });
}

export const BOARD_NAMES = { cash: "常规赛", sng: "Sit and Go" };

export const REWARD_OPTIONS = ["盲盒", "20000积分", "10000积分"];
export const DEFAULT_REWARD = { 1: "盲盒", 2: "20000积分", 3: "10000积分" };
