# MD 編輯器 Lite (PWA 版本)

輕量級文字編輯器，支持 iCloud 文件讀取與保存。

## 版本號

狀態列左下角顯示當前版本號（如 `v0.7.0`）。

每次改動都必須同步 +1，涉及三個地方（保持一致）：

1. `app.js` 頂部 `const APP_VERSION = '...'`（**單一可信來源**，介面顯示靠它）
2. `manifest.json` 的 `"version": "..."`

這樣在手機上只要瞄一眼左下角，就知道跑的是不是最新版（記得強刷 `Cmd+Shift+R`，或移除主畫面 App 重新加入，避免 Service Worker 緩存舊版）。

## 功能特性

- ✅ 從 iCloud Drive 開啟**任意文字檔**（md / json / html / 程式碼 / csv / 設定檔 …）
- ✅ Markdown 即時預覽（.md / .markdown / .mdx）
- ✅ 非 Markdown 檔自動切語法高亮預覽（js / py / json / html / css / sh …）
- ✅ 語法高亮
- ✅ 暗色/亮色主題切換
- ✅ 字數/行數統計
- ✅ 鍵盤快捷鍵支持
- ✅ PWA 離線可用
- ✅ 響應式設計（手機/平板/桌面）
- ✅ Markdown 工具列（粗體/斜體/標題/列表/鏈接/代碼等一鍵插入）

## 使用方法

### 開啟文件
1. 點擊「開啟」按鈕
2. 在文件選擇器中導航到 iCloud Drive
3. 選擇任意文字檔（`.md` / `.json` / `.html` / `.js` / `.py` / `.csv` / `.txt` 等）
4. `.md` 檔自動切到分屏視圖（編輯 + 預覽同時顯示）；其它檔保持編輯視圖

### 保存文件
1. 編輯完成後點擊「保存」按鈕
2. 選擇保存位置（建議選擇 iCloud Drive）
3. 或按 `Ctrl/Cmd + S` 快捷鍵

### 切換預覽
- 點擊「預覽」按鈕或按 `Ctrl/Cmd + P`

### 切換主題
- 點擊「🌙」按鈕或按 `Ctrl/Cmd + B`

### Markdown 工具列
編輯區上方的工具列提供四個下拉選單，一鍵插入常用標記：

| 選單 | 功能 |
|---|---|
| **格式** | 粗體 `**`、斜體 `*`、刪除線 `~~`、高亮 `<mark>`、下劃線 `<u>` |
| **標題** | H1 ~ H6 |
| **列表** | 無序 `-`、有序 `1.`、任務 `- [ ]`、引用 `>` |
| **插入** | 鏈接、圖片、行內代碼、代碼塊、表格、分隔線 |

選中文字再點按鈕會**包裹**選中內容；沒選中則插入佔位符「文本」並自動選中，方便直接覆寫。

## 安裝為 PWA

### iOS (Safari)
1. 在 Safari 中打開頁面
2. 點擊分享按鈕
3. 選擇「加到主畫面」
4. 從主畫面打開，即可全螢幕使用

### Android (Chrome)
1. 在 Chrome 中打開頁面
2. 點擊菜單按鈕
3. 選擇「安裝應用」或「加到主畫面」

## 技術棧

- **前端框架**：Vanilla JS（無依賴）
- **Markdown 渲染**：Marked.js
- **語法高亮**：Highlight.js
- **PWA**：Service Worker + Manifest

## 支持的文件類型

| 類別 | 副檔名 | 預覽方式 |
|---|---|---|
| Markdown | `.md` `.markdown` `.mdx` | Markdown 渲染 |
| HTML | `.html` `.htm` | 語法高亮（XML） |
| JSON | `.json` `.json5` `.jsonc` | 語法高亮（JSON） |
| 設定/資料 | `.yaml` `.yml` `.toml` `.ini` `.conf` `.xml` `.csv` `.tsv` `.env` | 語法高亮或純文字 |
| 程式碼 | `.js` `.ts` `.py` `.css` `.sh` `.sql` `.go` `.rs` …（60+） | 語法高亮 |
| 純文字 | `.txt` `.log` `.diff` `.patch` 及無副檔名約定檔（Makefile/README…） | 純文字 |

> 白名單對齊 todo 編輯器的 `TEXT_EXTS`（取常用子集）。副檔名決定 MIME，iOS 儲存時會存成正確類型。

## 部署

將 `src/pwa-md-editor` 目錄部署到任何 HTTPS 服務器即可使用。
長期使用推薦推到 GitHub Pages / Netlify / Vercel，天然 HTTPS，不用每次開電腦。

## 本地啟動（電腦 + iPhone）

```bash
cd src/pwa-md-editor
./start.sh
```

腳本會自動簽發證書、啟動 HTTPS 服務，並列印 iPhone Safari 的完整操作步驟與掃碼二維碼。

### 為什麽必須 HTTPS

iPhone Safari 只在**安全上下文**下註冊 Service Worker：

| 訪問方式 | 安全上下文 | SW / 加到主畫面 / 離線 |
|---|---|---|
| `https://...` | ✅ | ✅ 全部可用 |
| `http://localhost` | ✅ | ✅ 全部可用（僅本機） |
| `http://192.168.x.x` | ❌ | ❌ 只能編輯，裝不了 PWA |

所以用手機直連局域網 IP 時，必須走 `start.sh` 的 HTTPS 模式。

### 參數

| 參數 | 作用 |
|---|---|
| `./start.sh` | 默認：局域網 HTTPS（iPhone 可用），端口 8443 |
| `./start.sh --local` | 只本機訪問，iPhone 連不上 |
| `./start.sh --http` | 純 HTTP，iPhone 只能編輯、裝不了 PWA |
| `./start.sh --send-cert` | 彈出 Finder 選中 `rootCA.pem`，供 AirDrop 到 iPhone |
| `./start.sh --trust-mac` | 把本地 CA 裝進 Mac 信任庫，消除 Mac 上的證書警告 |
| `./start.sh --port 9000` | 換端口（被占用時腳本也會自動往後找） |

### 首次給 iPhone 裝證書（只需一次，約 1 分鐘）

1. `./start.sh --send-cert` → AirDrop `rootCA.pem` 到 iPhone
2. iPhone：設置 → 通用 → VPN 與設備管理 → 描述文件「mkcert …」→ 安裝
3. iPhone：設置 → 通用 → 關於本機 → 證書信任設置 → 打開「mkcert …」開關
   （**這步不做，Safari 會拒絕註冊 Service Worker**）
4. Safari 打開 `https://<你的 Mac IP>:8443`
5. 分享 → 添加到主屏幕

腳本會檢測當前局域網 IP，IP 變了自動重簽證書（CA 不變，iPhone 不用重裝）。

### 前置依賴

```bash
brew install mkcert qrencode   # 簽證書 + 終端二維碼，只需裝一次
```

沒裝 mkcert 時腳本會自動回退到 HTTP 模式並給出提示，不會直接報錯。

## 注意事項

1. **iCloud 文件訪問**：iOS Safari 需要用戶手動選擇文件，無法自動掃描 iCloud Drive
2. **保存功能**：依平台自動分流——
   - **桌面 Chrome / Edge**：`showSaveFilePicker` 直接寫回原檔，無感存檔
   - **iOS Safari**：蘋果**完全沒實作** `showSaveFilePicker`（所有版本，MDN 相容性表確認），
     網頁無法直接覆蓋原檔，這是平台限制不是 bug。改走**系統分享面板**：
     點 💾 → 選「**儲存到檔案**」→ 導航到原位置 → 點「**取代**」
   - 不支援分享面板的瀏覽器：退回下載
3. **離線使用**：首次訪問後可離線使用，但無法訪問 iCloud 文件
4. **HTTPS 要求**：PWA 功能需要 HTTPS 環境（見上文「為什麽必須 HTTPS」）
5. **首次加載需聯網**：marked.js / highlight.js 走 jsdelivr CDN，首次打開必須聯網。
   斷網時已有 `typeof` 守衛，不會崩潰，只顯示「渲染庫未載入」，編輯功能照常可用。
   要真正離線，需把這兩個庫下載到本地 `vendor/` 並改 `index.html` 的引用。

## 文件結構

```
src/pwa-md-editor/
├── index.html      # 主頁面
├── style.css       # 樣式表
├── app.js          # 主要邏輯
├── manifest.json   # PWA 配置
├── sw.js           # Service Worker
├── icon.svg        # 應用圖標（矢量）
├── icon-192.png    # 應用圖標
├── icon-512.png    # 應用圖標
├── start.sh        # 一鍵啟動（自動簽證書 + 列印 iPhone 操作步驟）
├── serve.py        # HTTPS 靜態服務器（開發用，禁用 HTTP 緩存）
├── cert.pem        # 本地證書（自動生成，已 gitignore）
├── key.pem         # 證書私鑰（自動生成，已 gitignore）
└── README.md       # 說明文檔
```

## 未來改進

- [ ] 添加文件列表瀏覽（通過 iCloud WebDAV）
- [ ] 支持文件夾同步
- [ ] 添加版本歷史
- [ ] 支持更多文件格式（.txt, .html）
- [ ] 添加雲存儲集成（Dropbox, Google Drive）

## 許可證

MIT License
