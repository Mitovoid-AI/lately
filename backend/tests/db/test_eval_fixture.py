import pytest

from app.search.embed import FakeEmbedder
from app.search.eval import load_golden, run_eval
from tests.fixtures import CARDS, FIXTURES

pytestmark = pytest.mark.db

FIXTURE_CSV = FIXTURES / "golden-fixture.csv"


async def test_eval_fixture_recall_at_5_is_perfect(db):
    golden = load_golden(FIXTURE_CSV)
    assert len(golden) == 8
    report = await run_eval(db, golden, list(CARDS.values()), FakeEmbedder())
    assert report.recall5 == 1.0 and report.misses == []
    assert report.p95_ms > 0
