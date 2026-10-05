import { C, CHIP } from "./utils.js";

export default function RankMark({ rank, size = "md", dark = false }) {
  const color = CHIP[rank];
  const box = size === "lg" ? "w-14 h-14" : "w-10 h-10";
  const txt = size === "lg" ? "text-xl" : "text-base";
  if (!color) {
    return (
      <div
        className={`${box} shrink-0 flex items-center justify-center text-lg font-semibold tabular-nums`}
        style={{ color: dark ? "rgba(255,255,255,0.7)" : C.muted }}
      >
        {rank}
      </div>
    );
  }
  return (
    <div
      className={`${box} shrink-0 rounded-full flex items-center justify-center relative`}
      style={{ background: color }}
      aria-label={`第 ${rank} 名`}
    >
      <div
        className="absolute rounded-full"
        style={{ top: 4, left: 4, right: 4, bottom: 4, border: "2px dashed rgba(255,255,255,0.85)" }}
      />
      <span className={`relative text-white font-bold ${txt} tabular-nums`}>{rank}</span>
    </div>
  );
}
