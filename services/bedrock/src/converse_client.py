"""
converse_client.py - Unified Bedrock Converse API client.
Supports Structured Outputs with one repair attempt.
Uses Claude 3 Haiku for cost efficiency during hackathon.
"""
import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import boto3
from botocore.config import Config

# Use Claude 3 Haiku - most cost-effective option available
DEFAULT_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"


@dataclass
class ConverseRequest:
    """Request to Bedrock Converse API."""
    system_prompt: str
    user_message: str
    output_schema: dict[str, Any]  # JSON Schema for structured output
    model_id: str = DEFAULT_MODEL_ID
    max_tokens: int = 4096
    temperature: float = 0.1


@dataclass
class ConverseResponse:
    """Response from Bedrock Converse API."""
    raw_response: dict[str, Any]
    parsed_output: dict[str, Any]
    stop_reason: str
    prompt_hash: str
    model_id: str
    repair_attempted: bool = False
    input_tokens: int = 0
    output_tokens: int = 0


class BedrockConverseClient:
    """
    Unified client for Bedrock Converse API with structured output support.
    Implements one-repair strategy: if output doesn't match schema, try once more.
    """

    def __init__(
        self,
        region: str = "us-east-1",
        model_id: str = DEFAULT_MODEL_ID,
    ):
        self.model_id = model_id
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(
                retries={"max_attempts": 2, "mode": "adaptive"},
                read_timeout=120,
            ),
        )

    def invoke(self, request: ConverseRequest) -> ConverseResponse:
        """
        Invoke Bedrock Converse with structured output.
        Attempts one repair if initial response doesn't match schema.
        """
        prompt_hash = self._compute_prompt_hash(request)
        
        # First attempt
        raw_response = self._call_converse(request)
        parsed, valid = self._parse_and_validate(raw_response, request.output_schema)
        
        if valid:
            return self._build_response(raw_response, parsed, prompt_hash, request.model_id, repair=False)
        
        # One repair attempt
        repair_request = ConverseRequest(
            system_prompt=request.system_prompt,
            user_message=self._build_repair_message(request.user_message, raw_response, request.output_schema),
            output_schema=request.output_schema,
            model_id=request.model_id,
            max_tokens=request.max_tokens,
            temperature=0.0,  # Lower temperature for repair
        )
        
        raw_response = self._call_converse(repair_request)
        parsed, valid = self._parse_and_validate(raw_response, request.output_schema)
        
        if not valid:
            # Return best-effort result even if repair fails
            parsed = parsed or {}
        
        return self._build_response(raw_response, parsed, prompt_hash, request.model_id, repair=True)

    def _call_converse(self, request: ConverseRequest) -> dict[str, Any]:
        """Call the Bedrock Converse API."""
        messages = [
            {
                "role": "user",
                "content": [{"text": request.user_message}],
            }
        ]

        kwargs: dict[str, Any] = {
            "modelId": request.model_id,
            "messages": messages,
            "system": [{"text": request.system_prompt}],
            "inferenceConfig": {
                "maxTokens": request.max_tokens,
                "temperature": request.temperature,
            },
        }

        response = self.client.converse(**kwargs)
        return response

    def _parse_and_validate(
        self, response: dict[str, Any], schema: dict[str, Any]
    ) -> tuple[Optional[dict[str, Any]], bool]:
        """Parse response content and validate against schema."""
        try:
            # Extract text content
            output = response.get("output", {})
            message = output.get("message", {})
            content = message.get("content", [])
            
            text = ""
            for block in content:
                if "text" in block:
                    text = block["text"]
                    break
            
            if not text:
                return None, False

            # Try to parse as JSON
            # Handle cases where model wraps JSON in markdown code blocks
            json_text = text.strip()
            if json_text.startswith("```"):
                lines = json_text.split("\n")
                json_lines = [l for l in lines if not l.strip().startswith("```")]
                json_text = "\n".join(json_lines)

            parsed = json.loads(json_text)
            
            # Basic schema validation (check required fields)
            if not isinstance(parsed, dict):
                return None, False
            
            required = schema.get("required", [])
            for field_name in required:
                if field_name not in parsed:
                    return parsed, False

            return parsed, True

        except (json.JSONDecodeError, KeyError, TypeError):
            return None, False

    def _build_repair_message(
        self, original_message: str, failed_response: dict[str, Any], schema: dict[str, Any]
    ) -> str:
        """Build a repair prompt asking the model to fix its output."""
        schema_str = json.dumps(schema, ensure_ascii=False, indent=2)
        return (
            f"{original_message}\n\n"
            f"IMPORTANT: Your previous response did not match the required JSON schema. "
            f"Please output ONLY valid JSON matching this schema exactly:\n"
            f"```json\n{schema_str}\n```\n"
            f"Output ONLY the JSON, no other text."
        )

    def _build_response(
        self,
        raw: dict[str, Any],
        parsed: dict[str, Any],
        prompt_hash: str,
        model_id: str,
        repair: bool,
    ) -> ConverseResponse:
        """Build a ConverseResponse from raw API response."""
        stop_reason = raw.get("stopReason", "unknown")
        usage = raw.get("usage", {})
        
        return ConverseResponse(
            raw_response=raw,
            parsed_output=parsed,
            stop_reason=stop_reason,
            prompt_hash=prompt_hash,
            model_id=model_id,
            repair_attempted=repair,
            input_tokens=usage.get("inputTokens", 0),
            output_tokens=usage.get("outputTokens", 0),
        )

    def _compute_prompt_hash(self, request: ConverseRequest) -> str:
        """Compute hash of the prompt for audit trail."""
        content = f"{request.system_prompt}|{request.user_message}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]
