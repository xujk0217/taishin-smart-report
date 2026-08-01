import { z } from 'zod';

export const PLANNER_LIMITS = {
  maxFiles: 20,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxPromptCharacters: 12_000,
  maxRevisionCharacters: 4_000,
} as const;

const isoDateTime = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeFileName = z.string().min(1).max(160).refine(
  value => value.toLowerCase().endsWith('.xlsx') && !value.includes('/') && !value.includes('\\') && !/\p{C}/u.test(value),
  'Only path-free .xlsx file names are accepted',
);

export const plannerJobStatusSchema = z.enum([
  'UPLOAD_PENDING',
  'QUEUED',
  'RUNNING',
  'NEEDS_REVIEW',
  'REVISION_QUEUED',
  'APPROVED',
  'FAILED',
  'EXPIRED',
]);
export type PlannerJobStatus = z.infer<typeof plannerJobStatusSchema>;

export const uploadFileRequestSchema = z.object({
  fileName: safeFileName,
  sizeBytes: z.number().int().positive().max(PLANNER_LIMITS.maxFileBytes),
  sha256,
}).strict();
export type UploadFileRequest = z.infer<typeof uploadFileRequestSchema>;

export const createUploadRequestSchema = z.object({
  files: z.array(uploadFileRequestSchema).min(1).max(PLANNER_LIMITS.maxFiles),
}).strict().superRefine((request, context) => {
  const total = request.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (total > PLANNER_LIMITS.maxTotalBytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['files'], message: 'Total upload size exceeds the limit' });
  }
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

export const uploadSlotSchema = z.object({
  uploadId: uuid,
  fileName: safeFileName,
  objectKey: z.string().min(1).max(512),
  uploadUrl: z.string().url(),
  fields: z.record(z.string()),
  expiresInSeconds: z.number().int().positive(),
}).strict();
export type UploadSlot = z.infer<typeof uploadSlotSchema>;

export const createUploadResponseSchema = z.object({
  jobId: uuid,
  status: z.literal('UPLOAD_PENDING'),
  uploads: z.array(uploadSlotSchema).min(1).max(PLANNER_LIMITS.maxFiles),
  expiresAt: isoDateTime,
}).strict();
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;

export const createPlanRequestSchema = z.object({
  jobId: uuid,
  prompt: z.string().trim().min(1).max(PLANNER_LIMITS.maxPromptCharacters),
}).strict();
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;

export const revisePlanRequestSchema = z.object({
  instruction: z.string().trim().min(1).max(PLANNER_LIMITS.maxRevisionCharacters),
  expectedPlanVersion: z.number().int().positive(),
}).strict();
export type RevisePlanRequest = z.infer<typeof revisePlanRequestSchema>;

export const approvePlanRequestSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
}).strict();
export type ApprovePlanRequest = z.infer<typeof approvePlanRequestSchema>;

export const requirementOriginSchema = z.enum(['explicit', 'inferred', 'recommended']);

const editableScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const editableFieldValueSchema = z.union([editableScalarSchema, z.array(editableScalarSchema)]);
const editableFieldsSchema = z.record(editableFieldValueSchema).default({});

const metricRequirementSchema = z.object({
  metric_id: z.string().min(1),
  name: z.string().min(1),
  purpose: z.string().min(1),
  definition_needed: z.string(),
  calculation_required: z.boolean(),
  origin: requirementOriginSchema,
  required: z.boolean(),
  custom_fields: editableFieldsSchema,
}).strict();

const chartRequirementSchema = z.object({
  chart_id: z.string().min(1),
  title: z.string().min(1),
  visualization: z.string().min(1),
  purpose: z.string().min(1),
  data_requirements: z.array(z.string()),
  formula_ids: z.array(z.string().min(1)),
  calculation_task_ids: z.array(z.string().min(1)),
  origin: requirementOriginSchema,
  rationale: z.string(),
  required: z.boolean(),
  custom_fields: editableFieldsSchema,
}).strict();

const insightRequirementSchema = z.object({
  insight_id: z.string().min(1),
  question: z.string().min(1),
  purpose: z.string().min(1),
  evidence_needed: z.array(z.string()),
  origin: requirementOriginSchema,
  required: z.boolean(),
  custom_fields: editableFieldsSchema,
}).strict();

const flexibleRequirementSchema = z.object({
  requirement_id: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  origin: requirementOriginSchema,
  acceptance_criteria: z.array(z.string()),
  custom_fields: editableFieldsSchema,
}).strict();

const formulaVariableSchema = z.object({
  symbol: z.string().min(1),
  definition: z.string().min(1),
  expected_unit: z.string(),
}).strict();

const formulaSourceCandidateSchema = z.object({
  source_type: z.enum(['user-provided', 'workbook-derived', 'model-knowledge', 'web-research']),
  title: z.string().min(1),
  locator: z.string().min(1),
  rationale: z.string().min(1),
  verification_state: z.enum(['unverified', 'verified', 'rejected']),
}).strict();

const formulaDefinitionSchema = z.object({
  formula_id: z.string().min(1),
  name: z.string().min(1),
  purpose: z.string().min(1),
  expression: z.string().min(1),
  variables: z.array(formulaVariableSchema).min(1),
  output_unit: z.string(),
  applicability_conditions: z.array(z.string()),
  assumptions: z.array(z.string()),
  missing_data_policy: z.string().min(1),
  zero_division_policy: z.string().min(1),
  source_candidates: z.array(formulaSourceCandidateSchema),
  status: z.enum(['verified', 'needs-research', 'needs-user-confirmation', 'unsupported']),
  required: z.boolean(),
  custom_fields: editableFieldsSchema,
}).strict();

export const formulaPlanSchema = z.object({
  plan_version: z.literal('formula-plan-v1'),
  research_strategy: z.enum(['none', 'model-knowledge-only', 'controlled-web-research', 'mixed']),
  formulas: z.array(formulaDefinitionSchema),
  unresolved_questions: z.array(z.string()),
  custom_fields: editableFieldsSchema,
}).strict().superRefine((plan, context) => {
  const identifiers = plan.formulas.map(formula => formula.formula_id);
  if (new Set(identifiers).size !== identifiers.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['formulas'], message: 'Formula identifiers must be unique' });
  }
});

const calculationInputBindingSchema = z.object({
  variable: z.string().min(1),
  workbook_upload_id: z.string().min(1),
  workbook_selector: z.string().min(1),
  sheet_selector: z.string().min(1),
  column_selector: z.string().min(1),
  cell_range_hint: z.string(),
  aggregation: z.string().min(1),
  required: z.boolean(),
}).strict();

const calculationTaskSchema = z.object({
  task_id: z.string().min(1),
  output_metric_id: z.string().min(1),
  formula_id: z.string().min(1),
  objective: z.string().min(1),
  input_bindings: z.array(calculationInputBindingSchema).min(1),
  output_fields: z.array(z.string()).min(1),
  code_generation_instructions: z.array(z.string()).min(1),
  validation_checks: z.array(z.string()).min(1),
  provenance_requirements: z.array(z.string()).min(1),
  custom_fields: editableFieldsSchema,
}).strict();

const generatedCodePolicySchema = z.object({
  language: z.literal('python'),
  allowed_libraries: z.array(z.enum(['python-standard-library', 'openpyxl'])).min(1),
  network_access: z.literal(false),
  read_only_inputs: z.literal(true),
  forbidden_operations: z.array(z.string()).min(1),
}).strict();

export const calculationPlanSchema = z.object({
  plan_version: z.literal('calculation-plan-v1'),
  generated_code_policy: generatedCodePolicySchema,
  tasks: z.array(calculationTaskSchema),
  execution_order: z.array(z.string()),
  custom_fields: editableFieldsSchema,
}).strict().superRefine((plan, context) => {
  const taskIds = plan.tasks.map(task => task.task_id);
  if (new Set(taskIds).size !== taskIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['tasks'], message: 'Calculation task identifiers must be unique' });
  }
  if (JSON.stringify(plan.execution_order) !== JSON.stringify(taskIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['execution_order'], message: 'Execution order must list every task exactly once in task order' });
  }
});

const templateAnalysisPlanSchema = z.object({
  template_required: z.boolean(),
  classification_rules: z.array(z.string()).min(1),
  required_slide_roles: z.array(z.enum(['cover', 'content', 'section', 'appendix', 'back-cover'])).min(1),
  inspect_master_layouts: z.literal(true),
  inspect_placeholders: z.literal(true),
  inspect_theme_and_dimensions: z.literal(true),
  preserve_unmodified_template_objects: z.literal(true),
}).strict();

const pythonPptGenerationPlanSchema = z.object({
  language: z.literal('python'),
  primary_library: z.literal('python-pptx'),
  generation_steps: z.array(z.string()).min(1),
  editable_object_requirements: z.array(z.string()).min(1),
  fidelity_checks: z.array(z.string()).min(1),
}).strict();

const previewEditingPlanSchema = z.object({
  manual_editable_fields: z.array(z.string()).min(1),
  natural_language_editing: z.literal(true),
  revision_behavior: z.array(z.string()).min(1),
}).strict();

const provenanceDisplayPlanSchema = z.object({
  required_fields: z.array(z.string()).min(1),
  show_per_chart: z.literal(true),
  show_only_actual_data: z.literal(true),
}).strict();

export const presentationGenerationPlanSchema = z.object({
  plan_version: z.literal('presentation-generation-plan-v1'),
  template_analysis: templateAnalysisPlanSchema,
  python_generation: pythonPptGenerationPlanSchema,
  layout_consistency_rules: z.array(z.string()).min(1),
  preview_editing: previewEditingPlanSchema,
  provenance_display: provenanceDisplayPlanSchema,
  final_export_requirements: z.array(z.string()).min(1),
  custom_fields: editableFieldsSchema,
}).strict();

export const promptContractV3Schema = z.object({
  contract_version: z.literal('prompt-contract-v3'),
  user_intent: z.string().min(1),
  presentation_goal: z.string().min(1),
  target_audience: z.string(),
  language: z.string().min(1),
  recommended_page_count: z.number().int().min(3).max(60),
  page_count_origin: requirementOriginSchema,
  page_count_rationale: z.string(),
  tone_and_style: z.array(z.string()),
  visual_direction: z.array(z.string()),
  metrics: z.array(metricRequirementSchema),
  charts: z.array(chartRequirementSchema),
  insights: z.array(insightRequirementSchema),
  data_requirements: z.array(z.string()),
  research_requirements: z.array(z.string()),
  formula_requirements: z.array(z.string()),
  content_constraints: z.array(z.string()),
  output_requirements: z.array(z.string()),
  custom_requirements: z.array(flexibleRequirementSchema),
  assumptions: z.array(z.string()),
  ambiguities: z.array(z.string()),
  custom_fields: editableFieldsSchema,
}).strict().superRefine((contract, context) => {
  const identifiers = [
    ...contract.metrics.map(item => item.metric_id),
    ...contract.charts.map(item => item.chart_id),
    ...contract.insights.map(item => item.insight_id),
    ...contract.custom_requirements.map(item => item.requirement_id),
  ];
  if (new Set(identifiers).size !== identifiers.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Requirement identifiers must be unique' });
  }
});

const governanceStageSchema = z.enum(['understand', 'acquire', 'analyze', 'compose', 'render-verify']);
const toolCategorySchema = z.enum(['contract', 'data-read', 'research', 'calculation', 'analysis', 'deck-planning', 'rendering', 'inspection']);
const executionStageSchema = z.object({
  stage_id: z.string().min(1),
  stage_class: governanceStageSchema,
  objective: z.string().min(1),
  planned_activities: z.array(z.string()),
  required_inputs: z.array(z.string()),
  allowed_tool_categories: z.array(toolCategorySchema),
  required_outputs: z.array(z.string()),
  validation_checks: z.array(z.string()).min(1),
  completion_criteria: z.array(z.string()).min(1),
  requires_user_approval: z.boolean(),
}).strict();

export const fiveStageExecutionPlanSchema = z.object({
  stages: z.array(executionStageSchema).length(5),
}).strict().superRefine((plan, context) => {
  const expectedOrder = ['understand', 'acquire', 'analyze', 'compose', 'render-verify'];
  const allowedTools: Record<string, Set<string>> = {
    understand: new Set(['contract']),
    acquire: new Set(['data-read', 'research']),
    analyze: new Set(['calculation', 'analysis']),
    compose: new Set(['deck-planning']),
    'render-verify': new Set(['rendering', 'inspection']),
  };
  if (plan.stages.some((stage, index) => stage.stage_class !== expectedOrder[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['stages'], message: 'Execution stages must follow the fixed governance order' });
  }
  if (new Set(plan.stages.map(stage => stage.stage_id)).size !== plan.stages.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['stages'], message: 'Stage identifiers must be unique' });
  }
  plan.stages.forEach((stage, index) => {
    if (stage.allowed_tool_categories.some(tool => !allowedTools[stage.stage_class].has(tool))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['stages', index, 'allowed_tool_categories'], message: 'Tool category is outside the stage governance policy' });
    }
  });
});

const slidePlanSchema = z.object({
  page_number: z.number().int().positive(),
  kind: z.enum(['cover', 'content', 'section', 'appendix', 'back-cover']),
  title: z.string().min(1),
  communication_goal: z.string().min(1),
  key_message: z.string().min(1),
  content_elements: z.array(z.string()),
  metric_ids: z.array(z.string()),
  formula_ids: z.array(z.string()),
  chart_ids: z.array(z.string()),
  insight_ids: z.array(z.string()),
  custom_requirement_ids: z.array(z.string()),
  evidence_requirements: z.array(z.string()),
  layout_guidance: z.string(),
  speaker_notes_guidance: z.string(),
  editable: z.boolean(),
  custom_fields: editableFieldsSchema,
}).strict();

export const deckPlanV3Schema = z.object({
  plan_version: z.literal('deck-plan-v3'),
  title: z.string().min(1),
  subtitle: z.string(),
  total_pages: z.number().int().min(3).max(60),
  narrative_strategy: z.string().min(1),
  narrative_arc: z.array(z.string()),
  slides: z.array(slidePlanSchema).min(3).max(60),
  unresolved_questions: z.array(z.string()),
  planning_notes: z.array(z.string()),
  custom_fields: editableFieldsSchema,
}).strict().superRefine((deck, context) => {
  if (deck.slides.length !== deck.total_pages) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['slides'], message: 'Slides must contain exactly total_pages entries' });
  }
  if (deck.slides.some((slide, index) => slide.page_number !== index + 1)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['slides'], message: 'Slide page numbers must be contiguous and one-based' });
  }
  if (deck.slides[0]?.kind !== 'cover' || deck.slides.at(-1)?.kind !== 'back-cover') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['slides'], message: 'A deck must start with a cover and end with a back-cover' });
  }
});

export const aiPlanningOutputSchema = z.object({
  output_version: z.literal('ai-planning-output-v3'),
  prompt_contract: promptContractV3Schema,
  formula_plan: formulaPlanSchema,
  calculation_plan: calculationPlanSchema,
  presentation_generation_plan: presentationGenerationPlanSchema,
  execution_plan: fiveStageExecutionPlanSchema,
  deck_plan: deckPlanV3Schema,
  custom_fields: editableFieldsSchema,
}).strict().superRefine((output, context) => {
  if (output.deck_plan.total_pages !== output.prompt_contract.recommended_page_count) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deck_plan', 'total_pages'], message: 'Deck page count must match the prompt contract recommendation' });
  }
  const metricIds = new Set(output.prompt_contract.metrics.map(metric => metric.metric_id));
  const chartIds = new Set(output.prompt_contract.charts.map(chart => chart.chart_id));
  const insightIds = new Set(output.prompt_contract.insights.map(insight => insight.insight_id));
  const customRequirementIds = new Set(output.prompt_contract.custom_requirements.map(item => item.requirement_id));
  const formulaById = new Map(output.formula_plan.formulas.map(formula => [formula.formula_id, formula]));
  const taskIds = new Set(output.calculation_plan.tasks.map(task => task.task_id));
  const calculatedMetricIds = new Set(output.calculation_plan.tasks.map(task => task.output_metric_id));
  for (const metric of output.prompt_contract.metrics) {
    if (metric.calculation_required && !calculatedMetricIds.has(metric.metric_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['calculation_plan', 'tasks'], message: `Metric ${metric.metric_id} requires a calculation task` });
    }
  }
  for (const [index, task] of output.calculation_plan.tasks.entries()) {
    if (!metricIds.has(task.output_metric_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['calculation_plan', 'tasks', index, 'output_metric_id'], message: 'Unknown metric reference' });
    }
    const formula = formulaById.get(task.formula_id);
    if (!formula) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['calculation_plan', 'tasks', index, 'formula_id'], message: 'Unknown formula reference' });
      continue;
    }
    const variables = [...new Set(formula.variables.map(variable => variable.symbol))].sort();
    const bindings = [...new Set(task.input_bindings.map(binding => binding.variable))].sort();
    if (JSON.stringify(variables) !== JSON.stringify(bindings)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['calculation_plan', 'tasks', index, 'input_bindings'], message: 'Input bindings must match formula variables' });
    }
  }
  const referencedFormulaIds = [
    ...output.prompt_contract.charts.flatMap(chart => chart.formula_ids),
    ...output.deck_plan.slides.flatMap(slide => slide.formula_ids),
  ];
  if (referencedFormulaIds.some(identifier => !formulaById.has(identifier))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['formula_plan'], message: 'Chart or slide references an unknown formula' });
  }
  if (output.prompt_contract.charts.some(chart => chart.calculation_task_ids.some(identifier => !taskIds.has(identifier)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['prompt_contract', 'charts'], message: 'Chart references an unknown calculation task' });
  }
  const referencedMetrics = new Set(output.deck_plan.slides.flatMap(slide => slide.metric_ids));
  const referencedCharts = new Set(output.deck_plan.slides.flatMap(slide => slide.chart_ids));
  const referencedInsights = new Set(output.deck_plan.slides.flatMap(slide => slide.insight_ids));
  const referencedCustom = new Set(output.deck_plan.slides.flatMap(slide => slide.custom_requirement_ids));
  const hasUnknown = (
    [...referencedMetrics].some(identifier => !metricIds.has(identifier))
    || [...referencedCharts].some(identifier => !chartIds.has(identifier))
    || [...referencedInsights].some(identifier => !insightIds.has(identifier))
    || [...referencedCustom].some(identifier => !customRequirementIds.has(identifier))
  );
  if (hasUnknown) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deck_plan', 'slides'], message: 'Deck references an unknown planning item' });
  }
  const missingRequired = (
    output.prompt_contract.metrics.some(item => item.required && !referencedMetrics.has(item.metric_id))
    || output.prompt_contract.charts.some(item => item.required && !referencedCharts.has(item.chart_id))
    || output.prompt_contract.insights.some(item => item.required && !referencedInsights.has(item.insight_id))
    || output.prompt_contract.custom_requirements.some(item => !referencedCustom.has(item.requirement_id))
  );
  if (missingRequired) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deck_plan', 'slides'], message: 'Required planning item is not assigned to a slide' });
  }
});
export type AIPlanningOutputDto = z.infer<typeof aiPlanningOutputSchema>;

export const manualPlanEditRequestSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
  planningOutput: aiPlanningOutputSchema,
  editSummary: z.string().trim().max(1_000).optional(),
}).strict();
export type ManualPlanEditRequest = z.infer<typeof manualPlanEditRequestSchema>;

export const workbookSourceReferenceSchema = z.object({
  uploadId: uuid,
  fileName: safeFileName,
  sheetName: z.string().min(1).max(160),
  cellRange: z.string().min(1).max(64),
}).strict();
export type WorkbookSourceReference = z.infer<typeof workbookSourceReferenceSchema>;

export const plannerJobResponseSchema = z.object({
  jobId: uuid,
  status: plannerJobStatusSchema,
  planVersion: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  expiresAt: isoDateTime,
  planningOutput: aiPlanningOutputSchema.nullable(),
  sourceReferences: z.array(workbookSourceReferenceSchema),
  safeErrorCode: z.string().max(120).nullable(),
}).strict();
export type PlannerJobResponse = z.infer<typeof plannerJobResponseSchema>;
