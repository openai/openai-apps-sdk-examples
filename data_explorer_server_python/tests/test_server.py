from __future__ import annotations

import math
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from data_explorer_server_python import main
from data_explorer_server_python.schemas import ChartInput, PreviewInput


class DataExplorerServerTests(unittest.TestCase):
    def setUp(self) -> None:
        main.store.clear()

    def test_health_endpoint(self) -> None:
        from fastapi.testclient import TestClient

        client = TestClient(main.app)
        response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_widget_html_inlines_assets(self) -> None:
        html = main.WIDGET_HTML
        self.assertNotIn("http://localhost:4444", html)
        if main._WIDGET_SCRIPT is not None:
            self.assertIn(main.SCRIPT_URI, html)
        else:
            self.assertIn("<script", html)
        if main._WIDGET_STYLE is not None:
            self.assertIn(main.STYLE_URI, html)
        else:
            self.assertIn("<style", html)

    def test_preview_input_accepts_discriminated_union(self) -> None:
        payload = {
            "datasetId": "abc123",
            "filters": [
                {"type": "equals", "column": "city", "value": "SF"},
                {"type": "range", "column": "value", "min": 5, "max": 15},
            ],
        }

        model = PreviewInput.model_validate(payload)
        self.assertEqual(len(model.filters), 2)
        self.assertEqual(model.filters[0].type, "equals")
        self.assertEqual(model.filters[1].type, "range")

    def test_upload_preview_and_chart_flow(self) -> None:
        upload_response = main._handle_upload(
            {
                "datasetName": "Sample Cities",
                "csvText": "city,value\nSF,10\nNYC,20\nSF,12\nLA,8\n",
                "filename": "cities.csv",
            }
        )

        dataset_id = upload_response.dataset.dataset_id
        self.assertEqual(upload_response.dataset.row_count, 4)
        self.assertIn("city", upload_response.columns)
        self.assertIn("value", upload_response.columns)

        preview_response = main._handle_preview(
            {
                "datasetId": dataset_id,
                "limit": 10,
                "offset": 0,
                "filters": [{"type": "equals", "column": "city", "value": "SF"}],
            }
        )
        self.assertEqual(preview_response.total_rows, 2)
        self.assertTrue(all(row["city"] == "SF" for row in preview_response.rows))

        chart_payload = ChartInput.model_validate(
            {
                "datasetId": dataset_id,
                "config": {
                    "chartType": "bar",
                    "x": "city",
                    "aggregation": "count",
                },
                "filters": [],
            }
        )

        chart_response = main._handle_chart(chart_payload.model_dump(by_alias=True))
        self.assertEqual(chart_response["chartType"], "bar")
        categories = {
            item["category"]: item["value"] for item in chart_response["series"]
        }
        self.assertEqual(categories["SF"], 2)

        histogram_response = main._handle_chart(
            {
                "datasetId": dataset_id,
                "config": {
                    "chartType": "histogram",
                    "x": "value",
                    "binCount": 2,
                },
                "filters": [],
            }
        )
        self.assertEqual(histogram_response["chartType"], "histogram")
        total_counts = sum(bin_["count"] for bin_ in histogram_response["bins"])
        self.assertEqual(total_counts, 4)
        self.assertTrue(
            all(math.isfinite(bin_["binStart"]) for bin_ in histogram_response["bins"])
        )

    def test_chunked_upload_flow(self) -> None:
        init_response = main._handle_upload_init(
            {
                "datasetName": "Chunked Dataset",
                "filename": "chunked.csv",
                "hasHeader": True,
            }
        )
        upload_id = init_response.upload_id
        status = main._handle_upload_chunk(
            {
                "uploadId": upload_id,
                "chunkText": "city,value\nSF,10\nNYC",
                "isFinal": False,
                "chunkIndex": 0,
            }
        )
        self.assertFalse(status["isFinalized"])
        self.assertGreater(status["receivedBytes"], 0)

        final = main._handle_upload_chunk(
            {
                "uploadId": upload_id,
                "chunkText": ",20\nLA,8\n",
                "isFinal": True,
                "chunkIndex": 1,
            }
        )
        self.assertTrue(final["isFinalized"])
        self.assertEqual(final["dataset"]["datasetName"], "Chunked Dataset")
        self.assertEqual(final["dataset"]["rowCount"], 3)

    def test_chunked_upload_ignores_future_fields(self) -> None:
        init_response = main._handle_upload_init(
            {
                "datasetName": "Future Fields",
                "filename": "chunked.csv",
                "hasHeader": True,
                "chunkSize": 1234,
                "someNewField": "value",
            }
        )
        status = main._handle_upload_chunk(
            {
                "uploadId": init_response.upload_id,
                "chunkText": "city,value\nSF,10\n",
                "isFinal": True,
                "chunkIndex": 0,
                "newFlag": True,
            }
        )
        self.assertTrue(status["isFinalized"])
        self.assertEqual(status["dataset"]["datasetName"], "Future Fields")

    def test_upload_via_file_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = Path(tmpdir) / "cities.csv"
            csv_path.write_text("city,value\nSF,10\nNYC,20\n", encoding="utf-8")

            original_roots = main._ALLOWED_UPLOAD_ROOTS
            main._ALLOWED_UPLOAD_ROOTS = (Path(tmpdir).resolve(),)
            try:
                upload_response = main._handle_upload(
                    {
                        "datasetName": "Path Upload",
                        "filePath": str(csv_path),
                    }
                )
            finally:
                main._ALLOWED_UPLOAD_ROOTS = original_roots

            self.assertEqual(upload_response.dataset.dataset_name, "Path Upload")
            self.assertEqual(upload_response.dataset.filename, "cities.csv")
            self.assertEqual(upload_response.dataset.row_count, 2)

    def test_upload_via_file_path_rejected_without_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = Path(tmpdir) / "cities.csv"
            csv_path.write_text("city,value\nSF,10\nNYC,20\n", encoding="utf-8")

            original_roots = main._ALLOWED_UPLOAD_ROOTS
            main._ALLOWED_UPLOAD_ROOTS = ()

            try:
                with self.assertRaises(HTTPException):
                    main._handle_upload(
                        {
                            "datasetName": "Blocked Path",
                            "filePath": str(csv_path),
                        }
                    )
            finally:
                main._ALLOWED_UPLOAD_ROOTS = original_roots


if __name__ == "__main__":
    unittest.main()
