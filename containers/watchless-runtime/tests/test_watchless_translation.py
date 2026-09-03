from __future__ import annotations

import sys
import unittest
from pathlib import Path


RUNTIME_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_DIR))

from watchless_translation import translated_markdown, translation_batches, validate_translation_batch  # noqa: E402


class WatchlessTranslationTests(unittest.TestCase):
    def test_translation_batch_requires_exact_source_ids(self) -> None:
        result = {
            "translations": [
                {"id": 4, "textZh": "第一句。"},
                {"id": 5, "textZh": "第二句。"},
            ]
        }
        self.assertEqual(validate_translation_batch(result, [4, 5]), {4: "第一句。", 5: "第二句。"})

        with self.assertRaisesRegex(RuntimeError, r"missing=\[5\]"):
            validate_translation_batch({"translations": [{"id": 4, "textZh": "第一句。"}]}, [4, 5])

        with self.assertRaisesRegex(RuntimeError, "repeats utterance 4"):
            validate_translation_batch(
                {"translations": [{"id": 4, "textZh": "第一句。"}, {"id": 4, "textZh": "重复。"}]},
                [4],
            )

    def test_translation_batching_never_drops_an_utterance(self) -> None:
        utterances = [
            {"translationId": index, "text": "x" * length}
            for index, length in enumerate([5, 6, 7, 8, 9])
        ]
        batches = translation_batches(utterances, max_items=2, max_chars=12)
        self.assertEqual(
            [item["translationId"] for batch in batches for item in batch],
            [0, 1, 2, 3, 4],
        )
        self.assertTrue(all(len(batch) <= 2 for batch in batches))

    def test_translated_markdown_keeps_speaker_turns_and_order(self) -> None:
        utterances = [
            {"translationId": 0, "speaker": "0"},
            {"translationId": 1, "speaker": "0"},
            {"translationId": 2, "speaker": "1"},
        ]
        translations = {0: "你好。", 1: "今天怎么样？", 2: "很好。"}
        markdown = translated_markdown(
            utterances,
            lambda item: "Ti Morse" if item["speaker"] == "0" else "Sam Altman",
            translations,
        )
        self.assertEqual(
            markdown,
            "**Ti Morse：** 你好。 今天怎么样？\n\n**Sam Altman：** 很好。",
        )


if __name__ == "__main__":
    unittest.main()
