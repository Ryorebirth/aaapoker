# 撲克積分排行榜（管理員登入 + 資料庫版）

## 功能
- 兩個計分器：
  - **Cash Game**：按積分排名，可加減分
  - **Sit and Go**：每場輸入頭三名（姓名、手機號、名次、獎勵），按第 1 名次數排名，相同時比較第 2 名、第 3 名次數。獎勵可修改，只在後台顯示
- 兩個計分器共用玩家資料，以手機號識別同一位玩家
- 管理員帳號登入（密碼以 scrypt 加密，連續輸錯 5 次鎖定 15 分鐘）
- 所有資料儲存在 Netlify Database（Postgres）
- 每次修改都記錄管理員、時間、計分器和內容
- 可新增多個管理員、修改自己的密碼
- 公開即時排行榜：`/board`，可選 Cash Game、Sit and Go 或輪流顯示（`/board?show=sng`、`/board?show=rotate`），手機號自動遮蓋
- 匯出 Excel（CSV）、圖片、文字；匯出修改紀錄

## 部署（GitHub + Netlify，不需安裝任何軟件）
1. 在 GitHub 建立一個新的 **Private** repository。
2. 點「uploading an existing file」，把本資料夾內的**所有檔案和資料夾**拖進去（包括 `netlify` 資料夾），然後 Commit。
3. 在 Netlify 選 **Add new project → Import an existing project → GitHub**，選擇這個 repository。
4. 建置設定會自動讀取 `netlify.toml`，直接按 **Deploy**。資料庫會在部署時自動建立。
5. 部署完成後**立即**打開網址，建立第一個管理員帳號。

## 部署（Netlify CLI）
```bash
npm install
npx netlify login
npx netlify init      # 建立或連結網站
npx netlify deploy --build --prod
```

## 結構
- `src/` 前端（React + Tailwind）
- `netlify/functions/api.mts` 所有 API（路徑 `/api/*`）
- `netlify/database/migrations/` 資料表結構，部署時自動套用

## 更新現有網站
在 GitHub repository 按 **Add file → Upload files**，把本資料夾內所有檔案和資料夾拖進去並 Commit。
Netlify 會自動重新部署，並自動套用 `netlify/database/migrations` 內新增的資料表變更，現有資料會保留。
