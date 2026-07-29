# 智匯數據簡報神器：實作 TODO

本清單依照 `PROJECT_PLAN.md` 拆分。優先順序為 P0（阻擋 MVP）、P1（完整 Demo）、P2（加分或正式化）。

## 執行規則

- 每次只實作一個可驗證的垂直切片。
- 功能實作前先加入失敗測試或 fixture。
- LLM 不得直接計算權威數字。
- 任何 quantitative claim 都必須有 Evidence ID。
- 每個 Step Functions Parallel branch 都必須有 `Catch`。
- 任務完成時，更新 checkbox 並附上測試或 Demo 證據。

## Milestone 0：專案初始化與素材基線

- [ ] **P0 M0-01** 建立 monorepo 基本結構
  - 依賴：無
  - 內容：建立 `apps/web`、`services/*`、`packages/contracts`、`packages/skills`、`infra/cdk`。
  - 完成條件：workspace install、lint、typecheck、test 指令可執行。

- [ ] **P0 M0-02** 建立附件 fixture inventory
  - 依賴：M0-01
  - 內容：記錄四份附件的檔案 Hash、工作表、投影片數與用途。
  - 完成條件：測試可以定位並讀取所有 fixture，不修改原始附件。

- [ ] **P0 M0-03** 將附件三錯誤轉成 regression case
  - 依賴：M0-02
  - 內容：建立 unsupported YoY、錯誤座標軸、錯誤排名、數字敘述矛盾與圖片圖表案例。
  - 完成條件：每個已知錯誤都有具名測試資料與 expected finding code。

- [ ] **P0 M0-04** 萃取台新模板 design tokens
  - 依賴：M0-02
  - 內容：整理 16:9、色彩、Logo、字體、頁首頁尾、封面與章節頁規格。
  - 完成條件：輸出可供 PptxGenJS 使用的 template constants。

## Milestone 1：共用資料契約

- [ ] **P0 M1-01** 定義 Job 與狀態機 contract
  - 依賴：M0-01
  - 內容：定義 Job、ArtifactManifest、JobStatus 與 typed failure。
  - 完成條件：JSON Schema、TypeScript type、Python model 驗證相同 fixture。

- [ ] **P0 M1-02** 定義 WorkbookProfile 與 FormulaPlan
  - 依賴：M1-01
  - 完成條件：Schema 可表達工作表、期間、欄位、公式、假設與 unsupported requests。

- [ ] **P0 M1-03** 定義 SourceRef、MetricRecord 與 EvidencePacket
  - 依賴：M1-02
  - 完成條件：每個 Metric 必須引用有效 Source IDs，EvidencePacket 支援 hash 與版本。

- [ ] **P0 M1-04** 定義 RoleInsight、ConflictGroup 與 ClaimRegistry
  - 依賴：M1-03
  - 完成條件：Claim 必須含 claim key、statement、evidence IDs、caveats 與 counterevidence。

- [ ] **P0 M1-05** 定義 SynthesisReport 與 SlideDeckSpec
  - 依賴：M1-04
  - 完成條件：Slide 中的文字、數字與圖表只能引用 accepted claim IDs。

- [ ] **P0 M1-06** 建立跨語言 contract tests
  - 依賴：M1-01 至 M1-05
  - 完成條件：未知欄位、缺少 Evidence ID 與非法狀態都會被 TypeScript/Python 拒絕。

## Milestone 2：Excel 解析與公式引擎

- [ ] **P0 M2-01** 實作 Workbook reader
  - 依賴：M0-02、M1-02
  - 內容：以 Python 解析工作表、儲存格、合併區域、數字與日期。
  - 完成條件：附件四四個工作表可穩定解析。

- [ ] **P0 M2-02** 實作欄位與期間正規化
  - 依賴：M2-01
  - 完成條件：11401 至 11412、銀行名稱、百分比與金額單位正確標準化。

- [ ] **P0 M2-03** 實作 SourceRef mapper
  - 依賴：M2-02、M1-03
  - 完成條件：每個 normalized value 可回查工作表與儲存格地址。

- [ ] **P0 M2-04** 建立 Metric Registry
  - 依賴：M1-03
  - 內容：定義市占率、排名、MoM、有效卡率、單卡簽帳等公式。
  - 完成條件：公式包含 required inputs、單位、期間規則與顯示規則。

- [ ] **P0 M2-05** 實作 FormulaPlan builder
  - 依賴：M2-02、M2-04
  - 完成條件：需求與可用欄位自動對應，缺少 113 年時 YoY 標記 unsupported。

- [ ] **P0 M2-06** 實作 deterministic metric engine
  - 依賴：M2-03 至 M2-05
  - 完成條件：附件四的 P.5/P.7 數值、排序與市占率通過 golden tests。

- [ ] **P0 M2-07** 建立並凍結 EvidencePacket
  - 依賴：M2-06
  - 完成條件：canonical JSON、SHA-256、S3 URI 與版本資訊可重現。

## Milestone 3：確定性驗證層

- [ ] **P0 M3-01** 實作 workbook/schema validator
  - 依賴：M2-01、M1-06
  - 完成條件：缺少工作表、欄位或錯誤資料型別產生 typed findings。

- [ ] **P0 M3-02** 實作 source 與 formula validator
  - 依賴：M2-03、M2-06
  - 完成條件：不存在 Source ID 或公式輸入不完整時阻擋 EvidencePacket。

- [ ] **P0 M3-03** 實作 numeric claim validator
  - 依賴：M1-04、M2-06
  - 完成條件：擷取 statement 中的百分比、金額與排名，與 MetricRecord 比對。

- [ ] **P0 M3-04** 實作 period/entity/unit validator
  - 依賴：M3-03
  - 完成條件：期間、銀行、群組範圍或單位不一致時拒絕 Claim。

- [ ] **P0 M3-05** 實作 unsupported metric validator
  - 依賴：M2-05、M3-03
  - 完成條件：任何缺資料 YoY 敘述在 synthesis 前被阻擋。

- [ ] **P0 M3-06** 實作 chart/ranking validator
  - 依賴：M2-06
  - 完成條件：圖表順序、Top N、軸名稱、單位與期間可自動驗證。

- [ ] **P0 M3-07** 實作 Claim deduplication 與 ConflictGroup
  - 依賴：M1-04、M3-03 至 M3-06
  - 完成條件：重複 Claim 不提高可信度；方向、數字及排名矛盾形成 ConflictGroup。

- [ ] **P0 M3-08** 建立 validation score 與 human-gate 規則
  - 依賴：M3-07
  - 完成條件：blocking、warning、accepted 與 needs-review 狀態可確定性重現。

## Milestone 4：Bedrock 洞察流程

- [ ] **P0 M4-01** 建立 Skill Registry loader
  - 依賴：M1-04
  - 內容：讀取 `system.md`、`output.schema.json`、`rubric.yaml` 與版本。
  - 完成條件：每次執行記錄 Skill version 與 prompt hash。

- [ ] **P0 M4-02** 移植 market-researcher 方法為市場競爭 Lens
  - 依賴：M4-01、M2-07
  - 完成條件：只能引用 EvidencePacket，不允許未收錄外部資料。

- [ ] **P0 M4-03** 移植 earnings-reviewer 方法為經營績效 Lens
  - 依賴：M4-01、M2-07
  - 完成條件：輸出符合 RoleInsight schema，無自行計算數字。

- [ ] **P0 M4-04** 移植 audit-xls 方法為風險稽核 Lens
  - 依賴：M4-01、M2-07、M3-01 至 M3-06
  - 完成條件：能指出缺漏資料、風險、異常與不支援敘述。

- [ ] **P0 M4-05** 實作 Bedrock Converse structured-output client
  - 依賴：M1-06
  - 完成條件：檢查 stop reason、JSON Schema、timeout、throttle 與一次 repair。

- [ ] **P0 M4-06** 平行執行三 Lens 並處理 partial failure
  - 依賴：M4-02 至 M4-05
  - 完成條件：非關鍵 Lens 失敗可產生透明降級結果，必要 Lens 失敗進 human review。

- [ ] **P0 M4-07** 實作 accepted ClaimRegistry
  - 依賴：M3-07、M4-06
  - 完成條件：只保存通過 validator 的 Claims 並保留 rejected reasons。

- [ ] **P0 M4-08** 實作受限 Synthesizer
  - 依賴：M4-07
  - 完成條件：新 Claim ID、新數字或 rejected Claim 會被 synthesis validator 拒絕。

- [ ] **P1 M4-09** 實作 Critic 與一次 bounded refine
  - 依賴：M4-08
  - 完成條件：只檢查過度推論、Caveat、覆蓋率與主管可讀性，最多修正一次。

## Milestone 5：預覽與 Office 輸出

- [ ] **P0 M5-01** 建立 SlideDeckSpec builder
  - 依賴：M1-05、M4-08
  - 完成條件：每張投影片包含 layout、claim IDs、chart specs 與 source hover 資訊。

- [ ] **P0 M5-02** 實作台新 HTML Preview
  - 依賴：M0-04、M5-01
  - 完成條件：16:9 預覽可顯示縮圖、文字、圖表占位與品牌樣式。

- [ ] **P0 M5-03** 實作 Source Hover manifest
  - 依賴：M2-03、M5-02
  - 完成條件：每個數字可顯示 Metric、公式、工作表、儲存格與 Caveat。

- [ ] **P0 M5-04** 實作 PptxGenJS master 與基礎版型
  - 依賴：M0-04、M5-01
  - 完成條件：封面、目錄、章節、圖表、表格與結尾頁符合官方品牌。

- [ ] **P0 M5-05** 實作原生 PPT charts/tables
  - 依賴：M5-04、M3-06
  - 完成條件：圖表可使用 PowerPoint「編輯資料」，表格不是文字框堆疊。

- [ ] **P0 M5-06** 實作 XlsxWriter companion workbook
  - 依賴：M2-07、M4-07
  - 完成條件：包含 SourceManifest、Metrics、ChartData、Claims、Citations、ValidationReport。

- [ ] **P0 M5-07** 建立 Artifact validator
  - 依賴：M5-05、M5-06
  - 完成條件：檔案可開啟、無 repair dialog、含 native chart/table objects。

- [ ] **P1 M5-08** 實作受限自然語言 Adjustment
  - 依賴：M5-01、M4-05
  - 完成條件：可改標題、順序、長度與 layout；不可改數字、排名或移除必要 Caveat。

## Milestone 6：AWS 基礎設施與 Orchestration

- [ ] **P0 M6-01** 建立 CDK DataStack
  - 依賴：M0-01
  - 完成條件：private S3、KMS、DynamoDB、versioning、lifecycle 與 least-privilege grants。

- [ ] **P0 M6-02** 建立 CDK ApiStack
  - 依賴：M6-01、M1-01
  - 完成條件：HTTP API 可建立 Job、回傳 Presigned URL、查詢狀態與提交審核。

- [ ] **P0 M6-03** 建立 Parser/Validation Lambda container
  - 依賴：M2、M3、M6-01
  - 完成條件：ECR image 可在 Lambda 解析 fixture 並輸出 S3 URI。

- [ ] **P0 M6-04** 建立 Bedrock 與 Renderer Lambdas
  - 依賴：M4、M5、M6-01
  - 完成條件：IAM 只允許必要 model、bucket prefix 與 DynamoDB actions。

- [ ] **P0 M6-05** 建立 Step Functions Standard state machine
  - 依賴：M6-02 至 M6-04
  - 完成條件：狀態機以 S3 URI 傳遞資料，包含 Formula/Draft callback waits。

- [ ] **P0 M6-06** 實作 Parallel branches、Catch 與 retries
  - 依賴：M6-05
  - 完成條件：三 Lens 與三 Renderer branches 都能獨立回報 typed failure。

- [ ] **P0 M6-07** 串接 S3 upload event 與 Job lifecycle
  - 依賴：M6-02、M6-05
  - 完成條件：Presigned upload 後可啟動指定 Job，且流程具 idempotency。

- [ ] **P1 M6-08** 建立 CloudWatch dashboard 與 alarms
  - 依賴：M6-05
  - 完成條件：顯示 stage latency、validation failures、Bedrock failures 與 render failures。

## Milestone 7：前端與使用者流程

- [ ] **P0 M7-01** 建立 Amplify React application shell
  - 依賴：M0-01、M6-02
  - 完成條件：可連線 demo API，並具有台新品牌基本視覺。

- [ ] **P0 M7-02** 實作 Job 建立與 S3 直傳
  - 依賴：M7-01、M6-02
  - 完成條件：大型 Excel 不經 API Gateway 即可上傳。

- [ ] **P0 M7-03** 實作 Job status 與處理進度
  - 依賴：M7-01、M6-05
  - 完成條件：前端顯示目前 Stage、warnings、failures 與 partial status。

- [ ] **P0 M7-04** 實作 FormulaPlan 審核畫面
  - 依賴：M2-05、M6-02
  - 完成條件：顯示公式、來源、假設與 unsupported 指標並可 approve/reject。

- [ ] **P0 M7-05** 實作簡報工作台與 Source Hover
  - 依賴：M5-02、M5-03
  - 完成條件：縮圖、中央預覽、洞察與來源面板可互動。

- [ ] **P1 M7-06** 實作 Adjustment 與重新預覽
  - 依賴：M5-08、M7-05
  - 完成條件：非法數字修改會被阻擋並顯示原因。

- [ ] **P0 M7-07** 實作 final approval 與 artifact download
  - 依賴：M5-07、M6-02
  - 完成條件：產生短效期 Presigned URL 並顯示 XLSX/PPTX live-link 限制。

- [ ] **P1 M7-08** 實作模擬寄信 Outbox
  - 依賴：M7-07
  - 完成條件：保存 recipient、subject、artifact IDs 與 audit event，不寄出真實 Email。

## Milestone 8：品質、Demo 與加分項

- [ ] **P0 M8-01** 建立完整 happy-path E2E test
  - 依賴：M2 至 M7
  - 完成條件：fixture 從上傳走到 PPTX/XLSX 下載。

- [ ] **P0 M8-02** 建立四個主要 failure-path E2E tests
  - 依賴：M8-01
  - 完成條件：unsupported YoY、錯誤排名、數字矛盾、Lens partial failure 均符合預期。

- [ ] **P0 M8-03** 完成 PPTX/XLSX manual QA
  - 依賴：M5-07
  - 完成條件：PowerPoint/Excel 實際開啟、編輯圖表、儲存後可再次開啟。

- [ ] **P0 M8-04** 量測端到端延遲與 Bedrock 成本
  - 依賴：M8-01、M6-08
  - 完成條件：記錄每 Stage p50/p95、token 與單次 Job 成本。

- [ ] **P0 M8-05** 執行 IAM、S3、Log security review
  - 依賴：M6
  - 完成條件：無 public bucket、無非必要 wildcard、Logs 無原始敏感儲存格內容。

- [ ] **P0 M8-06** 撰寫並排練 Live Demo script
  - 依賴：M8-01 至 M8-05
  - 完成條件：在競賽時間內展示公式確認、錯誤阻擋、來源 Hover、Adjustment 與可編輯輸出。

- [ ] **P1 M8-07** 建立競賽提案簡報
  - 依賴：M8-06
  - 完成條件：涵蓋解題方向、AI、數據、使用者流程與 AWS 架構圖。

- [ ] **P2 M8-08** 加入 Amazon Transcribe 口述模式
  - 依賴：M7-02、M7-06
  - 完成條件：語音可轉成新 Job prompt 或 AdjustmentRequest。

- [ ] **P2 M8-09** 使用 Kiro 建立 spec/task evidence
  - 依賴：M0-01
  - 完成條件：保存需求、設計、任務與實作過程，供加分展示。

## MVP Critical Path

```text
M0-01
 -> M0-02/M0-03/M0-04
 -> M1 contracts
 -> M2 parser and metrics
 -> M3 validators
 -> M4 Bedrock lenses and synthesis
 -> M5 preview and artifacts
 -> M6 AWS workflow
 -> M7 frontend
 -> M8 E2E and demo
```

## MVP 完成條件

- [ ] 能上傳附件四或同結構 Excel。
- [ ] 能解釋並確認公式。
- [ ] 缺 113 年資料時能阻擋 YoY。
- [ ] 三個 Lens 僅引用同一份 frozen EvidencePacket。
- [ ] 每個 quantitative claim 可追溯至工作表與儲存格。
- [ ] 能預覽 16 頁簡報並顯示 Source Hover。
- [ ] 能以自然語言修改版面或敘述但不能更改數字。
- [ ] PPTX 圖表與表格可原生編輯。
- [ ] XLSX 含原生圖表、來源、公式與驗證報告。
- [ ] Step Functions 可顯示完整 execution history。
- [ ] 能完成模擬寄送與 audit record。
- [ ] Live Demo 全流程可在競賽限制時間內完成。
