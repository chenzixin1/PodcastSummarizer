"""Video admission limits, independent of processing time and cost budgets."""
import math

MAX_VIDEO_DURATION_SECONDS = 6 * 60 * 60


def validate_video_duration(value: object) -> float:
    try:
        if isinstance(value, bool):
            raise ValueError()
        duration = float(value)
    except (TypeError, ValueError, OverflowError):
        raise RuntimeError("Unable to read a valid video duration; only completed videos are supported") from None
    if not math.isfinite(duration) or duration < 1:
        raise RuntimeError("Unable to read a valid video duration; it must be at least 1 second")
    if duration > MAX_VIDEO_DURATION_SECONDS:
        raise RuntimeError("Video exceeds the maximum supported duration of 6 hours")
    return duration
