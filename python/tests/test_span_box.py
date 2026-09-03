import polars as pl

import span_box


def frame():
    return pl.DataFrame(
        {
            "period": [1, 2, 3, 4, 5],
            "start.adj_TimeSecsRem": [3000.0, 2000.0, 1200.0, 400.0, 0.0],
        }
    )


def rows(expr):
    return frame().filter(expr)["period"].to_list()


def test_named_spans():
    assert rows(span_box.parse_span("q3")[1]) == [3]
    assert rows(span_box.parse_span("H1")[1]) == [1, 2]
    assert rows(span_box.parse_span("ot")[1]) == [5]


def test_clock_span_buckets_and_regulation_only():
    key, expr = span_box.parse_span("1807-393")
    assert key == "1800-390"
    assert rows(expr) == [3, 4]  # 1200 and 400 in [390,1800]; OT excluded; 2000 above


def test_invalid_spans():
    for bad in (None, "", "banana", "900-1800", "42"):
        assert span_box.parse_span(bad) is None


def test_spanned_box_falls_back_when_empty_or_invalid():
    class G:
        plays_json = frame()

        def create_box_score(self, df):
            return {"n": df.height}

    g = G()
    assert span_box.spanned_box(g, "q2") == ({"n": 1}, "q2")
    assert span_box.spanned_box(g, "nope") == (None, None)
    g.plays_json = frame().filter(pl.col("period") > 90)
    assert span_box.spanned_box(g, "q2") == (None, None)
