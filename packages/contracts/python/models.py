"""
Shared data contracts (Python Pydantic models).
These mirror the JSON Schema definitions and TypeScript types.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator


# ─── Enums ────────────────────────────────────────────────────

class DataType(str, Enum):
    percentage = "percentage"
    amount = "amount"
    count = "count"
    rank = "rank"
    date = "date"
    text = "text"


class MetricUnit(str, Enum):
    percent = "percent"
    million_twd = "million_twd"
    count = "count"
    rank = "rank"
    ratio = "ratio"


class JobStatus(str, Enum):
    created = "created"
    processing = "processing"
    waiting_formula_approval = "waiting_formula_approval"
    waiting_preview_approval = "waiting_preview_approval"
    completed = "completed"
    failed = "failed"


class ClaimStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"
    conflict = "conflict"


class ClaimDirection(str, Enum):
    positive = "positive"
    negative = "negative"
    neutral = "neutral"


class ClaimMagnitude(str, Enum):
    high = "high"
    moderate = "moderate"
    low = "low"


class SourceRole(str, Enum):
    market_competition = "market_competition"
    business_performance = "business_performance"
    risk_audit = "risk_audit"


class FormulaPlanStatus(str, Enum):
    pending_approval = "pending_approval"
    approved = "approved"
    rejected = "rejected"


class FindingSeverity(str, Enum):
    blocking = "blocking"
    warning = "warning"
    info = "info"


# ─── SourceRef ────────────────────────────────────────────────

class SourceRef(BaseModel):
    source_id: str = Field(alias="sourceId")
    sheet_name: str = Field(alias="sheetName")
    cell_address: str = Field(alias="cellAddress")
    raw_value: str = Field(alias="rawValue")
    normalized_value: float = Field(alias="normalizedValue")
    data_type: DataType = Field(alias="dataType")
    period: str
    entity: str

    model_config = {"populate_by_name": True}


# ─── MetricRecord ─────────────────────────────────────────────

class MetricRecord(BaseModel):
    metric_id: str = Field(alias="metricId")
    metric_name: str = Field(alias="metricName")
    formula_id: str = Field(alias="formulaId")
    formula_definition: str = Field(alias="formulaDefinition")
    input_source_ids: list[str] = Field(alias="inputSourceIds", min_length=1)
    computed_value: float = Field(alias="computedValue")
    unit: MetricUnit
    period: str
    entity: str
    rank: Optional[int] = None
    rank_total: Optional[int] = Field(None, alias="rankTotal")
    computation_steps: list[str] = Field(alias="computationSteps", min_length=1)
    valid: bool = True
    invalid_reason: Optional[str] = Field(None, alias="invalidReason")

    model_config = {"populate_by_name": True}


# ─── Finding ──────────────────────────────────────────────────

class Finding(BaseModel):
    finding_id: str = Field(alias="findingId")
    error_type: str = Field(alias="errorType")
    severity: FindingSeverity
    stage: str
    message: str
    details: Optional[dict] = None
    recoverable: bool
    suggested_action: Optional[str] = Field(None, alias="suggestedAction")

    model_config = {"populate_by_name": True}


# ─── UnsupportedRequest ───────────────────────────────────────

class UnsupportedRequest(BaseModel):
    metric_name: str = Field(alias="metricName")
    reason: str
    required_periods: list[str] = Field(default_factory=list, alias="requiredPeriods")
    available_periods: list[str] = Field(default_factory=list, alias="availablePeriods")

    model_config = {"populate_by_name": True}


# ─── ChartDataSpec ────────────────────────────────────────────

class ChartDataSeries(BaseModel):
    name: str
    values: list[float]


class ChartDataSpec(BaseModel):
    chart_data_spec_id: str = Field(alias="chartDataSpecId")
    chart_type: str = Field(alias="chartType")
    categories: list[str]
    series: list[ChartDataSeries]
    metric_ids: list[str] = Field(alias="metricIds")

    model_config = {"populate_by_name": True}


# ─── EvidencePacket ───────────────────────────────────────────

class EvidencePacket(BaseModel):
    packet_id: str = Field(alias="packetId")
    job_id: str = Field(alias="jobId")
    workbook: dict  # {s3Uri, sha256}
    formula_plan_id: str = Field(alias="formulaPlanId")
    source_refs: list[SourceRef] = Field(alias="sourceRefs")
    metrics: list[MetricRecord]
    chart_data_specs: list[ChartDataSpec] = Field(alias="chartDataSpecs")
    validation_findings: list[Finding] = Field(alias="validationFindings")
    unsupported_requests: list[UnsupportedRequest] = Field(alias="unsupportedRequests")
    frozen: bool = False
    frozen_at: Optional[str] = Field(None, alias="frozenAt")
    canonical_sha256: Optional[str] = Field(None, alias="canonicalSha256")

    model_config = {"populate_by_name": True}

    def freeze(self) -> None:
        """Freeze the evidence packet and compute canonical hash."""
        if self.frozen:
            raise ValueError("EvidencePacket is already frozen")
        self.frozen = True
        self.frozen_at = datetime.utcnow().isoformat() + "Z"
        self.canonical_sha256 = self._compute_hash()

    def _compute_hash(self) -> str:
        """Compute canonical SHA-256 of the packet (deterministic serialization)."""
        data = self.model_dump(by_alias=True, exclude={"frozen_at", "canonical_sha256"})
        canonical = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ─── FormulaPlan ──────────────────────────────────────────────

class FormulaInput(BaseModel):
    field: str
    sheet: str
    entity: Optional[str] = None


class FormulaDefinitionModel(BaseModel):
    formula_id: str = Field(alias="formulaId")
    name: str
    definition: str
    inputs: list[FormulaInput]
    unit: str
    display_format: Optional[str] = Field(None, alias="displayFormat")
    supported: bool

    model_config = {"populate_by_name": True}


class UnsupportedFormula(BaseModel):
    name: str
    reason: str
    would_require: list[str] = Field(default_factory=list, alias="wouldRequire")

    model_config = {"populate_by_name": True}


class FormulaPlan(BaseModel):
    plan_id: str = Field(alias="planId")
    job_id: str = Field(alias="jobId")
    formulas: list[FormulaDefinitionModel]
    unsupported: list[UnsupportedFormula]
    assumptions: list[str]
    version: int
    status: FormulaPlanStatus

    model_config = {"populate_by_name": True}


# ─── Claim ────────────────────────────────────────────────────

class ExtractedNumber(BaseModel):
    value: float
    unit: str
    metric_id: str = Field(alias="metricId")

    model_config = {"populate_by_name": True}


class Claim(BaseModel):
    claim_id: str = Field(alias="claimId")
    claim_key: str = Field(alias="claimKey")
    source_role: SourceRole = Field(alias="sourceRole")
    statement: str
    extracted_numbers: list[ExtractedNumber] = Field(alias="extractedNumbers")
    evidence_ids: list[str] = Field(alias="evidenceIds", min_length=1)
    business_implication: Optional[str] = Field(None, alias="businessImplication")
    caveats: list[str] = Field(default_factory=list)
    counter_evidence: list[str] = Field(default_factory=list, alias="counterEvidence")
    direction: Optional[ClaimDirection] = None
    magnitude: Optional[ClaimMagnitude] = None
    status: ClaimStatus = ClaimStatus.pending
    rejection_reason: Optional[str] = Field(None, alias="rejectionReason")
    conflict_group_id: Optional[str] = Field(None, alias="conflictGroupId")

    model_config = {"populate_by_name": True}


# ─── ConflictGroup ────────────────────────────────────────────

class ConflictGroup(BaseModel):
    conflict_group_id: str = Field(alias="conflictGroupId")
    conflict_type: str = Field(alias="conflictType")
    claim_ids: list[str] = Field(alias="claimIds")
    description: str
    resolution: str  # "blocked" | "resolved"
    evidence_metric_id: Optional[str] = Field(None, alias="evidenceMetricId")
    correct_value: Optional[float] = Field(None, alias="correctValue")

    model_config = {"populate_by_name": True}


# ─── ClaimRegistry ────────────────────────────────────────────

class ClaimRegistry(BaseModel):
    packet_id: str = Field(alias="packetId")
    accepted: list[Claim]
    rejected: list[Claim]
    conflicts: list[ConflictGroup]

    model_config = {"populate_by_name": True}


# ─── WorkbookProfile ──────────────────────────────────────────

class DataQuality(BaseModel):
    null_count: int = Field(alias="nullCount")
    format_issues: list[str] = Field(default_factory=list, alias="formatIssues")

    model_config = {"populate_by_name": True}


class SheetProfile(BaseModel):
    sheet_name: str = Field(alias="sheetName")
    header_row: int = Field(alias="headerRow")
    data_start_row: int = Field(alias="dataStartRow")
    data_end_row: int = Field(alias="dataEndRow")
    columns: list[str]
    merged_cells: list[str] = Field(default_factory=list, alias="mergedCells")
    data_quality: DataQuality = Field(alias="dataQuality")

    model_config = {"populate_by_name": True}


class WorkbookProfile(BaseModel):
    profile_id: str = Field(alias="profileId")
    job_id: str = Field(alias="jobId")
    source_file_uri: str = Field(alias="sourceFileUri")
    source_file_hash: str = Field(alias="sourceFileHash")
    sheets: list[SheetProfile]
    detected_periods: list[str] = Field(alias="detectedPeriods")
    detected_entities: list[str] = Field(alias="detectedEntities")
    detected_units: dict[str, str] = Field(alias="detectedUnits")

    model_config = {"populate_by_name": True}


# ─── Job ──────────────────────────────────────────────────────

class ArtifactManifest(BaseModel):
    pptx_uri: Optional[str] = Field(None, alias="pptxUri")
    xlsx_uri: Optional[str] = Field(None, alias="xlsxUri")
    html_preview_uri: Optional[str] = Field(None, alias="htmlPreviewUri")

    model_config = {"populate_by_name": True}


class Job(BaseModel):
    job_id: str = Field(alias="jobId")
    tenant_id: str = Field(alias="tenantId")
    status: JobStatus
    current_stage: str = Field(alias="currentStage")
    input_s3_uri: str = Field(alias="inputS3Uri")
    user_request: str = Field(alias="userRequest")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    artifact_manifest: Optional[ArtifactManifest] = Field(None, alias="artifactManifest")
    error: Optional[dict] = None

    model_config = {"populate_by_name": True}
