# 實作計畫：信用卡統計報表轉可編輯 PowerPoint 簡報

## 概覽

本計畫將「智匯數據簡報神器」從設計文件轉為可執行的開發任務。採用 Milestone 分層策略，優先建立端到端可運行的 MVP，再逐步完善精度與 Demo 效果。

技術棧：
- **TypeScript**：前端（React）、API Lambda、PptxGenJS Renderer、HTML Preview Renderer、CDK
- **Python**：Excel Parser、Metric Engine、Validation、Bedrock Lenses、XlsxWriter Renderer
- **跨語言契約**：JSON Schema 為 canonical，TypeScript 用 Zod + Ajv，Python 用 Pydantic

## 任務

- [ ] 1. 專案初始化與測試素材基線（M0）

  - [ ] 1.1 建立 monorepo 基本結構與開發工具鏈
    - 建立目錄：`apps/web`、`services/api`、`services/parser-metrics`、`services/validation`、`services/bedrock`、`services/render-pptx`、`services/render-xlsx`、`services/render-html-preview`、`packages/contracts`、`packages/skills`、`packages/test-fixtures`、`infra/cdk`
    - 設定 pnpm workspace（TypeScript 部分）與 Python virtualenv / poetry（Python 部分）
    - 建立根層 `lint`、`typecheck`、`test` 指令
    - _需求：1.1（系統架構基礎）_

  - [ ] 1.2 建立附件 fixture inventory 與測試資料
    - 將四份附件（版型 PPTX、系統提示詞、錯誤簡報、修正參照 XLSX）放入 `packages/test-fixtures/`
    - 記錄每份檔案的 SHA-256 hash、工作表清單、投影片數量與用途
    - 建立 fixture loader 工具函式（Python + TypeScript）
    - _需求：1.1, 2.2_

  - [ ] 1.3 將附件三已知錯誤轉為 regression test cases
    - 建立 REG-001：缺少 113 年資料時產生 YoY
    - 建立 REG-002：座標軸尺度/單位/期間錯誤
    - 建立 REG-003：排名與原始數值不一致
    - 建立 REG-004：敘述與數字矛盾（如 10.7% > 11.0%）
    - 建立 REG-005：圖表以圖片嵌入
    - 建立 REG-006：表格以文字框堆疊
    - 每個案例含測試資料 JSON 與 expected finding code
    - _需求：14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [ ] 1.4 萃取台新官方模板 design tokens
    - 從附件一 PPTX 萃取：16:9 比例、紅白漸層色碼、Logo 圖檔、字體名稱與大小、頁首頁尾格式
    - 輸出為 TypeScript constants（供 PptxGenJS 使用）
    - 定義封面、目錄、章節、圖表、表格、結尾頁的 Slide Master 規格
    - _需求：11.2, 11.6_

- [ ] 2. 共用資料契約定義（M1）

  - [ ] 2.1 定義 Job、JobStatus 與 ArtifactManifest contract
    - 在 `packages/contracts/` 建立 JSON Schema 定義 Job 結構、狀態列舉、typed failure
    - 使用 code generation 產生 TypeScript types（Zod）與 Python models（Pydantic）
    - 設定 `additionalProperties: false` 與明確 enum
    - _需求：13.1, 15.3_

  - [ ] 2.2 定義 WorkbookProfile 與 FormulaPlan contract
    - JSON Schema 表達工作表結構、期間、欄位、公式計畫、假設與 unsupported requests
    - 含 TypeScript 與 Python 對應 model
    - _需求：1.2, 3.1, 3.2_

  - [ ] 2.3 定義 SourceRef、MetricRecord 與 EvidencePacket contract
    - SourceRef：工作表名、儲存格地址、原始值、正規化值、資料型別、期間、實體
    - MetricRecord：公式 ID、定義、輸入 SourceRef IDs、計算值、單位、排名
    - EvidencePacket：凍結標誌、canonical SHA-256、版本、unsupported 清單
    - _需求：2.2, 4.1, 4.2, 4.3_

  - [ ] 2.4 定義 RoleInsight、Claim、ConflictGroup 與 ClaimRegistry contract
    - Claim：claim key、statement、evidence IDs、caveats、counterEvidence、direction、magnitude
    - ConflictGroup：衝突類型、涉及 Claims、解決狀態
    - ClaimRegistry：所有 accepted/rejected/conflict Claims 與 rejection reasons
    - _需求：5.3, 6.1, 6.4, 6.5_

  - [ ] 2.5 定義 SlideDeckSpec 與 ChartDataSpec contract
    - SlideDeckSpec：每張投影片 layout、masterId、content、claimIds、chart specs
    - ChartDataSpec：圖表類型、軸定義、資料系列、排名順序
    - Source Hover targets 映射
    - _需求：8.1, 8.2, 8.3_

  - [ ]* 2.6 建立跨語言 contract 驗證測試
    - 驗證相同 fixture JSON 在 TypeScript（Ajv）與 Python（jsonschema）皆通過/拒絕
    - 測試 unknown fields 被拒絕、缺少必要欄位被拒絕、非法 enum 被拒絕
    - _需求：所有 contract 相關_

- [ ] 3. Checkpoint - 確認契約定義完整
  - 確認所有 contract JSON Schema 可正確驗證 fixture 資料，TypeScript 與 Python 雙語言一致。如有問題請詢問使用者。

- [ ] 4. Excel 解析與指標計算引擎（M2）

  - [ ] 4.1 實作 sheet_reader 模組
    - 在 `services/parser-metrics/` 以 Python openpyxl 實作工作表讀取
    - 辨識工作表名稱、表頭列、資料區域、合併儲存格
    - 輸出 WorkbookProfile JSON 並存入 S3
    - _需求：1.2, 1.4_

  - [ ] 4.2 實作 normalizer 模組（欄位與期間正規化）
    - 數字、百分比、日期、月份與單位標準化為一致格式
    - 期間格式轉換：民國年月（11401=114年1月）
    - 銀行名稱標準化、金額單位統一（百萬元）
    - _需求：2.1, 2.3_

  - [ ] 4.3 實作 source_mapper 模組（SourceRef 建立）
    - 為每個正規化後的數值建立 SourceRef
    - 記錄原始工作表名稱、儲存格地址（如 C5）與原始值
    - 確保 SourceRef ID 唯一且可回查
    - _需求：2.2_

  - [ ]* 4.4 撰寫 Property Test：正規化保留來源追蹤性
    - **Property 1: 正規化保留來源追蹤性**
    - 使用 Hypothesis 驗證任何正規化後數值都有對應 SourceRef，且原始值經相同邏輯可還原
    - **驗證：需求 2.1, 2.2**

  - [ ]* 4.5 撰寫 Property Test：期間格式正規化一致性
    - **Property 2: 期間格式正規化一致性**
    - 使用 Hypothesis 驗證相同原始期間輸入永遠產生相同正規化結果（YYMM 格式）
    - **驗證：需求 2.3**

  - [ ] 4.6 實作 formula_plan_builder 模組
    - 根據使用者需求與 WorkbookProfile 可用欄位自動產生公式計畫
    - 對應公式名稱、定義、輸入來源、單位與顯示格式
    - 缺少必要資料時（如 113 年同期）標記為 unsupported 並說明原因
    - _需求：3.1, 3.2_

  - [ ]* 4.7 撰寫 Property Test：公式計畫輸入可用性
    - **Property 3: 公式計畫輸入可用性**
    - 使用 Hypothesis 驗證公式的所有 inputs 引用欄位存在於 WorkbookProfile，否則標記 unsupported
    - **驗證：需求 3.1, 3.2**

  - [ ] 4.8 實作 metric_engine 確定性計算模組
    - 依照核准公式計算市占率、排名、MoM、有效卡率、單卡簽帳金額
    - 為每個計算結果記錄 SourceRef IDs、公式定義與計算步驟
    - 處理除以零、資料缺失、單位不一致（標記為 invalid）
    - _需求：4.1, 4.2, 4.5_

  - [ ]* 4.9 撰寫 Property Test：確定性計算正確性
    - **Property 4: 確定性計算正確性**
    - 使用 Hypothesis 驗證相同輸入永遠產生相同輸出，且結果符合公式數學定義（浮點誤差 ≤ 1e-10）
    - **驗證：需求 4.1**

  - [ ]* 4.10 撰寫 Property Test：指標來源完整性
    - **Property 5: 指標來源完整性**
    - 使用 Hypothesis 驗證每個 MetricRecord 的 inputSourceIds 非空、所有 SourceRef ID 存在、formulaDefinition 非空、computationSteps 至少一步
    - **驗證：需求 4.2**

  - [ ] 4.11 實作 evidence_builder 模組（EvidencePacket 凍結）
    - 組裝所有 SourceRef、MetricRecord、ChartDataSpec 為 EvidencePacket
    - 計算 canonical JSON SHA-256 hash
    - 凍結後禁止任何修改操作
    - _需求：4.3, 4.4_

  - [ ]* 4.12 撰寫 Property Test：EvidencePacket 序列化決定性與凍結不可變性
    - **Property 6: EvidencePacket 序列化決定性**
    - **Property 7: EvidencePacket 凍結不可變性**
    - 使用 Hypothesis 驗證重複序列化 hash 相同，凍結後修改拋出錯誤
    - **驗證：需求 4.3, 4.4, 5.2**

  - [ ]* 4.13 撰寫 Golden Test：附件四預期數值比對
    - 使用附件四修正參照資料作為 expected output
    - 驗證市占率、排名與趨勢數值正確
    - _需求：4.1, 14.1, 14.3_

- [ ] 5. Checkpoint - 確認解析與計算引擎正確
  - 確認 Parser 可解析附件四所有工作表、Metric Engine 通過 golden tests。如有問題請詢問使用者。

- [ ] 6. 確定性驗證層（M3）

  - [ ] 6.1 實作 workbook_validator 模組
    - 在 `services/validation/` 檢查必要工作表是否存在、欄位是否完整
    - 格式不正確或必要欄位缺失時產生 blocking typed findings
    - _需求：1.4, 1.5_

  - [ ] 6.2 實作 source_validator 與 period_entity_validator
    - 驗證 SourceRef 存在性與一致性
    - 驗證期間格式（11401-11412）、銀行名稱、百分比與金額單位
    - 無法判定格式時產生 blocking finding
    - _需求：2.3, 2.4_

  - [ ] 6.3 實作 numeric_claim_validator
    - 擷取 Claim statement 中的百分比、金額、排名數字
    - 與 EvidencePacket 中對應 MetricRecord 的 computedValue/rank 比對
    - 數字不一致時拒絕該 Claim 並記錄原因
    - _需求：6.1, 6.6_

  - [ ]* 6.4 撰寫 Property Test：Claim 數值一致性
    - **Property 10: Claim 數值一致性**
    - 使用 Hypothesis 驗證 Claim 中的數字必須與 MetricRecord 精確匹配，方向陳述必須與實際值一致
    - **驗證：需求 6.1, 6.6, 14.3, 14.4**

  - [ ] 6.5 實作 unsupported_validator
    - 確認 unsupported 指標（如缺 113 年的 YoY）不出現在任何 Claim 敘述中
    - 出現時拒絕該 Claim
    - _需求：6.3, 14.1_

  - [ ]* 6.6 撰寫 Property Test：不支援指標阻擋
    - **Property 11: 不支援指標阻擋**
    - 使用 Hypothesis 驗證 unsupported 指標的名稱或計算結果出現在 Claim 時必被拒絕
    - **驗證：需求 6.3, 14.1**

  - [ ] 6.7 實作 claim_deduplicator 與 conflict_grouper
    - 相同 claim key 合併為單一 Claim，重複不提升可信度
    - 方向/數字/排名矛盾歸入 ConflictGroup，阻擋進入最終敘事
    - _需求：6.4, 6.5_

  - [ ]* 6.8 撰寫 Property Test：Claim 去重冪等性與矛盾偵測
    - **Property 12: Claim 去重冪等性**
    - **Property 13: 矛盾偵測與阻擋**
    - 使用 Hypothesis 驗證去重冪等、矛盾 Claims 歸入同一 ConflictGroup 且不進入敘事
    - **驗證：需求 6.4, 6.5**

  - [ ] 6.9 實作 chart_ranking_validator
    - 驗證圖表排序順序、Top N、座標軸名稱、單位與期間
    - 與 EvidencePacket 中的 ChartDataSpec 和 MetricRecords 比對
    - _需求：8.4, 14.2_

  - [ ] 6.10 實作 synthesis_validator 與 slide_spec_validator
    - synthesis_validator：驗證統整敘事僅使用 accepted Claim IDs
    - slide_spec_validator：驗證 SlideDeckSpec 中每個數字/圖表與 EvidencePacket 一致
    - _需求：7.4, 8.4, 8.5_

  - [ ]* 6.11 撰寫 Property Test：統整敘事與 SlideDeckSpec 追蹤完整性
    - **Property 14: 統整敘事僅使用已接受 Claim**
    - **Property 15: SlideDeckSpec 追蹤完整性**
    - **Property 16: 圖表規格與證據一致性**
    - **驗證：需求 7.1, 7.2, 7.3, 8.1, 8.2, 8.4**

- [ ] 7. Checkpoint - 確認驗證層完整
  - 確認所有 Validator 可正確阻擋 regression cases（REG-001 至 REG-006）。如有問題請詢問使用者。

- [ ] 8. Bedrock 洞察流程（M4）

  - [ ] 8.1 建立 Skill Registry 結構與 loader
    - 在 `packages/skills/` 建立目錄結構：`market-competition/v1/`、`business-performance/v1/`、`audit-risk/v1/`、`synthesis/v1/`、`critic/v1/`、`adjustment/v1/`
    - 每個 Skill 含 `system.md`、`output.schema.json`、`rubric.yaml`
    - 實作 Python skill_loader：讀取 Skill 並記錄版本與 prompt hash
    - _需求：5.1, 15.4_

  - [ ] 8.2 實作 Bedrock Converse structured-output client
    - 在 `services/bedrock/` 封裝統一 Converse API 呼叫
    - 支援 Structured Outputs（JSON Schema 約束回應格式）
    - 檢查 stop_reason（必須為 end_turn 或 tool_use）
    - 實作一次 repair 機制（schema 不符時重新提示）
    - 處理 timeout、throttle 與 partial failure
    - _需求：5.1, 5.4_

  - [ ] 8.3 實作市場競爭 Insight Lens
    - 只讀取凍結 EvidencePacket，不得存取原始 Excel
    - 不得引入未收錄於 EvidencePacket 的外部市場資料
    - 輸出符合 RoleInsight schema，每個 Claim 附帶 Evidence IDs
    - _需求：5.2, 5.3, 5.6_

  - [ ] 8.4 實作經營績效 Insight Lens
    - 只讀取凍結 EvidencePacket
    - 不得自行計算或假設未在 EvidencePacket 中的獲利資料
    - 輸出符合 RoleInsight schema
    - _需求：5.2, 5.3, 5.7_

  - [ ] 8.5 實作風險稽核 Insight Lens
    - 只讀取凍結 EvidencePacket
    - 不得以解釋方式放行數字矛盾
    - 指出缺漏資料、風險、異常與不支援敘述
    - _需求：5.2, 5.3, 5.8_

  - [ ] 8.6 實作三 Lens 平行執行與 partial failure 處理
    - 使用 asyncio 或 Step Functions Parallel 平行啟動三個 Lens
    - 非關鍵 Lens 失敗：以降級結果繼續流程並通知使用者
    - 所有 Lens 失敗：阻擋後續流程，進入人工介入
    - _需求：5.1, 5.4, 5.5_

  - [ ]* 8.7 撰寫 Property Test：Claim 證據引用有效性
    - **Property 9: Claim 證據引用有效性**
    - 使用 Hypothesis 驗證 Claim 的所有 evidenceIds 存在於 EvidencePacket，且引用的 MetricRecord 值與 Claim 數字一致
    - **驗證：需求 5.6, 5.7, 6.2**

  - [ ] 8.8 實作 ClaimRegistry 建構（接受/拒絕分類）
    - 整合 Validator 結果，只保存通過驗證的 Claims
    - 記錄所有 rejected Claims 與 rejection reasons
    - _需求：6.1, 6.2, 6.4, 6.5_

  - [ ] 8.9 實作 Synthesizer（統整敘事合成）
    - 僅使用 ClaimRegistry 中 accepted Claim IDs 組合敘事
    - 不得新增未驗證數字、排名或因果關係
    - 不得使用被拒絕的 Claim
    - _需求：7.1, 7.2, 7.3_

  - [ ] 8.10 實作 Critic 與 bounded refine（最多一次修正）
    - 檢查過度推論、Caveat 遺漏、覆蓋率與可讀性
    - 發現問題最多觸發一次 Synthesizer 修正
    - 修正後仍不通過則標記降級結果
    - _需求：7.4, 7.5_

- [ ] 9. Checkpoint - 確認 Bedrock 流程可產生有效洞察
  - 確認三 Lens 可正常執行、ClaimRegistry 正確分類、Synthesizer 不產生新數字。如有問題請詢問使用者。

- [ ] 10. 預覽與 Office 輸出渲染（M5）

  - [ ] 10.1 實作 SlideDeckSpec builder
    - 將 Synthesizer 統整敘事 + ChartDataSpec + 品牌規格轉為 SlideDeckSpec
    - 每張投影片定義 layout、masterId、claim IDs、chart specs、source hover targets
    - _需求：8.1, 8.2, 8.3_

  - [ ] 10.2 實作 HTML Preview Renderer
    - 在 `services/render-html-preview/` 以 TypeScript 產生 16:9 HTML 預覽
    - 包含每張投影片縮圖與全頁預覽
    - 套用台新品牌樣式（紅白漸層、Logo）
    - _需求：9.1_

  - [ ] 10.3 實作 Source Hover manifest 與互動功能
    - 產生 Source Hover Manifest JSON
    - 每個數字可顯示 Metric 名稱、公式定義、工作表、儲存格地址與 Caveat
    - _需求：9.2_

  - [ ]* 10.4 撰寫 Property Test：Source Hover 完整性
    - **Property 17: Source Hover 完整性**
    - 使用 fast-check 驗證每個 Source Hover 目標的 manifest 包含完整資訊
    - **驗證：需求 9.2**

  - [ ] 10.5 實作 PptxGenJS Slide Master 與品牌版型
    - 在 `services/render-pptx/` 以 TypeScript 使用 `pptxgenjs`
    - 使用 `defineSlideMaster` 定義封面、目錄、章節、圖表、表格、結尾頁
    - 套用 brand_tokens（16:9、紅白漸層、Logo、字體、頁首頁尾）
    - _需求：11.2, 11.6_

  - [ ] 10.6 實作原生可編輯 PowerPoint 圖表與表格
    - 使用 PptxGenJS 原生 chart API 建立圖表物件（折線圖、柱狀圖、圓餅圖）
    - 圖表資料內嵌於 PowerPoint XML（可透過「編輯資料」修改）
    - 所有表格使用原生 PowerPoint table object，非文字框堆疊
    - _需求：11.3, 11.4_

  - [ ]* 10.7 撰寫 Property Test：PPTX 原生圖表與表格物件
    - **Property 19: PPTX 原生圖表物件**
    - **Property 20: PPTX 原生表格物件**
    - 使用 fast-check 驗證產生的 PPTX 中圖表為 `<c:chartSpace>` 元素、表格為 `<a:tbl>` 元素
    - **驗證：需求 11.3, 11.4**

  - [ ] 10.8 實作 XlsxWriter companion workbook
    - 在 `services/render-xlsx/` 以 Python XlsxWriter 產生伴隨 XLSX
    - 包含工作表：SourceManifest、NormalizedData、Metrics、ChartData、Claims、Citations、ValidationReport
    - 圖表為 Excel 原生可編輯
    - _需求：12.1, 12.2, 12.3_

  - [ ]* 10.9 撰寫 Property Test：跨 Artifact 數值一致性
    - **Property 21: 跨 Artifact 數值一致性**
    - 使用 Hypothesis 驗證 PPTX 圖表數值與 XLSX Metrics 工作表精確相等（誤差 ≤ 1e-10）
    - **驗證：需求 12.4**

  - [ ] 10.10 實作 artifact_validator（PPTX/XLSX 品質驗證）
    - 驗證 PPTX 可開啟、無 repair dialog
    - 驗證圖表為 native chart objects、表格為 native table
    - 驗證 XLSX 包含所有必要工作表
    - 驗證 PPTX 與 XLSX 數值一致
    - _需求：11.5, 12.4, 14.5, 14.6_

  - [ ] 10.11 實作自然語言 Adjustment interpreter
    - 在 `services/bedrock/` 實作 adjustment_interpreter
    - 允許修改：標題、敘述措辭、投影片順序、文字長度、版面配置
    - 拒絕修改：數字、排名、移除必要 Caveat
    - 調整後重新驗證 SlideDeckSpec 並更新 HTML Preview
    - _需求：10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 10.12 撰寫 Property Test：調整數字保護
    - **Property 18: 調整數字保護**
    - 使用 fast-check 驗證嘗試修改數字/排名/Caveat 的調整被拒絕，合法調整後 Source Hover 與 Evidence ID 不變
    - **驗證：需求 10.3, 10.5**

- [ ] 11. Checkpoint - 確認渲染輸出品質
  - 確認 PPTX/XLSX 可正常開啟、圖表可編輯、數值與 EvidencePacket 一致。如有問題請詢問使用者。

- [ ] 12. AWS 基礎設施與工作流編排（M6）

  - [ ] 12.1 建立 CDK DataStack
    - 在 `infra/cdk/` 定義 Private S3 Buckets（Input/Evidence/Artifacts）
    - 設定 Block Public Access、SSE-KMS 加密、Versioning
    - 建立 DynamoDB Tables（Jobs、CallbackTokens）
    - 設定 S3 Lifecycle Rules
    - _需求：16.1, 13.2_

  - [ ] 12.2 建立 CDK ApiStack
    - 定義 HTTP API Gateway + Cognito Authorizer
    - 建立 API Lambda Handler（TypeScript）
    - 設定 CORS、Presigned URL 產生邏輯
    - 實作 Job CRUD 端點（POST /jobs、GET /jobs/{jobId}、等）
    - _需求：1.1, 16.5_

  - [ ] 12.3 建立 CDK WorkflowStack - Lambda Workers
    - 建立 Parser/Validation Python Lambda Container（ECR image）
    - 建立 Bedrock Lens Python Lambda
    - 建立 PptxGenJS Node Lambda
    - 建立 XlsxWriter Python Lambda
    - 建立 HTML Preview TypeScript Lambda
    - 每個 Lambda 設定 IAM least privilege
    - _需求：13.1, 16.3_

  - [ ] 12.4 建立 Step Functions Standard state machine
    - 定義完整工作流 DAG：InitializeJob → ParseSheetsMap → ... → CompleteJob
    - 使用 S3 URI 在 Steps 間傳遞大型資料（payload ≤ 256 KiB）
    - 實作 Callback pattern 用於公式計畫確認與預覽核准
    - _需求：13.1, 13.2, 13.3_

  - [ ]* 12.5 撰寫 Property Test：State Payload 大小約束
    - **Property 22: State Payload 大小約束**
    - 驗證所有 state payload JSON UTF-8 編碼後 ≤ 262,144 bytes
    - **驗證：需求 13.2**

  - [ ] 12.6 實作 Parallel branches、Catch handlers 與 retries
    - 三 Lens Parallel branch 各自含 Catch handler，回傳 typed failure
    - 三 Renderer Parallel branch 各自含 Catch handler
    - 設定 Retry 策略（IntervalSeconds: 2、MaxAttempts: 2、BackoffRate: 2.0）
    - _需求：13.4, 13.5_

  - [ ] 12.7 串接 S3 upload event 與 Job lifecycle
    - S3 ObjectCreated → EventBridge → 觸發 Step Functions
    - Presigned URL upload 完成後自動啟動指定 Job
    - 確保 idempotency（重複事件不建立重複執行）
    - _需求：1.1, 13.1_

  - [ ] 12.8 建立安全性設定
    - 每個 Lambda worker IAM least privilege（僅允許必要 S3 prefix 與 DynamoDB 資源）
    - CloudWatch Logs 不記錄完整財務儲存格內容
    - 短效期 Presigned URL（限制 content type、size、object key）
    - _需求：16.1, 16.2, 16.3, 16.4_

- [ ] 13. Checkpoint - 確認 AWS 基礎設施可部署
  - 確認 CDK synth 成功、Step Functions 狀態機定義正確、所有 Lambda 可打包。如有問題請詢問使用者。

- [ ] 14. 前端與使用者流程（M7）

  - [ ] 14.1 建立 React application shell 與台新品牌基礎
    - 在 `apps/web/` 以 React + TypeScript 建立前端
    - 設定 Amplify Hosting 部署配置
    - 套用台新品牌基本視覺（紅白漸層、Logo、字體）
    - _需求：9.3_

  - [ ] 14.2 實作 Job 建立與 S3 直傳上傳
    - 呼叫 API 建立 Job 取得 Presigned URL
    - 使用 Presigned URL 直接上傳 Excel 至 S3（不經 API Gateway）
    - 顯示上傳進度
    - _需求：1.1_

  - [ ] 14.3 實作 Job 狀態輪詢與處理進度顯示
    - 輪詢 GET /jobs/{jobId} 取得最新狀態
    - 顯示當前 Stage、warnings、failures 與部分完成狀態
    - _需求：13.1_

  - [ ] 14.4 實作公式計畫審核畫面
    - 顯示公式名稱、定義、輸入來源、假設與 unsupported 項目
    - 使用者可核准或修改公式計畫
    - 送出核准後觸發 Step Functions callback 繼續流程
    - _需求：3.3, 3.4, 3.5_

  - [ ] 14.5 實作簡報工作台（預覽 + Source Hover）
    - 左側：投影片縮圖列
    - 中央：16:9 HTML 預覽區
    - 右側：洞察與來源證據面板
    - 點選投影片時顯示該頁 Claims 與 Evidence 詳情
    - Source Hover：滑鼠移至數字顯示追蹤資訊
    - _需求：9.1, 9.2, 9.3, 9.4_

  - [ ] 14.6 實作自然語言調整輸入與重新預覽
    - 提供調整輸入框
    - 送出調整指令至 API
    - 非法修改（數字/排名/Caveat）時顯示拒絕原因
    - 合法調整後自動更新預覽
    - _需求：10.1, 10.2, 10.3, 10.4_

  - [ ] 14.7 實作最終核准與 Artifact 下載
    - 核准按鈕觸發 Step Functions callback
    - 產生短效期 Presigned Download URLs
    - 提供 PPTX 與 XLSX 下載按鈕
    - _需求：11.1, 12.1_

  - [ ] 14.8 實作模擬寄信功能
    - 使用者填入收件者與主旨
    - 記錄 recipient、subject、artifact IDs、timestamp
    - 不寄出真實 Email，僅保存模擬紀錄
    - _需求：15.1, 15.2_

- [ ] 15. Checkpoint - 確認前端流程可完整操作
  - 確認前端可完成上傳 → 確認公式 → 預覽 → 調整 → 下載的完整流程。如有問題請詢問使用者。

- [ ] 16. 端到端測試與 Demo 準備（M8）

  - [ ] 16.1 建立完整 happy-path E2E 測試
    - 從 fixture Excel 上傳到 PPTX/XLSX 下載的完整流程
    - 驗證每個階段的輸出符合 contract
    - _需求：所有需求的端到端驗證_

  - [ ] 16.2 建立四個主要 failure-path E2E 測試
    - E2E-FAIL-01：unsupported YoY 被正確阻擋
    - E2E-FAIL-02：錯誤排名被拒絕
    - E2E-FAIL-03：數字矛盾被偵測
    - E2E-FAIL-04：Lens partial failure 正確降級
    - _需求：14.1, 14.3, 14.4, 5.4_

  - [ ] 16.3 執行 PPTX/XLSX 手動 QA 驗證
    - 以 PowerPoint 實際開啟 PPTX，確認圖表可編輯
    - 以 Excel 實際開啟 XLSX，確認工作表完整
    - 儲存後再次開啟確認無損壞
    - _需求：11.3, 11.4, 11.5, 12.3_

  - [ ] 16.4 執行安全性審查
    - 確認無 public S3 bucket
    - 確認無非必要 IAM wildcard
    - 確認 CloudWatch Logs 無原始敏感儲存格內容
    - _需求：16.1, 16.3, 16.4_

  - [ ] 16.5 建立 Live Demo 腳本
    - 設計在競賽限制時間內展示完整流程的 Demo 劇本
    - 涵蓋：公式確認、錯誤阻擋、來源 Hover、自然語言調整、可編輯輸出
    - _需求：所有需求的 Demo 展示_

- [ ] 17. Final Checkpoint - 確認 MVP 完成
  - 確認所有 MVP 完成條件已滿足、E2E 測試通過、Demo 可在限時內完成。如有問題請詢問使用者。

## Notes

- 標記 `*` 的子任務為選用任務，可跳過以加速 MVP 開發
- 每個任務引用特定需求以確保追蹤性
- Checkpoint 確保增量驗證，及早發現問題
- Property Tests 驗證通用正確性屬性（使用 Hypothesis/fast-check）
- Unit Tests 驗證特定案例與邊界條件
- Python 服務：pytest + Hypothesis
- TypeScript 服務：vitest + fast-check
- 跨語言契約：JSON Schema + Ajv + Pydantic

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5"] },
    { "id": 5, "tasks": ["2.6"] },
    { "id": 6, "tasks": ["4.1", "12.1"] },
    { "id": 7, "tasks": ["4.2", "4.3"] },
    { "id": 8, "tasks": ["4.4", "4.5", "4.6"] },
    { "id": 9, "tasks": ["4.7", "4.8"] },
    { "id": 10, "tasks": ["4.9", "4.10", "4.11"] },
    { "id": 11, "tasks": ["4.12", "4.13"] },
    { "id": 12, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 13, "tasks": ["6.4", "6.5"] },
    { "id": 14, "tasks": ["6.6", "6.7", "6.9"] },
    { "id": 15, "tasks": ["6.8", "6.10"] },
    { "id": 16, "tasks": ["6.11", "8.1", "8.2"] },
    { "id": 17, "tasks": ["8.3", "8.4", "8.5"] },
    { "id": 18, "tasks": ["8.6", "8.7"] },
    { "id": 19, "tasks": ["8.8", "8.9"] },
    { "id": 20, "tasks": ["8.10", "10.1"] },
    { "id": 21, "tasks": ["10.2", "10.3", "10.5"] },
    { "id": 22, "tasks": ["10.4", "10.6", "10.8"] },
    { "id": 23, "tasks": ["10.7", "10.9", "10.10", "10.11"] },
    { "id": 24, "tasks": ["10.12", "12.2", "12.3"] },
    { "id": 25, "tasks": ["12.4", "12.7", "12.8"] },
    { "id": 26, "tasks": ["12.5", "12.6"] },
    { "id": 27, "tasks": ["14.1"] },
    { "id": 28, "tasks": ["14.2", "14.3"] },
    { "id": 29, "tasks": ["14.4", "14.5"] },
    { "id": 30, "tasks": ["14.6", "14.7"] },
    { "id": 31, "tasks": ["14.8"] },
    { "id": 32, "tasks": ["16.1"] },
    { "id": 33, "tasks": ["16.2", "16.3", "16.4"] },
    { "id": 34, "tasks": ["16.5"] }
  ]
}
```
