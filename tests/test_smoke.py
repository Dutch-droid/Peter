import tempfile
from pathlib import Path

import pandas as pd

from prodmgr import schema
from prodmgr.analysis import analyse
from prodmgr.exporters import export_all
from prodmgr.mockdata import AS_OF, generate, write_mock
from prodmgr.report_pdf import build_pdf


def test_mock_validates_clean():
    _, problems = schema.validate(generate())
    assert problems == []


def test_templates_load_and_validate():
    with tempfile.TemporaryDirectory() as d:
        schema.write_templates(d)
        _, problems = schema.validate(schema.load(d))
        assert problems == []


def test_validation_catches_bad_input():
    t = generate()
    t["tasks"].loc[0, "status"] = "Bogus"
    _, problems = schema.validate(t)
    assert any("status" in p for p in problems)


def test_pipeline_outputs_and_consistency():
    with tempfile.TemporaryDirectory() as d:
        write_mock(Path(d) / "in")
        tables, problems = schema.validate(schema.load(Path(d) / "in"))
        assert problems == []
        res = analyse(tables, AS_OF)
        paths = export_all(res, Path(d) / "out")
        build_pdf(res, Path(d) / "out" / "report.pdf")
        assert (Path(d) / "out" / "report.pdf").stat().st_size > 10_000
        xl = pd.read_excel(paths["xlsx"], sheet_name="prioritised_tasks")
        csv = pd.read_csv(Path(d) / "out" / "csv" / "prioritised_tasks.csv")
        assert len(xl) == len(csv) == res["summary"]["open_cases"]
        assert sum(res["summary"]["priority_counts"].values()) == res["summary"]["open_cases"]
        # low-confidence items must be flagged for human review
        b = res["tables"]["bottlenecks"]
        assert ((b.confidence < 0.85) == (b.human_review_required == "Yes")).all()
