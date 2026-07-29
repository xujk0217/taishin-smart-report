# 需求文件：信用卡統計報表轉可編輯 PowerPoint 簡報

## 簡介

本系統為台新新光金控內部 AI 報表轉簡報系統（智匯數據簡報神器），專為「雲湧智生：臺灣生成式 AI 應用黑客松」競賽開發。使用者上傳多工作表 Excel 信用卡統計資料並輸入分析需求後，系統先解釋資料範圍、公式、假設與無法計算的指標，經使用者確認後再執行分析，最終產生可追溯、可調整、可原生編輯的 PPTX 與對應 XLSX。

核心定位：AI 負責規劃、解讀與敘事；確定性程式負責解析、計算、驗證與輸出。每一個數字都必須可追溯，每一張圖表都必須可編輯。

## 詞彙表

- **System（系統）**：智匯數據簡報神器完整平台，包含前端、API、Step Functions 工作流與所有 Lambda workers
- **Parser（解析器）**：負責讀取、辨識與正規化 Excel 工作表內容的 Python Lambda 元件
- **Metric_Engine（指標引擎）**：負責依照已核准公式計算所有量化指標的確定性運算元件
- **Formula_Plan_Builder（公式計畫建構器）**：根據使用者需求與可用資料欄位自動產生公式計畫的元件
- **Validator（驗證器）**：負責在各階段檢查資料完整性、數值一致性與來源追蹤的元件
- **Insight_Lens（洞察透鏡）**：以 Bedrock Converse 執行的金融角色分析元件，共三個：市場競爭、經營績效、風險稽核
- **Synthesizer（綜整器）**：將已驗證洞察合併為統一敘事的 Bedrock 元件
- **Renderer（渲染器）**：負責輸出 PPTX、XLSX 或 HTML Preview 的寫入專責元件
- **EvidencePacket（證據包）**：包含所有已驗證指標、來源對照與圖表資料的不可變更 JSON 資料結構
- **RoleInsight（角色洞察）**：單一 Insight_Lens 產出的結構化洞察集合
- **Claim（宣稱）**：單一量化或質化陳述，必須附帶 Evidence ID 與來源追蹤
- **ClaimRegistry（宣稱登錄處）**：儲存所有通過驗證 Claim 的集合
- **ConflictGroup（矛盾組）**：方向、數字或排名互相矛盾的 Claim 集合
- **SlideDeckSpec（簡報規格）**：描述每張投影片版面、內容、圖表與來源參照的 JSON 結構
- **Source_Hover（來源懸停）**：HTML 預覽中，滑鼠移至數字或圖表時顯示來源追蹤資訊的互動功能
- **Adjustment（調整）**：使用者以自然語言對預覽進行的版面或敘述修改請求
- **SourceRef（來源參照）**：記錄原始工作表名稱、儲存格範圍與值的追蹤資料結構
- **WorkbookProfile（工作簿概要）**：描述已辨識工作表、欄位、期間、單位與資料品質的結構
- **Job（任務）**：一次完整的報表轉簡報作業，具有唯一 ID 並記錄完整生命周期

## 需求

### 需求 1：Excel 上傳與工作簿解析

**使用者故事：** 身為金控分析人員，我想上傳信用卡統計 Excel 檔案，以便系統辨識工作表結構並開始分析流程。

#### 驗收條件

1. WHEN 使用者上傳 Excel 檔案，THE System SHALL 透過 S3 Presigned URL 直接上傳至 Private S3 Input Bucket，不經過 API Gateway
2. WHEN Excel 檔案上傳完成，THE Parser SHALL 辨識所有工作表名稱、表頭、合併儲存格、資料區域並輸出 WorkbookProfile
3. WHEN Parser 完成辨識，THE System SHALL 向使用者呈現已辨識的工作表清單、期間範圍、可用欄位與資料品質摘要
4. IF Excel 檔案無法讀取或格式不支援，THEN THE System SHALL 回傳明確的錯誤訊息說明不支援的原因
5. IF 必要工作表或欄位缺失，THEN THE System SHALL 列出缺少的項目並阻擋後續流程

### 需求 2：資料正規化與來源追蹤

**使用者故事：** 身為金控分析人員，我想確保每個數據都能追溯到原始儲存格，以便驗證報表正確性。

#### 驗收條件

1. WHEN Parser 完成工作表辨識，THE Parser SHALL 將所有數字、百分比、日期、月份與單位標準化為一致格式
2. THE Parser SHALL 為每個正規化後的數值建立 SourceRef，記錄原始工作表名稱、儲存格地址與原始值
3. WHEN 正規化完成，THE Validator SHALL 檢查期間格式（11401 至 11412）、銀行名稱、百分比與金額單位是否正確標準化
4. IF 期間、單位或數字格式無法判定，THEN THE Validator SHALL 產生 typed finding 並阻擋後續計算

### 需求 3：公式計畫建立與人工確認

**使用者故事：** 身為金控分析人員，我想在系統計算前先確認公式與假設，以避免錯誤的計算結果。

#### 驗收條件

1. WHEN 使用者輸入分析需求且正規化完成，THE Formula_Plan_Builder SHALL 自動對應需求與可用欄位，產生公式計畫包含公式名稱、定義、輸入來源與顯示說明
2. WHEN 可用資料不足以支持某指標計算（如缺少 113 年資料時的年增率），THE Formula_Plan_Builder SHALL 將該指標標記為 unsupported 並說明原因
3. THE System SHALL 向使用者呈現完整公式計畫、假設與不支援項目清單，等待人工確認
4. WHEN 使用者核准公式計畫，THE System SHALL 凍結計畫版本並允許後續計算
5. WHEN 使用者修改公式計畫，THE System SHALL 更新計畫並重新呈現供確認

### 需求 4：確定性指標計算與 EvidencePacket 凍結

**使用者故事：** 身為金控分析人員，我想確保所有數字由程式計算而非 AI 產生，以保證數據正確性。

#### 驗收條件

1. WHEN 公式計畫經使用者核准，THE Metric_Engine SHALL 依照已核准公式計算所有指標，包含市占率、排名、MoM、有效卡率與單卡簽帳金額
2. THE Metric_Engine SHALL 為每個計算結果記錄所使用的 SourceRef IDs、公式定義與計算步驟
3. WHEN 所有指標計算完成且通過驗證，THE System SHALL 建立 EvidencePacket 並計算 canonical SHA-256 hash
4. WHEN EvidencePacket 凍結後，THE System SHALL 禁止任何元件修改該版本的內容
5. IF 計算過程發生除以零、資料缺失或單位不一致，THEN THE Metric_Engine SHALL 標記該指標為 invalid 並記錄原因

### 需求 5：三個洞察透鏡平行分析

**使用者故事：** 身為金控分析人員，我想從市場競爭、經營績效與風險稽核三個角度獲得洞察，以產生全面的管理報告。

#### 驗收條件

1. WHEN EvidencePacket 凍結完成，THE System SHALL 平行啟動市場競爭、經營績效與風險稽核三個 Insight_Lens
2. THE Insight_Lens SHALL 僅讀取同一份凍結的 EvidencePacket，不得存取原始 Excel 或自行計算數字
3. WHEN Insight_Lens 完成分析，THE Insight_Lens SHALL 輸出符合 RoleInsight schema 的結構化結果，每個 Claim 附帶 Evidence IDs
4. IF 單一非關鍵 Insight_Lens 執行失敗，THEN THE System SHALL 以該 Lens 的降級結果繼續流程並通知使用者
5. IF 所有 Insight_Lens 均失敗，THEN THE System SHALL 阻擋後續流程並通知使用者進行人工介入
6. THE 市場競爭 Insight_Lens SHALL 不得引入未收錄於 EvidencePacket 的外部市場資料
7. THE 經營績效 Insight_Lens SHALL 不得自行計算或假設未在 EvidencePacket 中的獲利資料
8. THE 風險稽核 Insight_Lens SHALL 不得以解釋方式放行數字矛盾

### 需求 6：Claim 驗證、去重與矛盾分組

**使用者故事：** 身為金控分析人員，我想確保報告中沒有矛盾的敘述或重複的資訊，以維持報告品質。

#### 驗收條件

1. WHEN 三個 Insight_Lens 完成分析，THE Validator SHALL 驗證每個 Claim 中的數字是否與 EvidencePacket 中對應的 MetricRecord 一致
2. THE Validator SHALL 檢查每個 Claim 的 Evidence IDs 是否存在於 EvidencePacket 中
3. THE Validator SHALL 檢查被標記為 unsupported 的指標是否出現在任何 Claim 敘述中
4. WHEN 發現重複 Claim（相同 claim key），THE Validator SHALL 合併為單一 Claim，重複不得提升可信度
5. WHEN 發現方向、數字或排名互相矛盾的 Claim，THE Validator SHALL 將其歸入 ConflictGroup 並阻擋矛盾內容進入最終敘事
6. IF Claim 中的數字、期間、實體或單位與 MetricRecord 不一致，THEN THE Validator SHALL 拒絕該 Claim 並記錄拒絕原因

### 需求 7：統整敘事合成

**使用者故事：** 身為金控分析人員，我想將多個角度的洞察合成為連貫的管理報告敘事，以便主管閱讀。

#### 驗收條件

1. WHEN ClaimRegistry 建立完成，THE Synthesizer SHALL 僅使用通過驗證的 Claim IDs 組合統整敘事
2. THE Synthesizer SHALL 不得新增任何未在 ClaimRegistry 中的數字、排名或未驗證因果關係
3. THE Synthesizer SHALL 不得使用被 Validator 拒絕的 Claim
4. WHEN 統整完成，THE Validator SHALL 驗證敘事中引用的所有 Claim IDs 均存在於 ClaimRegistry 且狀態為 accepted
5. IF Synthesizer 輸出包含新數字或不存在的 Claim ID，THEN THE Validator SHALL 拒絕該敘事並要求重新生成

### 需求 8：SlideDeckSpec 建構與驗證

**使用者故事：** 身為金控分析人員，我想確保簡報的每一頁內容都有明確的資料來源，以滿足稽核要求。

#### 驗收條件

1. WHEN 統整敘事通過驗證，THE System SHALL 建立 SlideDeckSpec，為每張投影片定義版面、文字、圖表規格與 Claim IDs
2. THE SlideDeckSpec SHALL 確保每個數字、圖表與結論都引用有效的 Claim ID
3. THE SlideDeckSpec SHALL 包含圖表的排名順序、座標軸名稱、單位與期間資訊
4. WHEN SlideDeckSpec 建立完成，THE Validator SHALL 驗證排名順序、座標軸、單位與期間是否與 EvidencePacket 一致
5. IF SlideDeckSpec 中的任何數字或圖表資料與 EvidencePacket 不一致，THEN THE Validator SHALL 拒絕該 SlideDeckSpec

### 需求 9：HTML 預覽與來源懸停

**使用者故事：** 身為金控分析人員，我想在核准前先預覽簡報並查看每個數字的來源，以確認報告正確性。

#### 驗收條件

1. WHEN SlideDeckSpec 通過驗證，THE Renderer SHALL 產生 16:9 比例的 HTML Preview，包含縮圖、文字、圖表與台新品牌樣式
2. THE HTML Preview SHALL 支援 Source_Hover 功能，滑鼠移至任何數字時顯示對應的 Metric 名稱、公式定義、原始工作表、儲存格地址與 Caveat
3. THE System SHALL 提供簡報工作台介面，包含左側縮圖列、中央預覽區與右側洞察及來源證據面板
4. WHEN 使用者點選特定投影片，THE System SHALL 在右側面板顯示該頁使用的 Claims 與 Evidence 詳情

### 需求 10：自然語言調整

**使用者故事：** 身為金控分析人員，我想用自然語言修改簡報的版面或敘述，但不希望數字被意外更改。

#### 驗收條件

1. WHEN 使用者輸入自然語言調整指令，THE System SHALL 解析調整意圖並判斷是否涉及數字修改
2. THE System SHALL 允許修改標題、敘述措辭、投影片順序、文字長度與版面配置
3. IF 調整指令涉及修改數字、排名或移除必要 Caveat，THEN THE System SHALL 拒絕該調整並說明原因
4. WHEN 合法調整完成，THE System SHALL 重新驗證 SlideDeckSpec 並更新 HTML Preview
5. THE System SHALL 在調整後保留所有 Source_Hover 資訊與 Evidence ID 對應關係

### 需求 11：原生可編輯 PPTX 輸出

**使用者故事：** 身為金控分析人員，我想獲得可用 PowerPoint 原生編輯的簡報檔案，以便後續自行微調。

#### 驗收條件

1. WHEN 使用者核准最終預覽，THE Renderer SHALL 使用 PptxGenJS 產生符合台新新光金控官方品牌版型的 PPTX 檔案
2. THE PPTX SHALL 使用 16:9 比例、官方紅白漸層色彩、Logo、指定字體與頁首頁尾
3. THE PPTX 中的所有圖表 SHALL 為 PowerPoint 原生可編輯圖表，使用者可透過「編輯資料」功能修改圖表數據
4. THE PPTX 中的所有表格 SHALL 為 PowerPoint 原生表格物件，不得使用文字框或幾何圖形堆疊
5. IF PPTX 檔案開啟時出現 repair dialog 或圖表無法編輯，THEN THE Validator SHALL 判定該輸出為失敗
6. THE Renderer SHALL 為封面、目錄、章節、圖表、表格與結尾頁分別套用對應的 Slide Master

### 需求 12：XLSX 伴隨工作簿輸出

**使用者故事：** 身為金控分析人員，我想獲得完整的 Excel 稽核工作簿，以便追蹤所有數據來源與驗證結果。

#### 驗收條件

1. WHEN 使用者核准最終預覽，THE Renderer SHALL 使用 XlsxWriter 產生 companion XLSX 檔案
2. THE XLSX SHALL 包含以下工作表：SourceManifest、NormalizedData、Metrics、ChartData、Claims、Citations、ValidationReport
3. THE XLSX 中的圖表 SHALL 為 Excel 原生可編輯圖表
4. WHEN XLSX 中的 Metrics 數值與 PPTX 中的圖表數據不一致，THE Validator SHALL 判定為輸出失敗
5. THE XLSX 的 Citations 工作表 SHALL 提供每個 Claim 到原始儲存格的完整追蹤鏈

### 需求 13：AWS Step Functions 工作流編排

**使用者故事：** 身為系統管理者，我想透過 Step Functions 管理完整工作流，以便監控各階段執行狀態。

#### 驗收條件

1. THE System SHALL 使用 AWS Step Functions Standard 編排完整工作流程，從 InitializeJob 到 CompleteJob
2. THE System SHALL 透過 S3 URI 在各 Step 之間傳遞大型資料，State payload 不得超過 256 KiB
3. WHEN 需要人工確認（公式計畫或預覽核准），THE System SHALL 使用 Callback pattern 暫停工作流等待使用者回應
4. THE System SHALL 為每個 Parallel branch 實作獨立的 Catch handler 並回傳 typed failure
5. WHEN 單一非關鍵 branch 失敗，THE System SHALL 以降級結果繼續後續流程
6. THE System SHALL 使用 CDK 定義所有基礎設施，支援可重複部署

### 需求 14：已知錯誤案例阻擋

**使用者故事：** 身為金控分析人員，我想確保系統不會產生已知的錯誤類型，以維護報告公信力。

#### 驗收條件

1. WHEN 缺少 113 年資料，THE Validator SHALL 阻擋任何包含年增率（YoY）計算的 Claim 進入最終敘事
2. WHEN 圖表的座標軸尺度、單位或期間與 EvidencePacket 資料不一致，THE Validator SHALL 拒絕該圖表規格
3. WHEN 排名敘述與 MetricRecord 中的排名數值不一致，THE Validator SHALL 拒絕該 Claim
4. WHEN 敘述宣稱 A 大於 B 但實際數值顯示 A 小於或等於 B，THE Validator SHALL 標記為數字矛盾並阻擋
5. IF 圖表以圖片格式嵌入而非原生可編輯 chart object，THEN THE Validator SHALL 判定為 artifact 失敗
6. IF 表格以文字框或幾何圖形堆疊而非 PowerPoint 原生表格，THEN THE Validator SHALL 判定為 artifact 失敗

### 需求 15：模擬寄送與稽核紀錄

**使用者故事：** 身為金控分析人員，我想在完成簡報後模擬寄送給主管，並保留完整稽核紀錄。

#### 驗收條件

1. WHEN 使用者確認輸出並選擇模擬寄送，THE System SHALL 記錄收件者、主旨、附件 artifact IDs 與時間戳記
2. THE System SHALL 不寄出真實電子郵件，僅保存模擬紀錄於稽核資料庫
3. THE System SHALL 為整個 Job 保存完整稽核紀錄，包含每個階段的輸入、輸出、驗證結果與使用者操作
4. WHEN Job 完成，THE System SHALL 記錄所使用的 Skill version、model ID、prompt hash、EvidencePacket hash 與輸出 artifact hash

### 需求 16：安全性與存取控制

**使用者故事：** 身為系統管理者，我想確保財務資料的安全存取與適當加密，以符合金融監管要求。

#### 驗收條件

1. THE System SHALL 對所有 S3 Bucket 啟用 Block Public Access、SSE-KMS 加密與 Versioning
2. THE System SHALL 使用短效期 Presigned URL 提供檔案下載，並限制 content type、size 與 object key
3. THE System SHALL 為每個 Lambda worker 實施 IAM least privilege，僅允許存取必要的 S3 prefix 與 DynamoDB 資源
4. THE System SHALL 確保 CloudWatch Logs 不記錄完整財務儲存格內容
5. THE System SHALL 使用 Cognito 或內部 SSO 進行使用者身份驗證
