# 智匯數據簡報神器 — 初步提案構想

> 台新新光金控 × 雲湧智生：臺灣生成式 AI 應用黑客松競賽

---

## 一、系統概述

**產品定位**：AI 驅動的「Excel 報表 → 專業簡報」自動化生成系統

使用者上傳金管會信用卡月報 Excel（34 家銀行 × 12 個月份），輸入自然語言分析需求後，系統透過多步驟 AI Pipeline 自動完成：

1. 需求理解與受眾分析
2. 指標探索與可行性驗證
3. 數據計算與策略洞察生成
4. 簡報架構設計（逐頁規劃）
5. 原生可編輯 PPTX 輸出

**核心價值**：每一個數字都可追溯、每一張圖表都可編輯、每一頁都有 AI 策略洞察。

---

## 二、完整流程與階段說明

### 使用者旅程（7 個階段）

```
① 上傳 → ② AI 分析 → ③ 確認計劃 → ④ 執行 → ⑤ 預覽編輯 → ⑥ 輸出 → ⑦ 寄送
```

| 階段 | 使用者動作 | 系統行為 |
|------|-----------|---------|
| ① 上傳 | 拖入 Excel/CSV/PDF + 輸入需求文字 | 多格式解析（xlsx, papaparse, pdfjs-dist），自動偵測月份檔案並合併 |
| ② AI 分析 | 等待，觀看進度 | 執行 5 步驟 AI Pipeline（詳見下方） |
| ③ 確認計劃 | 審閱指標、假設、洞察，可修改後核准 | 呈現 AI 規劃結果供人工確認 |
| ④ 執行 | 等待 | 確定性指標計算 + AI 簡報 JSON 生成 + 驗證 |
| ⑤ 預覽編輯 | 拖曳調整順序、編輯內容 | 即時 Canvas 渲染投影片 |
| ⑥ 輸出 | 點擊下載 | PptxGenJS 生成原生可編輯 PPTX |
| ⑦ 寄送 | 模擬寄出 | 模擬 Email 發送流程 |

---

## 三、AI Pipeline 流程控制（核心技術）

### 3.1 Pipeline 五步驟架構

```
┌─────────────────────────────────────────────────────────┐
│                    AI Pipeline (5 Steps)                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Step 1: Brief（需求解讀）                                │
│    └─ 判斷受眾、目的、語氣、頁數、設計指令                    │
│                                                          │
│  Step 2: Metrics（指標探索）                               │
│    ├─ Pass 1: 從 Prompt 提取使用者要的指標                  │
│    ├─ Pass 2: 逐項判斷「能不能從現有資料計算」               │
│    └─ Pass 3: 補齊遺漏指標                                │
│                                                          │
│  Step 3: Insights（策略洞察）                              │
│    └─ 依受眾深度，為每個面向生成含數據的洞察                  │
│                                                          │
│  Step 4: Blueprint（簡報架構）                             │
│    ├─ Phase A: 段落大綱（頁數分配）                         │
│    └─ Phase B: 逐段展開（每頁標題、訊息、元素）              │
│                                                          │
│  Step 5: Compliance（一致性驗證）                           │
│    └─ 比對原始需求，找出遺漏，自動補齊                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3.2 各步驟 AI 判斷邏輯

#### Step 1: Brief — 需求解讀

**輸入**：使用者 Prompt + Excel 結構摘要

**AI 判斷項目**：
- `audience`：報告給誰看（e.g. 信用卡事業部副總經理）
- `purpose`：報告目的
- `tone`：語氣風格
- `depth`：executive / detailed / technical
- `requestedPageCount`：使用者明確指定的頁數（null 代表系統自行規劃）
- `designDirectives`：版面、配色要求
- `narrativeStyle`：文字敘述風格
- `chartPreferences`：偏好圖表類型
- `constraints`：硬性限制（如不做預測、必須標註來源）

#### Step 2: Metrics — 指標探索（三輪對話）

**第一輪**：從 Prompt 抽取使用者提到的所有指標名稱

**第二輪**：逐項判斷每個指標是否可從現有欄位計算
- 可計算 → 歸入 `metrics`，附上公式與對受眾的意義
- 不可計算 → 歸入 `unsupported`，說明缺少什麼資料（如 YoY 缺少去年同期）

**第三輪**：自動偵測遺漏，補齊使用者要求但前兩輪未覆蓋的指標

**可用計算方式**：
| 指標類型 | 公式 |
|---------|------|
| 市占率 | 個別銀行 ÷ 總計 × 100% |
| 月增率(MoM) | (本月 − 上月) ÷ 上月 × 100% |
| 排名 | 依數值大小排序 |
| 有效卡率 | 有效卡數 ÷ 流通卡數 × 100% |
| 停卡率 | 當月停卡數 ÷ 流通卡數 × 100% |
| 單卡平均消費力 | 當月簽帳金額 ÷ 有效卡數 |

#### Step 3: Insights — 策略洞察生成

**AI 角色**：策略顧問，從確定性計算結果找出決策價值

每個洞察包含：
- `topic`：主題
- `keyFinding`：核心發現（像新聞標題，必須含數字）
- `dataPoints`：2-4 個支撐數據（銀行、期間、數值）
- `implication`：對台新的意義（So What）
- `recommendation`：可執行建議（Now What）
- `chartSuggestion`：建議圖表類型

**品質控制**：
- 只能使用確定性計算引擎提供的數據
- 資料不足就不產出該洞察
- 建議要具體到可排進工作計畫

#### Step 4: Blueprint — 簡報架構設計（兩階段）

**Phase A — 段落大綱**：
- 決定報告分幾個段落、每段承擔什麼角色
- 自動分配頁數（依受眾深度 + 洞察數量）
- 若使用者指定頁數，嚴格遵守

**Phase B — 逐段展開**：
- 對每個分析段落，AI 設計具體的每一頁
- 每頁指定：pageTitle、layout、message、elements、metricIds、insightTopics
- 確保視覺節奏、數據與解讀成對

**頁數預算計算**：
```
使用者指定 → 直接使用
未指定 → max(9, min(max(依深度, 依洞察數×2+5), 20))
```

#### Step 5: Compliance — 一致性驗證

**AI 逐項比對**：
1. 使用者的每個指標是否都在 metrics 裡？
2. 每個分析面向是否都有 insight？
3. 報告對象、語氣是否在架構中體現？
4. 設計要求（頁數、圖表風格）是否被執行？
5. 是否有使用者明確要求但被遺漏的分析點？

**自動修正**：若發現遺漏，補齊 additionalMetrics 和 additionalInsights。

### 3.3 AI 呼叫品質保障機制

| 機制 | 說明 |
|------|------|
| 佔位符偵測 | 偵測「...」、空字串、欄位名稱當值等無效輸出 |
| 自動重試 | 每步最多重試 3 次，第 2 次起提高 temperature |
| JSON 修復 | 截斷的 JSON 自動閉合括號，保留已完成的元素 |
| 多 Provider 降級 | 主 Provider 失敗自動切換備援 |
| 回應快取 | 5 分鐘內相同請求直接返回快取 |
| 逾時控制 | 每個請求 5 分鐘逾時，防止 serverless gateway 504 |

### 3.4 確定性計算引擎（非 AI）

所有數字由瀏覽器端程式計算，不依賴 AI：
- 從 Excel 提取所有數據點，建立 SourceRef（含檔名、工作表、儲存格位址）
- 計算市占率、排名、MoM
- 生成圖表資料集（line chart, bar chart）
- 每個計算結果保留完整計算步驟（公式 + 來源追溯）

---

## 四、AI 生成簡報 JSON 的二次驗證

```
┌──────────────────────────────────────────────────┐
│          Slide Spec 生成 + 驗證                    │
├──────────────────────────────────────────────────┤
│                                                   │
│  Pass 1: 生成                                     │
│    └─ 依 Blueprint 逐頁產出完整 JSON               │
│                                                   │
│  Pass 2: 驗證 & 修正                               │
│    ├─ 封面是否為 page 1？                          │
│    ├─ 目錄是否列出所有段落？                        │
│    ├─ 每個段落標題頁後是否有 content 頁？           │
│    ├─ 頁碼是否連續？                               │
│    ├─ content 頁是否至少 heading + 2 數據元素？     │
│    └─ 是否有 chart / kpi_block / comparison？      │
│                                                   │
│  Post-processing:                                 │
│    └─ 強制頁碼連續遞增                             │
│                                                   │
└──────────────────────────────────────────────────┘
```

---

## 五、AWS 服務架構規劃

### 5.1 目標架構（符合競賽規定）

競賽限定使用 **Amazon Bedrock、SageMaker AI、Kiro，及 AWS 相關雲端服務**。

### 5.2 架構圖

```
┌─────────────────────────────────────────────────────────────────┐
│                         使用者瀏覽器                              │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AWS Amplify Hosting                            │
│              （React SPA 靜態託管 + CDN）                          │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│               Amazon API Gateway (HTTP API)                       │
│                    + Amazon Cognito 認證                          │
└──────┬─────────────┬──────────────────┬──────────────────────────┘
       │             │                  │
       ▼             ▼                  ▼
┌─────────────┐ ┌──────────┐ ┌─────────────────────────┐
│  Lambda     │ │  Lambda  │ │   AWS Step Functions     │
│  API        │ │  Upload  │ │   (Standard Workflow)    │
│  Handlers   │ │  Handler │ │                          │
└─────────────┘ └────┬─────┘ └────────────┬────────────┘
                     │                     │
                     ▼                     ▼
              ┌─────────────┐    ┌─────────────────────┐
              │  Amazon S3  │    │  Workflow 步驟：      │
              │  (Input)    │    │                      │
              └─────────────┘    │  1. Parse Excel      │
                                 │     (Lambda Python)  │
                                 │                      │
                                 │  2. Compute Metrics  │
                                 │     (Lambda Python)  │
                                 │                      │
                                 │  3. AI Pipeline      │
                                 │     (Amazon Bedrock) │
                                 │                      │
                                 │  4. Generate Slides  │
                                 │     (Amazon Bedrock) │
                                 │                      │
                                 │  5. Validate         │
                                 │     (Lambda)         │
                                 │                      │
                                 │  6. Render PPTX      │
                                 │     (Lambda Node.js) │
                                 │                      │
                                 └──────────┬──────────┘
                                            │
                                            ▼
                                 ┌─────────────────────┐
                                 │  Amazon S3           │
                                 │  (Artifacts Output)  │
                                 └─────────────────────┘
```

### 5.3 AWS 服務清單與用途

| 服務 | 用途 | 說明 |
|------|------|------|
| **Amazon Bedrock** | LLM 推論 | 使用 Claude 3.5 Sonnet / Haiku 進行 5 步驟 AI Pipeline + 簡報生成 + 驗證。透過 Converse API 統一呼叫，搭配 Structured Outputs 輸出 JSON |
| **Amazon Bedrock Guardrails** | 內容安全 | 防止生成不當內容、確保金融數據敘述合規 |
| **AWS Step Functions** | 流程編排 | Standard Workflow 編排整個分析流程，支援人工審核等待（Callback Pattern）、平行計算、錯誤處理與重試 |
| **AWS Lambda** | 無伺服器運算 | Python: Excel 解析、指標計算、驗證；Node.js: PPTX 渲染（PptxGenJS） |
| **Amazon S3** | 物件儲存 | 分區儲存：input/（上傳檔案）、evidence/（計算結果）、artifacts/（PPTX/XLSX）、audit/（稽核記錄） |
| **Amazon API Gateway** | API 入口 | HTTP API + CORS + 整合 Cognito Authorizer |
| **Amazon Cognito** | 身份認證 | 使用者登入、JWT Token 驗證、角色權限控制 |
| **Amazon DynamoDB** | Job 狀態管理 | 儲存 Job metadata、狀態、Callback Token，低延遲查詢 |
| **Amazon CloudWatch** | 可觀測性 | 各階段延遲指標、Bedrock 呼叫成功/失敗率、驗證錯誤次數 |
| **AWS Amplify Hosting** | 前端部署 | React SPA 靜態託管 + CloudFront CDN + 自動 CI/CD |
| **AWS CDK** | IaC | 以 TypeScript 定義所有基礎設施，可重複部署 |
| **Amazon EventBridge** | 事件驅動 | S3 上傳事件觸發 Step Functions、通知下游系統 |
| **AWS KMS** | 加密 | S3 物件 SSE-KMS 加密，保護金融數據 |
| **Kiro** | AI 開發工具 | 使用 Kiro IDE 進行規格設計、任務拆解、程式碼生成，留下完整開發軌跡 |

### 5.4 Amazon Bedrock 使用策略

| 模型 | 用途 | 原因 |
|------|------|------|
| Claude 3.5 Sonnet | Pipeline Step 3-4（洞察 + 架構） | 需要深度推理與創造力 |
| Claude 3.5 Haiku | Pipeline Step 1-2, 5（需求解讀、指標、驗證） | 速度快、成本低，適合結構化判斷 |
| Claude 3.5 Sonnet | 簡報 JSON 生成 + 驗證 | 長輸出（12K tokens）需要穩定性 |

**Bedrock 特性運用**：
- **Converse API**：統一模型呼叫介面，方便切換模型
- **Structured Outputs**：強制 JSON Schema 輸出，減少解析錯誤
- **Guardrails**：內容過濾 + 敏感資訊偵測
- **Prompt Caching**：對重複的 System Prompt 啟用快取，降低延遲與成本

### 5.5 版面排版策略

不使用固定元素數量限制，改用「版面覆蓋率」作為排版決策依據：

**核心原則**：頁面覆蓋率目標 75-85%，既不會空洞也不會擁擠。

**做法**：
- AI 在生成每個元素時，標注 `size` 欄位（small / medium / large / full）
- `small`（10-15%）：一行洞察、來源標註
- `medium`（20-35%）：KPI 列、3 條 bullet、文字段落
- `large`（40-60%）：圖表、6 行表格、多銀行比較
- `full`（70-90%）：獨佔頁面的大型數據表或完整圖表
- 如果一頁的元素加總面積超過 ~85% → 自動拆成兩頁
- 如果一頁面積低於 ~60% → 補充更多分析或放大現有元素

**動態規則**：
- 銀行數量、KPI 項目數、建議條數**全部依 Prompt 決定**
- 使用者說「比較 7 家」就 7 家，說「全部銀行」就 34 家
- 使用者沒指定時，才根據 depth 決定：executive 精簡、detailed 完整
- 資料量大的元素（如 34 家銀行比較表）自動給 `full` 並獨佔一頁

### 5.6 Step Functions 流程設計

```
InitializeJob
  → ParseExcel (Lambda Python)
  → DetectMonthlyFiles (Lambda Python)
  → MergeIfNeeded (Lambda Python)
  → ComputeMetrics (Lambda Python)
  → [Parallel]
      ├─ AI Brief (Bedrock)
      ├─ AI Metrics Discovery (Bedrock)
  → AI Insights (Bedrock)
  → AI Blueprint (Bedrock)
  → AI Compliance Check (Bedrock)
  → WaitForUserApproval (Callback)
  → GenerateSlideSpec (Bedrock)
  → ValidateSlideSpec (Bedrock)
  → RenderPPTX (Lambda Node.js)
  → SaveArtifacts (S3)
  → CompleteJob
```

### 5.6 安全與合規

| 控制項 | 實作方式 |
|--------|---------|
| 資料加密 | S3 SSE-KMS + HTTPS in transit |
| 存取控制 | Cognito + IAM Least Privilege |
| 稽核追蹤 | CloudTrail + CloudWatch Logs |
| 資料隔離 | S3 prefix per tenant/job |
| 短效存取 | Presigned URL（15 分鐘有效） |
| 公開存取阻擋 | S3 Block Public Access |

---

## 六、技術亮點與競賽對應

| 評分項目 | 對應策略 |
|---------|---------|
| **完成度 (15%)** | 端到端七階段流程完整實作，可 Live Demo |
| **技術可行性 (25%)** | Bedrock + Step Functions + 確定性計算引擎，可解釋、可追溯 |
| **商業應用性 (50%)** | 解決「管報製作耗時 2-3 天」的真實痛點，數字正確可追溯、圖表原生可編輯 |
| **主題切合度 (5%)** | 直接針對信用卡市場分析管報流程設計 |
| **創意度 (5%)** | 公式預先確認、AI 驗證迴圈、人工審核 Checkpoint |
| **口述模式 (+5%)** | 可擴充 Amazon Transcribe 語音輸入需求 |
| **Kiro (+5%)** | 全程使用 Kiro IDE 進行規格→設計→實作，保留完整開發證據 |

---

## 七、與現有實作的差異說明

### 目前 MVP 狀態（已完成）

- 前端 React SPA 已完成七階段互動流程
- AI Pipeline 五步驟已實作並可運行
- 確定性計算引擎已完成市占率、排名、MoM 計算
- PPTX 原生可編輯匯出已實作（PptxGenJS）
- 目前使用 OpenCode.ai (DeepSeek V4 Flash) 作為 LLM Provider

### 遷移至 AWS 的規劃

| 現有 | 遷移目標 |
|------|---------|
| Vercel Serverless + OpenCode.ai | AWS Lambda + Amazon Bedrock |
| 瀏覽器端 Excel 解析 | Lambda Python (openpyxl) |
| 瀏覽器端指標計算 | Lambda Python（可追溯性更強） |
| 無流程編排 | AWS Step Functions |
| 無身份認證 | Amazon Cognito |
| Vercel Hosting | AWS Amplify Hosting |

---

## 八、Demo 流程規劃

1. 上傳 12 個月份的信用卡重要資訊揭露 Excel
2. 輸入分析需求（如：「幫我做一份 15 頁的市場競爭分析報告，給副總看」）
3. 系統展示 AI 分析進度（5 步驟即時回饋）
4. 呈現計劃（指標、洞察、假設），使用者確認
5. 系統生成簡報，預覽頁面
6. 展示拖曳排序、圖表互動
7. 下載 PPTX，用 PowerPoint 打開展示原生可編輯圖表
8. 模擬寄送

---

*文件版本：v1.0 | 最後更新：2026-08-01*
