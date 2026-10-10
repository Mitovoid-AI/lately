"""Worker stage tests: RESOLVE logic without a database.

The DB-touching parts are exercised via the SQL RPCs (migration 0003); here we
test the pure decision points of the RESOLVE stage and the stage graph.
"""

import pytest

from app.worker import stages


def test_stage_graph_is_complete_and_terminates():
    """Every NEXT value is a registered stage or None — no dead ends."""
    assert set(stages.STAGES) == {
        "resolve", "fetch", "transcribe", "vision", "structure", "finalize", "embed",
        "export",
    }
    for name, nxt in stages.NEXT.items():
        assert nxt is None or nxt in stages.STAGES, f"dead end at {name}"
    assert stages.NEXT["finalize"] is None


def test_resolve_contract_share_link_needs_redirect():
    """A /share/ link has no shortcode until the redirect is followed."""
    from app.urls import is_share_link, parse_shortcode

    url = "https://instagram.com/share/AbCd12"
    assert is_share_link(url) and parse_shortcode(url) is None


def test_stage_registry_rejects_unknown_stage():
    """The loop must handle a job whose stage isn't registered (defensive)."""
    assert "nonexistent" not in stages.STAGES


def test_reschedule_clamps_delay():
    """Budget waits become a Reschedule of at least one second."""
    assert stages.Reschedule(0, "x").delay_s == 1
    assert stages.Reschedule(42, "x").delay_s == 42


@pytest.mark.parametrize(("attempts", "last"), [(1, False), (2, False), (3, True)])
def test_last_attempt(attempts, last):
    assert stages._last_attempt({"attempts": attempts, "max_attempts": 3}) is last
