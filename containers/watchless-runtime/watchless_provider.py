"""Explicit transports for OpenRouter, Cloudflare Responses and native Workers AI."""
import os
import re


def model_request(model, prompt, schema, name, max_tokens, env=None):
    env = os.environ if env is None else env
    provider = env.get("WATCHLESS_AI_PROVIDER") or "openrouter"
    if provider not in {"openrouter", "cloudflare"}:
        raise RuntimeError("Invalid WATCHLESS_AI_PROVIDER")
    if provider == "openrouter":
        key = env.get("OPENROUTER_API_KEY")
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY is not configured")
        return provider, "https://openrouter.ai/api/v1/chat/completions", {
            "authorization": f"Bearer {key}", "content-type": "application/json",
        }, {"model": model, "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
            "max_tokens": max_tokens, "provider": {"require_parameters": True}}
    account = env.get("WATCHLESS_CF_ACCOUNT_ID", "")
    if not re.fullmatch(r"[a-f0-9]{32}", account):
        raise RuntimeError("WATCHLESS_CF_ACCOUNT_ID is invalid")
    key = env.get("WATCHLESS_CF_API_TOKEN")
    if not key:
        raise RuntimeError("WATCHLESS_CF_API_TOKEN is not configured")
    headers = {"authorization": f"Bearer {key}", "content-type": "application/json",
               "cf-aig-collect-log": "false", "cf-aig-max-attempts": "1"}
    if env.get("WATCHLESS_CF_GATEWAY_ID"):
        headers["cf-aig-gateway-id"] = env["WATCHLESS_CF_GATEWAY_ID"]
    if model == "@cf/zai-org/glm-5.3-flash":
        return provider, f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}", headers, {
            "messages": [{"role": "user", "content": prompt}], "max_completion_tokens": max_tokens,
            "temperature": 0, "chat_template_kwargs": {"enable_thinking": False},
            "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}},
        }
    return provider, f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/responses", headers, {
        "model": model, "input": [{"role": "user", "content": prompt}], "max_output_tokens": max_tokens,
        "store": False, "text": {"format": {"type": "json_schema", "name": name, "strict": True, "schema": schema}},
    }


def model_text(body, provider):
    if provider == "cloudflare" and "result" in body:
        if body.get("success") is False or body.get("errors"):
            raise RuntimeError("Cloudflare model request failed")
        return model_text(body["result"], "chat")
    if provider == "cloudflare":
        if body.get("status") != "completed" or body.get("error"):
            raise RuntimeError("Cloudflare model response incomplete or failed")
        text = "".join(part.get("text", "") for item in body.get("output", []) if item.get("type") == "message"
                       for part in item.get("content", []) if part.get("type") == "output_text")
    else:
        choice = body["choices"][0]
        if choice.get("finish_reason") == "length":
            raise RuntimeError("Model response truncated")
        text = choice["message"].get("content", "")
    if not text.strip():
        raise RuntimeError("Model returned no text")
    return text
