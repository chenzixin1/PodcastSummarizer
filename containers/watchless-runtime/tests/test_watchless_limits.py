import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from watchless_limits import validate_video_duration


class VideoDurationTests(unittest.TestCase):
    def test_inclusive_six_hour_limit(self):
        for value in (1, 7200, 7201, 21599, 21600, "21600"):
            with self.subTest(value=value):
                self.assertEqual(validate_video_duration(value), float(value))

    def test_over_limit(self):
        for value in (21600.01, 21601, 86400):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "6 hours"):
                validate_video_duration(value)

    def test_missing_or_invalid_is_not_reported_as_too_long(self):
        for value in (None, "", "unknown", 0, -1, .5, True, float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "valid video duration"):
                validate_video_duration(value)


if __name__ == "__main__":
    unittest.main()
