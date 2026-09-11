import { C, CHIP, FONT, DEFAULT_TITLE, fmt, fmtDate, today } from "./utils.js";

function fitText(ctx, text, max) {
  let s = String(text);
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s + "…";
}

// ranked: [{ rank, name, points, updatedAt }], phoneOf: (player) => string
export function buildRankingImage({ title, ranked, phoneOf }) {
  const LIMIT = 150;
  const rows = ranked.slice(0, LIMIT);
  const W = 1080;
  const pad = 56;
  const headerH = 210;
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
  ctx.fillText("♠ ♥ ♦ ♣", W - pad, 92);

  ctx.textAlign = "left";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 58px ${FONT}`;
  ctx.fillText(fitText(ctx, title || DEFAULT_TITLE, W - pad * 2 - 200), pad, 92);
  ctx.font = `28px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(`${today()}　共 ${ranked.length} 位玩家`, pad, 152);

  const xName = pad + 100;
  const xPhone = 470;
  const xDate = 700;
  const cy0 = headerH + colH / 2;
  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("排名", pad, cy0);
  ctx.fillText("姓名", xName, cy0);
  ctx.fillText("手機號", xPhone, cy0);
  ctx.fillText("最後更新", xDate, cy0);
  ctx.textAlign = "right";
  ctx.fillText("積分", W - pad, cy0);
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

    ctx.textAlign = "left";
    ctx.fillStyle = C.ink;
    ctx.font = `bold 32px ${FONT}`;
    ctx.fillText(fitText(ctx, p.name, xPhone - xName - 30), xName, cy);
    ctx.fillStyle = C.muted;
    ctx.font = `28px ${FONT}`;
    ctx.fillText(fitText(ctx, phoneOf(p), xDate - xPhone - 20), xPhone, cy);
    ctx.font = `24px ${FONT}`;
    ctx.fillText(fmtDate(p.updatedAt), xDate, cy);
    ctx.textAlign = "right";
    ctx.fillStyle = C.ink;
    ctx.font = `bold 36px ${FONT}`;
    ctx.fillText(fmt(p.points), W - pad, cy);
  });

  ctx.textAlign = "left";
  ctx.fillStyle = C.muted;
  ctx.font = `22px ${FONT}`;
  const note =
    ranked.length > LIMIT
      ? `積分相同並列同一名次。圖片只顯示前 ${LIMIT} 名，完整名單請匯出 Excel。`
      : "積分相同並列同一名次";
  ctx.fillText(note, pad, H - footH / 2);

  return cv.toDataURL("image/png");
}
