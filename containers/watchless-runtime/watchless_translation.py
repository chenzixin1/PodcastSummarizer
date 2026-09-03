from __future__ import annotations

from typing import Any, Callable


def translated_markdown(
    utterances: list[dict[str, Any]],
    display_speaker: Callable[[dict[str, Any]], str],
    translations: dict[int, str],
) -> str:
    """Render faithful translations while preserving source turn order and speaker boundaries."""
    turns: list[dict[str, str]] = []
    for item in utterances:
        translation_id = int(item["translationId"])
        text = translations.get(translation_id, "").strip()
        if not text:
            raise RuntimeError(f"Chinese translation is missing utterance {translation_id}")
        speaker = str(display_speaker(item)).strip()
        if turns and turns[-1]["speaker"] == speaker:
            turns[-1]["text"] += f" {text}"
        else:
            turns.append({"speaker": speaker, "text": text})
    return "\n\n".join(f"**{turn['speaker']}：** {turn['text']}" for turn in turns)


def translation_batches(
    utterances: list[dict[str, Any]],
    max_items: int = 220,
    max_chars: int = 32000,
) -> list[list[dict[str, Any]]]:
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0
    for item in utterances:
        item_chars = len(str(item.get("text") or ""))
        if current and (len(current) >= max_items or current_chars + item_chars > max_chars):
            batches.append(current)
            current = []
            current_chars = 0
        current.append(item)
        current_chars += item_chars
    if current:
        batches.append(current)
    return batches


def validate_translation_batch(result: dict[str, Any], expected_ids: list[int]) -> dict[int, str]:
    rows = result.get("translations") if isinstance(result, dict) else None
    if not isinstance(rows, list):
        raise RuntimeError("Chinese translation response is missing translations")
    translations: dict[int, str] = {}
    for row in rows:
        if not isinstance(row, dict) or isinstance(row.get("id"), bool) or not isinstance(row.get("id"), int):
            raise RuntimeError("Chinese translation response contains an invalid utterance id")
        translation_id = int(row["id"])
        text = str(row.get("textZh") or "").strip()
        if translation_id in translations:
            raise RuntimeError(f"Chinese translation repeats utterance {translation_id}")
        if not text or len(text) > 120000:
            raise RuntimeError(f"Chinese translation is invalid for utterance {translation_id}")
        translations[translation_id] = text
    if set(translations) != set(expected_ids):
        missing = sorted(set(expected_ids) - set(translations))
        unexpected = sorted(set(translations) - set(expected_ids))
        raise RuntimeError(f"Chinese translation ids do not match source; missing={missing[:8]}, unexpected={unexpected[:8]}")
    return translations
