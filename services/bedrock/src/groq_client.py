"""
groq_client.py - Groq API client (OpenAI-compatible).
Free tier, ultra-fast inference. Drop-in replacement for Bedrock/Ollama.
"""
import hashlib
import json
import subprocess
from dataclasses import dataclass
from typing import Any, Optional

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.1-8b-instant"


@dataclass
class ConverseRequest:
    """Request (same interface as other clients)."""
    system_prompt: str
    user_message: str
    output_schema: dict[str, Any]
    model_id: str = DEFAULT_MODEL
    max_tokens: int = 4096
    temperature: float = 0.1


@dataclass
class ConverseResponse:
    """Response (same interface as other clients)."""
    raw_response: dict[str, Any]
    parsed_output: dict[str, Any]
    stop_reason: str
    prompt_hash: str
    model_id: str
    repair_attempted: bool = False
    input_tokens: int = 0
    output_tokens: int = 0


class GroqClient:
    """
    Groq API client - drop-in replacement for BedrockConverseClient.
    Uses curl subprocess to avoid Cloudflare blocking urllib.
    """

    def __init__(self, api_key: str, model: str = DEFAULT_MODEL):
        self.api_key = api_key
        self.model = model

    def invoke(self, request: ConverseRequest) -> ConverseResponse:
        """Invoke Groq with structured output attempt."""
        prompt_hash = self._compute_prompt_hash(request)

        # Build messages asking for JSON output
        schema_str = json.dumps(request.output_schema, ensure_ascii=False, indent=2)
        user_msg = (
            f"{request.user_message}\n\n"
            f"IMPORTANT: Respond ONLY with valid JSON matching this schema:\n"
            f"```json\n{schema_str}\n```\n"
            f"Output ONLY the JSON object, no markdown, no explanation."
        )

        # First attempt
        raw = self._call_groq(request.system_prompt, user_msg, request.temperature, request.max_tokens)
        text = raw.get("choices", [{}])[0].get("message", {}).get("content", "")
        parsed, valid = self._parse_json(text)

        if valid:
            usage = raw.get("usage", {})
            return ConverseResponse(
                raw_response=raw,
                parsed_output=parsed,
                stop_reason="stop",
                prompt_hash=prompt_hash,
                model_id=self.model,
                repair_attempted=False,
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
            )

        # Repair attempt
        repair_msg = (
            f"Your previous response was not valid JSON. "
            f"Output ONLY a valid JSON object matching this schema:\n"
            f"```json\n{schema_str}\n```\n"
            f"No other text. Just the JSON."
        )
        raw = self._call_groq(request.system_prompt, repair_msg, 0.0, request.max_tokens)
        text = raw.get("choices", [{}])[0].get("message", {}).get("content", "")
        parsed, valid = self._parse_json(text)
        if not valid:
            parsed = parsed or {"claims": []}

        usage = raw.get("usage", {})
        return ConverseResponse(
            raw_response=raw,
            parsed_output=parsed,
            stop_reason="stop",
            prompt_hash=prompt_hash,
            model_id=self.model,
            repair_attempted=True,
            input_tokens=usage.get("prompt_tokens", 0),
            output_tokens=usage.get("completion_tokens", 0),
        )

    def _call_groq(self, system: str, user_msg: str, temperature: float, max_tokens: int) -> dict:
        """Call Groq API via curl (avoids Cloudflare blocking)."""
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        result = subprocess.run(
            [
                "curl", "-s", "-m", "120",
                "-H", f"Authorization: Bearer {self.api_key}",
                "-H", "Content-Type: application/json",
                "-d", json.dumps(payload, ensure_ascii=False),
                GROQ_API_URL,
            ],
            capture_output=True,
            text=True,
            timeout=150,
        )

        if result.returncode != 0:
            raise ConnectionError(f"Groq API call failed: {result.stderr}")

        return json.loads(result.stdout)

    def _parse_json(self, text: str) -> tuple[Optional[dict[str, Any]], bool]:
        """Try to parse JSON from response text."""
        text = text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            json_lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(json_lines).strip()

        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed, True
        except json.JSONDecodeError:
            pass

        # Find JSON in text
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
