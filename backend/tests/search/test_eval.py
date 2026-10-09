from app.search.eval import load_golden, mrr, p95, recall_at_k

HEADER = ("reel_url,what_i_remembered_it_as,my_category,my_2_line_summary,"
          "the_steps_or_info_i_actually_wanted,entities_that_matter\n")


def test_recall_at_k():
    ranked = [["a", "b"], ["c", "d"]]
    assert recall_at_k(ranked, ["b", "x"], 1) == 0.0
    assert recall_at_k(ranked, ["b", "x"], 2) == 0.5


def test_recall_empty():
    assert recall_at_k([], [], 5) == 0.0


def test_mrr():
    assert mrr([["a", "b"], ["c", "d"]], ["b", "x"]) == 0.25


def test_p95():
    assert p95([float(i) for i in range(1, 101)]) == 95.0
    assert p95([7.0]) == 7.0
    assert p95([]) == 0.0


def test_load_golden_skips_blank_rows(tmp_path):
    csv = tmp_path / "golden.csv"
    csv.write_text(
        HEADER
        + 'https://instagram.com/reel/EXAMPLE1,"github tricks reel",Dev & Tools,"s","x","e"\n'
        + "https://www.instagram.com/reel/EXAMPLE2/?igsh=abc,repo for job search,,,,\n"
        + "https://instagram.com/reel/EXAMPLE3,that momo cafe,,,,\n"
        + ",,,,,\n,,,,,\n", encoding="utf-8")
    assert load_golden(csv) == [("github tricks reel", "EXAMPLE1"),
                                ("repo for job search", "EXAMPLE2"),
                                ("that momo cafe", "EXAMPLE3")]
