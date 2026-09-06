# MD 編輯器 Lite (PWA 版本)

輕量級 Markdown 編輯器，支持 iCloud 文件讀取與保存。

## 功能特性

- ✅ 從 iCloud Drive 打開 `.md` 文件
- ✅ 即時 Markdown 預覽
- ✅ 語法高亮
- ✅ 暗色/亮色主題切換
- ✅ 字數/行數統計
- ✅ 鍵盤快捷鍵支持
- ✅ PWA 離線可用
- ✅ 響應式設計（手機/平板/桌面）

## 使用方法

### 打開文件
1. 點擊「打開」按鈕
2. 在文件選擇器中導航到 iCloud Drive
3. 選擇 `.md` 文件

### 保存文件
1. 編輯完成後點擊「保存」按鈕
2. 選擇保存位置（建議選擇 iCloud Drive）
3. 或按 `Ctrl/Cmd + S` 快捷鍵

### 切換預覽
- 點擊「預覽」按鈕或按 `Ctrl/Cmd + P`

### 切換主題
- 點擊「🌙」按鈕或按 `Ctrl/Cmd + B`

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

## 部署

將 `src/pwa-md-editor` 目錄部署到任何 HTTPS 服務器即可使用。

### 本地測試
```bash
# 使用 Python 啟動簡單服務器
cd src/pwa-md-editor
python3 -m http.server 8080

# 或使用 Node.js
npx serve .
```

然後訪問 `http://localhost:8080`

## 注意事項

1. **iCloud 文件訪問**：iOS Safari 需要用戶手動選擇文件，無法自動掃描 iCloud Drive
2. **保存功能**：使用 `showSaveFilePicker` API（Chrome/Edge）或回退到下載方式
3. **離線使用**：首次訪問後可離線使用，但無法訪問 iCloud 文件
4. **HTTPS 要求**：PWA 功能需要 HTTPS 環境

## 文件結構

```
src/pwa-md-editor/
├── index.html      # 主頁面
├── style.css       # 樣式表
├── app.js          # 主要邏輯
├── manifest.json   # PWA 配置
├── sw.js           # Service Worker
├── icon-192.png    # 應用圖標（需自行添加）
├── icon-512.png    # 應用圖標（需自行添加）
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
