# 撲克積分排行榜（管理員登入 + 資料庫版）

## 功能
- 管理員帳號登入（密碼以 scrypt 加密，連續輸錯 5 次鎖定 15 分鐘）
- 玩家、積分、登記及更新日期儲存在 Netlify Database（Postgres）
- 每次新增、加減分、修改、刪除都記錄管理員、時間、分數變化和備註
- 可新增多個管理員、修改自己的密碼
- 公開即時排行榜：`/board`（手機號自動遮蓋）
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
