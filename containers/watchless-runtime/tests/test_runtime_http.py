import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
HAS_RUNTIME = all(importlib.util.find_spec(name) for name in ("fastapi", "reportlab", "httpx"))


@unittest.skipUnless(HAS_RUNTIME, "Run HTTP tests inside the built runtime image")
class RuntimeHttpTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        import app
        self.runtime = app
        self.runtime.states.clear()
        self.client = TestClient(app.app)
        self.secret = patch.dict(os.environ, {"WATCHLESS_INTERNAL_SECRET": "unit-test-secret"})
        self.secret.start()

    def tearDown(self):
        self.secret.stop()
        self.client.close()

    def test_health(self):
        self.assertEqual(self.client.get("/ping").json(), {"ok": True})

    def test_anonymous_and_wrong_secret_cannot_start_work(self):
        for headers in ({}, {"x-runtime-secret": "wrong"}):
            self.assertEqual(self.client.post("/jobs", json={"jobId": "test-job"}, headers=headers).status_code, 403)
        self.assertEqual(self.runtime.states, {})

    def test_authorized_request_schedules_only_the_requested_job(self):
        with patch.object(self.runtime, "process", new=AsyncMock()) as process:
            response = self.client.post("/jobs", json={"jobId": "test-job"}, headers={"x-runtime-secret": "unit-test-secret"})
            self.assertEqual(response.status_code, 202)
            process.assert_awaited_once_with("test-job")

    def test_running_job_replay_does_not_schedule_twice(self):
        self.runtime.states["test-job"] = {"status": "running"}
        with patch.object(self.runtime, "process", new=AsyncMock()) as process:
            self.assertEqual(self.client.post("/jobs", json={"jobId": "test-job"}, headers={"x-runtime-secret": "unit-test-secret"}).status_code, 202)
            process.assert_not_awaited()

    def test_job_status_requires_secret_and_unknown_job_is_404(self):
        self.assertEqual(self.client.get("/jobs/test-job").status_code, 403)
        self.assertEqual(self.client.get("/jobs/test-job", headers={"x-runtime-secret": "unit-test-secret"}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
