# 扑克积分排行榜（管理员登入 + 资料库版）

## 功能
- 两个计分器：
  - **常规赛**：按积分排名，可加减分
  - **Sit and Go**：每场可输入头三名（全部选填），按第 1 名次数排名，相同时比较第 2 名、第 3 名次数。每个名次可选择奖励（盲盒、20000积分、10000积分），只在后台显示
  - **奖励纪录表**：按奖励种类列出持有人和未使用数量，玩家使用奖励时可即时减除，按错可以复原
- 两个计分器共用玩家资料，以手机号识别同一位玩家
- 管理员帐号登入（密码以 scrypt 加密，连续输错 5 次锁定 15 分钟）
- 所有资料储存在 Netlify Database（Postgres）
- 每次修改都记录管理员、时间、计分器和内容
- 可新增多个管理员、修改自己的密码
- 公开即时排行榜：`/board`，可选常规赛、Sit and Go 或轮流显示（`/board?show=sng`、`/board?show=rotate`），手机号自动遮盖
- 汇出 Excel（CSV）、图片、文字；汇出修改纪录

## 部署（GitHub + Netlify，不需安装任何软件）
1. 在 GitHub 建立一个新的 **Private** repository。
2. 点「uploading an existing file」，把本资料夹内的**所有档案和资料夹**拖进去（包括 `netlify` 资料夹），然后 Commit。
3. 在 Netlify 选 **Add new project → Import an existing project → GitHub**，选择这个 repository。
4. 建置设定会自动读取 `netlify.toml`，直接按 **Deploy**。资料库会在部署时自动建立。
5. 部署完成后**立即**打开网址，建立第一个管理员帐号。

## 部署（Netlify CLI）
```bash
npm install
npx netlify login
npx netlify init      # 建立或连结网站
npx netlify deploy --build --prod
```

## 结构
- `src/` 前端（React + Tailwind）
- `netlify/functions/api.mts` 所有 API（路径 `/api/*`）
- `netlify/database/migrations/` 资料表结构，部署时自动套用

## 语言
介面为简体中文。玩家姓名等使用者输入的资料不会自动转换。

## 更新现有网站
在 GitHub repository 按 **Add file → Upload files**，把本资料夹内所有档案和资料夹拖进去并 Commit。
Netlify 会自动重新部署，并自动套用 `netlify/database/migrations` 内新增的资料表变更，现有资料会保留。
