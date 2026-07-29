"""
ollama_client.py - Local Ollama client as Bedrock fallback.
Uses the same interface as converse_client.py so it's a drop-in replacement.
Ollama runs locally, no API key needed, completely free.
"""
import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Optional
from urllib.request import urlopen, Request
from urllib.error import URLError

OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "llama3.1:8b"


@dataclass
class ConverseRequest:
    """Request (same interface as Bedrock converse_client)."""
    system_prompt: str
    user_message: str
    output_schema: dict[str, Any]
    model_id: str = DEFAULT_MODEL
    max_tokens: int = 4096
    temperature: float = 0.1


@dataclass
class ConverseResponse:
    """Response (same interface as Bedrock converse_client)."""
    raw_response: dict[str, Any]
    parsed_output: dict[str, Any]
    stop_reason: str
    prompt_hash: str
    model_id: str
    repair_attempted: bool = False
    input_tokens: int = 0
    output_tokens: int = 0


class OllamaClient:
    """
    Local Ollama client - drop-in replacement for BedrockConverseClient.
    Requires: ollama running locally (ollama serve)
    """

    def __init__(self, model: str = DEFAULT_MODEL, base_url: str = OLLAMA_BASE_URL):
        self.model = model
        self.base_url = base_url

    def invoke(self, request: ConverseRequest) -> ConverseResponse:
        """Invoke Ollama with structured output attempt."""
        prompt_hash = self._compute_prompt_hash(request)

        # Build prompt that asks for JSON output
        schema_str = json.dumps(request.output_schema, ensure_ascii=False, indent=2)
        full_prompt = (
            f"{request.user_message}\n\n"
            f"IMPORTANT: Respond ONLY with valid JSON matching this schema:\n"
            f"```json\n{schema_str}\n```\n"
            f"Output ONLY the JSON, no other text."
        )

        # Call Ollama
        raw_response = self._call_ollama(
            system=request.system_prompt,
            prompt=full_prompt,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )

        # Parse response
        text = raw_response.get("response", "")
        parsed, valid = self._parse_json(text)

        if not valid:
            # One repair attempt
            repair_prompt = (
                f"Your previous response was not valid JSON. "
                f"Please output ONLY valid JSON matching this schema:\n"
                f"```json\n{schema_str}\n```\n"
                f"Previous response: {text[:500]}\n"
                f"Fix it and output ONLY the JSON."
            )
            raw_response = self._call_ollama(
                system=request.system_prompt,
                prompt=repair_prompt,
                temperature=0.0,
                max_tokens=request.max_tokens,
            )
            text = raw_response.get("response", "")
            parsed, valid = self._parse_json(text)
            if not valid:
                parsed = parsed or {"claims": []}

            return ConverseResponse(
                raw_response=raw_response,
                parsed_output=parsed,
                stop_reason="stop",
                prompt_hash=prompt_hash,
                model_id=self.model,
                repair_attempted=True,
            )

        return ConverseResponse(
            raw_response=raw_response,
            parsed_output=parsed,
            stop_reason="stop",
            prompt_hash=prompt_hash,
            model_id=self.model,
            repair_attempted=False,
        )

    def _call_ollama(
        self, system: str, prompt: str, temperature: float, max_tokens: int
    ) -> dict[str, Any]:
        """Call Ollama HTTP API."""
        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": system,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        data = json.dumps(payload).encode("utf-8")
        req = Request(
            f"{self.base_url}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except URLError as e:
            raise ConnectionError(
                f"Cannot connect to Ollama at {self.base_url}. "
                f"Make sure Ollama is running: ollama serve\n"
                f"Error: {e}"
            )

    def _parse_json(self, text: str) -> tuple[Optional[dict[str, Any]], bool]:
        """Try to parse JSON from response text."""
        text = text.strip()

        # Remove markdown code blocks if present
        if text.startswith("```"):
            lines = text.split("\n")
            json_lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(json_lines).strip()

        # Try direct parse
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed, True
        except json.JSONDecodeError:
            pass

        # Try to find JSON in text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start:end])
                if isinstance(parsed, dict):
                    return parsed, True
            except json.JSONDecodeError:
                pass

        return None, False

    def _compute_prompt_hash(self, request: ConverseRequest) -> str:
        content = f"{request.system_prompt}|{request.user_message}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]


def is_ollama_available(base_url: str = OLLAMA_BASE_URL) -> bool:
    """Check if Ollama is running locally."""
    try:
        req = Request(f"{base_url}/api/tags", method="GET")
        with urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except Exception:
        return False
