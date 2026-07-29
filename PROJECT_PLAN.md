# 智匯數據簡報神器：專案架構與實作計畫

## 1. 專案摘要

本專案為台新新光金控內部的 AI 報表轉簡報系統。使用者上傳多工作表 Excel 並輸入分析需求後，系統先解釋資料範圍、公式、假設與無法計算的指標，經使用者確認後再執行分析，產生可追溯、可調整、可編輯的 PPTX 與對應 XLSX。

核心定位：

> AI 負責規劃、解讀與敘事；確定性程式負責解析、計算、驗證與輸出。每一個數字都必須可追溯，每一張圖表都必須可編輯。

競賽評分重點：

| 項目 | 比重 | 專案對應策略 |
| --- | ---: | --- |
| 完成度 | 15% | 完成上傳、確認、生成、修改、輸出與模擬寄送的端到端流程 |
| 技術可行性 | 25% | 以 Step Functions、Lambda、Bedrock Structured Outputs 與確定性驗證建立可解釋流程 |
| 商業應用性 | 50% | 強調數字正確、來源追蹤、原生圖表、處理速度與人工審核 |
| 主題切合度 | 5% | 對管報流程、欄位對應、公式與主管簡報痛點提供明確解法 |
| 創意度 | 5% | 公式預先確認、來源 Hover、矛盾阻擋與自然語言調整 |
| 口述模式 | +5% | MVP 穩定後以 Amazon Transcribe 擴充 |
| Kiro | +5% | 使用 Kiro 規格與任務流程留下實作證據 |

## 2. 來源資料與已知問題

專案素材：

- `台新 企劃流程.pdf`：定義七階段使用者流程。
- 命題文件 PDF：定義競賽需求、評分與交付項目。
- `附件一_台新新光金控簡報版型.pptx`：官方紅白漸層與品牌版型。
- `附件二_系統提示詞.docx`：16 頁信用卡市場分析需求。
- `附件三_信用卡範例簡報及錯誤說明.pptx`：錯誤案例與輸出參照。
- `附件四_預期修正參照資料.xlsx`：正確圖表與數據參照。

必須建立 regression tests 的已知錯誤：

- 缺少 113 年資料時仍產生 YoY。
- 座標軸尺度、單位或期間錯誤。
- 排名與原始數值不一致。
- 敘述與數字矛盾，例如誤稱 `10.7%` 高於 `11.0%`。
- 圖表以圖片嵌入，無法編輯資料。
- 表格以文字框或幾何圖形堆疊，而非真正的表格。

## 3. 設計原則

1. **Evidence first**：任何 LLM 洞察前，先建立已驗證且不可變更的 `EvidencePacket`。
2. **Deterministic arithmetic**：所有公式、排名、比率與圖表資料由程式計算。
3. **Bounded parallelism**：只平行執行明確、固定、可驗證的工作分支。
4. **Read-only AI lenses**：金融角色只能解讀證據，不得讀取原始 Excel 或自行計算。
5. **One write-holder**：只有 Renderer 可以寫入 PPTX、XLSX 與 Preview artifacts。
6. **Validation at every boundary**：分支內、合併後與輸出前都要驗證，不等待全部完成才檢查。
7. **Human in the loop**：公式計畫、重大矛盾與最終預覽必須可人工確認。
8. **No majority truth**：多個 Agent 的共識不能取代數字或來源驗證。

## 4. 使用者流程

1. 使用者建立 Job，上傳 Excel 並輸入需求。
2. 系統辨識工作表、欄位、月份、單位與資料品質。
3. 系統產生公式計畫、簡報大綱、假設及不支援項目。
4. 使用者確認或修改公式計畫。
5. 系統平行計算各指標群，建立並凍結 `EvidencePacket`。
6. 三個金融洞察 Lens 平行產生候選洞察。
7. 系統驗證、去重、分組矛盾，再產生統整敘事。
8. 系統建立 `SlideDeckSpec` 與 HTML Preview。
9. 使用者查看來源 Hover 並以自然語言調整。
10. 系統驗證調整內容，重新產生預覽。
11. 使用者核准後輸出 PPTX、XLSX 與驗證報告。
12. 系統模擬寄送並保存稽核紀錄。

## 5. AWS 整體架構

```text
React / Amplify Hosting
        |
        v
API Gateway HTTP API + Cognito
        |
        v
Lambda API Handlers ----- DynamoDB Jobs / Callback Tokens
        |
        | Presigned URL
        v
Private S3 Input Bucket
        |
        | ObjectCreated / EventBridge
        v
Step Functions Standard
        |
        +-- Python Lambda Container: parsing, metrics, validation
        +-- Bedrock Converse: lenses, synthesis, critic, adjustments
        +-- Node Lambda: PptxGenJS renderer
        +-- Python Lambda: XlsxWriter renderer
        +-- HTML preview renderer
        |
        v
Private S3 Evidence / Artifact Buckets
        |
        v
Short-lived Presigned Download URLs
```

API Gateway 只負責建立工作、查詢狀態、送出審核與取得下載 URL。上傳檔案不經過 API，避免 HTTP API 的 payload 與 timeout 限制。API 回傳 `202 Accepted + jobId`，前端輪詢 Job 狀態。

Step Functions state 僅傳遞 Job ID、S3 URI 與 Hash。大型 JSON 存入 S3，避免超過 256 KiB state payload。

## 6. Step Functions DAG

```text
InitializeJob
 -> ParseSheetsMap
 -> NormalizeWorkbook
 -> ValidateWorkbook
 -> BuildFormulaPlan
 -> WaitForFormulaApproval
 -> ComputeMetricFamiliesParallel
 -> ValidateAndFreezeEvidence
 -> InsightLensesParallel
 -> ValidateClaims
 -> DeduplicateAndGroupConflicts
 -> SynthesizeApprovedClaims
 -> ValidateSynthesis
 -> CriticReview
 -> BoundedRefineIfNeeded
 -> BuildSlideDeckSpec
 -> ValidateSlideDeckSpec
 -> RenderDraftParallel
 -> WaitForPreviewApproval
 -> InterpretAndValidateAdjustment
 -> RenderFinalParallel
 -> ValidateArtifacts
 -> SimulateEmail
 -> CompleteJob
```

### 6.1 平行邊界

適合平行：

- 不同工作表解析：Inline `Map`。
- 不同指標群計算：固定 `Parallel`。
- 三個洞察 Lens：固定 `Parallel`。
- PPTX、XLSX、HTML Preview：固定 `Parallel`。

不適合平行：

- 多個模型獨立計算相同指標。
- 多個 Agent 直接解析原始 Excel。
- 讓 Agent 自由對話或遞迴委派。
- 以多數決決定數值、排名或因果關係。

每個 Parallel branch 必須自行 `Catch` 並回傳 typed failure，否則任一未捕捉錯誤會讓整個 Parallel state 失敗。

## 7. 資料與 AI 架構

### 7.1 確定性處理層

Python worker 負責：

- Excel 工作表、表頭、合併儲存格與資料區域辨識。
- 數字、百分比、日期、月份與單位標準化。
- Source ID 與儲存格範圍建立。
- MoM、市占率、排名、有效卡率與其他已核准公式計算。
- 缺少期間、除以零、單位不一致與異常值檢查。
- 圖表資料、排序與座標軸規格建立。

### 7.2 EvidencePacket

```json
{
  "packetId": "evp-job-001-v1",
  "jobId": "job-001",
  "workbook": {
    "s3Uri": "s3://input/job-001/source.xlsx",
    "sha256": "..."
  },
  "formulaPlanId": "formula-plan-v1",
  "sourceRefs": [],
  "metrics": [],
  "chartDataSpecs": [],
  "validationFindings": [],
  "unsupportedRequests": [],
  "frozen": true,
  "canonicalSha256": "..."
}
```

`EvidencePacket` 凍結後，所有洞察 Lens 必須讀取相同版本。任何資料修正都要產生新版本，不能覆寫原版本。

### 7.3 三個洞察 Lens

| Lens | 工作 | 禁止事項 |
| --- | --- | --- |
| 市場競爭 | 市占、排名、規模、同業位置與趨勢解讀 | 不得引入未收錄的外部市場資料 |
| 經營績效 | 活躍度、單卡消費、分期、循環餘額與經營意涵 | 不得自行計算或假設獲利資料 |
| 風險稽核 | 缺漏期間、異常值、風險指標、錯誤敘事與揭露事項 | 不得以解釋方式放行數字矛盾 |

外部資料只有在經過來源確認並加入 `EvidencePacket` 後，才能提供給市場競爭 Lens。

### 7.4 RoleInsight contract

```json
{
  "role": "market_competition",
  "packetId": "evp-job-001-v1",
  "claims": [
    {
      "claimId": "claim-001",
      "claimKey": "taishin|transaction_share|11412",
      "statement": "台新簽帳金額市占率為 10.61%。",
      "evidenceIds": ["metric-share-001"],
      "businessImplication": "消費貢獻略低於流通卡市占。",
      "caveats": [],
      "counterEvidence": []
    }
  ]
}
```

模型輸出的 confidence 不視為事實。系統品質分數應由 Evidence coverage、數值一致性、期間、實體、單位與矛盾狀態計算。

### 7.5 Synthesizer 與 Critic

Synthesizer 只能使用通過驗證的 `claimId`，不得新增數字、排名或未驗證原因。

Critic 僅檢查：

- 是否有因果過度推論。
- 是否遺漏必要 Caveat。
- 是否符合主管閱讀方式。
- 是否覆蓋重要已驗證洞察。

Critic 不負責數字正確性，也不能覆蓋確定性 Validator。Refine loop 最多執行一次，避免無限迴圈、成本與延遲失控。

## 8. Anthropic Financial Services Skills

參考來源：[anthropics/financial-services](https://github.com/anthropics/financial-services)，Apache-2.0。

可重用的部分：

- [market-researcher](https://github.com/anthropics/financial-services/tree/main/plugins/agent-plugins/market-researcher)：研究範圍與競爭分析流程。
- [earnings-reviewer](https://github.com/anthropics/financial-services/tree/main/plugins/agent-plugins/earnings-reviewer)：財務數據到管理敘事的方法。
- `audit-xls`：轉化為程式化 Excel 與數字檢核規則。
- `pptx-author`：抽取簡報版面與輸出 QC 規則。
- `xlsx-author`：抽取 Excel 輸出與稽核結構。
- Managed Agent cookbooks：採用 read-only workers、one write-holder、schema JSON 與 one-level delegation。

不直接搬用 Claude/Cowork runtime、MCP manifest 或遞迴 Agent 設定。建議建立專案自己的 Skill Registry：

```text
packages/skills/
  market-competition/v1/
    system.md
    output.schema.json
    rubric.yaml
  business-performance/v1/
  audit-risk/v1/
  synthesis/v1/
```

每個 Job 紀錄 Skill version、model ID、prompt hash、EvidencePacket hash 與輸出 hash。

## 9. Bedrock 設計

- 使用 Bedrock Converse 作為統一模型 API。
- 使用 Structured Outputs 產生 schema-constrained JSON。
- Schema 設定 `additionalProperties: false`，並使用明確 enum。
- 檢查 `stopReason`，保存原始回應與驗證後 JSON。
- Structured Outputs 不依賴 Anthropic 原生 citations；專案使用自己的 `evidenceIds`。
- Guardrails 用於內容政策與敏感資訊，不用於數值事實驗證。
- MVP 使用單一生成模型路徑；若使用不同 Judge 模型，必須量測額外成本與延遲。

## 10. 驗證 Gates

### Gate 1：Workbook

- 檔案可讀取且格式支援。
- 必要工作表與欄位存在。
- 期間、單位與數字格式可判定。

### Gate 2：Formula Plan

- 所有公式有名稱、定義、輸入與顯示說明。
- 缺少 113 年資料時，YoY 標記為 unsupported。
- 使用者確認後才允許計算。

### Gate 3：Evidence

- 每個 Metric 都有有效 Source ID。
- 數值、期間、實體、單位與公式一致。
- ChartData 與 Metric records 一致。

### Gate 4：Claims

- 所有數字都能解析並對應到 Metric。
- `evidenceIds` 全部存在。
- unsupported 指標不能出現在敘述。
- 重複 Claim 合併，矛盾 Claim 進入 ConflictGroup。

### Gate 5：SlideDeckSpec

- 每個數字、圖表與結論有 Claim ID。
- 排名、座標軸、單位與期間正確。
- 調整不能修改數字或移除必要 Caveat。

### Gate 6：Artifacts

- PPTX 可開啟且不出現 repair dialog。
- 分析圖表為原生可編輯 chart，不是圖片。
- 表格為真正的 PowerPoint table。
- XLSX 含原生圖表、資料與稽核工作表。

## 11. 預覽與輸出

`SlideDeckSpec` 是 HTML Preview、PPTX 與 XLSX 的共同輸入來源。

```text
SlideDeckSpec
  +-- HTML Preview + source hover manifest
  +-- PptxGenJS native PPTX
  +-- XlsxWriter native XLSX charts and audit sheets
```

PPTX 使用 PptxGenJS `defineSlideMaster` 重建官方版型。XLSX 至少包含：

- `SourceManifest`
- `NormalizedData`
- `Metrics`
- `ChartData`
- `Claims`
- `Citations`
- `ValidationReport`

PPTX 的原生圖表資料內嵌於 PowerPoint，使用者可透過「編輯資料」修改。獨立下載的 XLSX 不保證與 PPTX 即時雙向連動；修改 companion XLSX 後應重新上傳並再生成 PPTX。

## 12. 前端與 API

主要頁面：

1. 建立任務：上傳 Excel、輸入需求、選擇模板。
2. 公式計畫：檢查資料範圍、公式、假設與阻擋項目。
3. 簡報工作台：縮圖、中央預覽、右側洞察與來源證據。
4. 輸出中心：下載 artifacts、查看驗證報告、模擬寄送。

主要 API：

```text
POST /jobs
POST /jobs/{jobId}/start
GET  /jobs/{jobId}
GET  /jobs/{jobId}/formula-plan
POST /jobs/{jobId}/formula-approval
GET  /jobs/{jobId}/preview
POST /jobs/{jobId}/adjustments
POST /jobs/{jobId}/draft-approval
GET  /jobs/{jobId}/artifacts/{type}
POST /jobs/{jobId}/simulate-email
```

## 13. 儲存、資安與可觀測性

S3 prefix 建議：

```text
input/{tenantId}/{jobId}/
evidence/{tenantId}/{jobId}/{version}/
preview/{tenantId}/{jobId}/{version}/
artifacts/{tenantId}/{jobId}/{version}/
audit/{tenantId}/{jobId}/
```

安全控制：

- S3 Block Public Access、SSE-KMS、Versioning 與 lifecycle cleanup。
- Presigned URL 短效期並限制 content type、size 與 object key。
- IAM least privilege；每個 worker 僅能存取必要 prefix。
- CloudWatch 不記錄完整財務儲存格內容。
- Cognito 或內部 SSO 區分分析者與審核者。
- Production 再加入 WAF、malware scanning、CloudTrail data events 與 DLP。

CloudWatch metrics：

- 各 Stage latency。
- Workbook validation failure count。
- Unsupported YoY blocked count。
- Bedrock schema repair/failure count。
- Claim rejection/conflict count。
- PPTX/XLSX render latency 與 artifact validation failure。

## 14. CDK Stacks

| Stack | 資源 |
| --- | --- |
| DataStack | S3、KMS、DynamoDB、lifecycle |
| ApiStack | HTTP API、API Lambdas、CORS、Authorizer |
| WorkflowStack | Step Functions、workers、EventBridge、IAM |
| FrontendStack | Amplify Hosting、環境變數 |
| ObservabilityStack | Log groups、dashboard、alarms |

MVP 可合併部分 Stack，但仍保留清楚的 construct 邊界。

## 15. 建議 Repository Layout

```text
apps/
  web/
services/
  api/
  parser-metrics/
  validation/
  bedrock/
  render-pptx/
  render-xlsx/
  render-html-preview/
packages/
  contracts/
  skills/
  test-fixtures/
infra/
  cdk/
docs/
  architecture.md
  state-machine.md
  demo-script.md
```

TypeScript 負責前端、API、PPTX Renderer 與 CDK；Python 負責 Excel 解析、資料計算、驗證與 XLSX Renderer。跨語言 contract 以 JSON Schema 為單一真實來源，TypeScript 使用 Zod/Ajv，Python 使用 Pydantic/jsonschema 驗證。

## 16. 實作階段

### Phase 0：Fixtures 與 Contracts

- 將附件三錯誤案例轉成驗證測試。
- 建立四份素材的固定 fixture 與 expected outputs。
- 定義 EvidencePacket、RoleInsight、ClaimRegistry、SlideDeckSpec。

### Phase 1：確定性資料管線

- 完成 Excel parsing、source mapping、normalization 與 formula plan。
- 實作 metric registry 與已核准公式。
- 產生並凍結 EvidencePacket。

### Phase 2：Validation

- 實作 source、numeric、period、unit、ranking 與 chart validators。
- 實作 Claim deduplication 與 ConflictGroup。

### Phase 3：Bedrock 洞察

- 實作 Skill Registry 與三個 Lens。
- Structured Outputs 驗證失敗只允許一次 repair。
- 實作受限 Synthesizer、Critic 與一次 refine。

### Phase 4：Artifacts

- 由 SlideDeckSpec 產生 HTML Preview。
- 以 PptxGenJS 產生原生 PPTX。
- 以 XlsxWriter 產生 companion XLSX 與原生圖表。

### Phase 5：AWS Orchestration

- 建立 S3、DynamoDB、HTTP API 與 Step Functions Standard。
- 串接 Callback approval、branch Catch、retry 與 Job status。

### Phase 6：Frontend

- 完成上傳、公式確認、處理進度、來源 Hover、調整與下載。

### Phase 7：Demo Hardening

- E2E、artifact manual QA、效能、資安與 demo rehearsal。
- 加入 Amazon Transcribe 與 Kiro 加分項。

## 17. MVP Cut

必須完成：

- Excel-only 輸入。
- 單一台新 PPT 模板。
- 公式確認與 EvidencePacket。
- 三個固定洞察 Lens。
- Claim 驗證、去重與矛盾分組。
- HTML Preview 與來源 Hover。
- 自然語言調整但禁止更改數字。
- 原生可編輯 PPTX 與 XLSX。
- Step Functions、CloudWatch、CDK 與部署網址。
- 模擬寄信。

延後：

- PDF/Word 通用解析。
- Bedrock Knowledge Bases。
- 即時外部市場資料檢索。
- 真實寄信與企業 SSO。
- 任意 PPT 模板設計器。
- 外部 XLSX 與 PPTX 即時雙向連動。

## 18. Demo 驗收流程

1. 上傳附件四或正式信用卡統計 Excel。
2. 顯示辨識出的工作表、期間與指標。
3. 顯示公式計畫並阻擋缺資料的 YoY。
4. 使用者核准後，在 Step Functions 顯示平行計算與三 Lens。
5. 預覽顯示已驗證洞察、Caveat 與來源 Hover。
6. 輸入「移除 YoY 敘述，將策略建議改得更行動導向」。
7. 系統只修改允許內容並重新驗證。
8. 匯出 PPTX 與 XLSX。
9. 在 PowerPoint 右鍵編輯圖表資料，展示原生可編輯性。
10. 在 XLSX 顯示 ChartData、Citations 與 ValidationReport。
11. 模擬寄送並顯示 audit event。

## 19. 主要風險與對策

| 風險 | 對策 |
| --- | --- |
| LLM 捏造數字 | 模型只能讀 EvidencePacket，Claim 數字由程式逐一比對 |
| 多角色產生相同幻覺 | Evidence IDs、確定性驗證與 conflict grouping，不採多數決 |
| 分支失敗拖垮流程 | 每個 Parallel branch 自行 Catch 並回傳 typed failure |
| 成本與延遲過高 | 固定三 Lens、共享 EvidencePacket、一次 repair、一次 refine |
| PPT 圖表不可編輯 | 固定 PptxGenJS 版本並以 artifact tests 驗證 chart objects |
| XLSX/PPTX 連動誤解 | UI 明示 companion XLSX 採重新上傳再生成 |
| Prompt 版本漂移 | Skill Registry、prompt hash 與 schema version 進入 audit log |
| 複雜 Excel 解析錯誤 | 以附件資料與錯誤簡報建立 golden regression tests |

## 20. 完成定義

- 已知錯誤案例均有自動化測試並正確阻擋。
- 任一 quantitative claim 都能追溯到 Metric 與儲存格。
- Workflow 能在單一非關鍵 Lens 失敗時產生透明的降級預覽。
- PPTX 可開啟、無 repair dialog、原生圖表可編輯。
- XLSX 含原生圖表及完整稽核工作表。
- HTML Preview 的來源 Hover 可解析到正確 Evidence ID。
- CDK 可重複部署 demo 環境。
- Live Demo 能完整走完上傳、確認、生成、調整、輸出與模擬寄送。
