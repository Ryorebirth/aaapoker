import { C, CHIP, FONT, DEFAULT_TITLE, fmt, fmtDate, today } from "./utils.js";

function fitText(ctx, text, max) {
  let s = String(text);
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s + "…";
}

// Generic ranking image.
// columns: [{ label, x, align: "left"|"center"|"right", max, font, color, value: (row) => string }]
function buildImage({ title, subtitle, rows: allRows, columns, note }) {
  const LIMIT = 150;
  const rows = allRows.slice(0, LIMIT);
  const W = 1080;
  const pad = 56;
  const headerH = 230;
  const colH = 64;
  const rowH = 84;
  const footH = 96;
  const H = headerH + colH + rows.length * rowH + footH;
  const scale = H * 2 > 16000 ? 1 : 2;
  const cv = document.createElement("canvas");
  cv.width = W * scale;
  cv.height = H * scale;
  const ctx = cv.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.felt;
  ctx.fillRect(0, 0, W, headerH);

  ctx.textAlign = "right";
  ctx.fillStyle = C.brass;
  ctx.font = `40px ${FONT}`;
  ctx.fillText("♠ ♥ ♦ ♣", W - pad, 80);

  ctx.textAlign = "left";
  ctx.fillStyle = C.brass;
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillText(subtitle, pad, 62);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 58px ${FONT}`;
  ctx.fillText(fitText(ctx, title || DEFAULT_TITLE, W - pad * 2 - 200), pad, 122);
  ctx.font = `28px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(`${today()}　共 ${allRows.length} 位玩家`, pad, 182);

  const cy0 = headerH + colH / 2;
  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "left";
  ctx.fillText("排名", pad, cy0);
  columns.forEach((col) => {
    ctx.textAlign = col.align || "left";
    ctx.fillText(col.label, col.x, cy0);
  });
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, headerH + colH - 1);
  ctx.lineTo(W - pad, headerH + colH - 1);
  ctx.stroke();

  rows.forEach((p, i) => {
    const y = headerH + colH + i * rowH;
    const cy = y + rowH / 2;
    if (i % 2 === 1) {
      ctx.fillStyle = C.tint;
      ctx.fillRect(0, y, W, rowH);
    }
    const cx = pad + 28;
    const chip = CHIP[p.rank];
    ctx.textAlign = "center";
    if (chip) {
      ctx.fillStyle = chip;
      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold 26px ${FONT}`;
    } else {
      ctx.fillStyle = C.muted;
      ctx.font = `bold 30px ${FONT}`;
    }
    ctx.fillText(String(p.rank), cx, cy + 1);

    columns.forEach((col) => {
      ctx.textAlign = col.align || "left";
      ctx.fillStyle = col.color || C.ink;
      ctx.font = `${col.font || "28px"} ${FONT}`;
      const v = col.value(p);
      ctx.fillText(col.max ? fitText(ctx, v, col.max) : String(v), col.x, cy);
    });
  });

  ctx.textAlign = "left";
  ctx.fillStyle = C.muted;
  ctx.font = `22px ${FONT}`;
  const fullNote =
    allRows.length > LIMIT ? `${note}。圖片只顯示前 ${LIMIT} 名，完整名單請匯出 Excel。` : note;
  ctx.fillText(fullNote, pad, H - footH / 2);

  return cv.toDataURL("image/png");
}

export function buildRankingImage({ title, ranked, phoneOf }) {
  const pad = 56;
  return buildImage({
    title,
    subtitle: "Cash Game",
    rows: ranked,
    note: "積分相同並列同一名次",
    columns: [
      { label: "姓名", x: pad + 100, max: 284, font: "bold 32px", value: (p) => p.name },
      { label: "手機號", x: 470, max: 210, color: C.muted, value: phoneOf },
      { label: "最後更新", x: 700, font: "24px", color: C.muted, value: (p) => fmtDate(p.updatedAt) },
      { label: "積分", x: 1080 - pad, align: "right", font: "bold 36px", value: (p) => fmt(p.points) },
    ],
  });
}

export function buildSngImage({ title, ranked, phoneOf }) {
  const pad = 56;
  return buildImage({
    title,
    subtitle: "Sit and Go",
    rows: ranked,
    note: "按第 1 名次數排名，相同時比較第 2 名、第 3 名次數",
    columns: [
      { label: "姓名", x: pad + 100, max: 300, font: "bold 32px", value: (p) => p.name },
      { label: "手機號", x: 480, max: 220, color: C.muted, value: phoneOf },
      { label: "第1名", x: 770, align: "center", font: "bold 36px", value: (p) => p.firsts },
      { label: "第2名", x: 880, align: "center", font: "30px", value: (p) => p.seconds },
      { label: "第3名", x: 990, align: "center", font: "30px", value: (p) => p.thirds },
    ],
  });
}
