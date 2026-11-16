"""astro/src/resources/metricRegistry.ts is generated from the sdv-py metric registry (roadmap F13).

It must equal what the locked sportsdataverse renders, so a hand edit or a stale copy after a lock
bump fails here. Regenerate from python/:
    uv run python -m sportsdataverse.registry --ts --target gop > ../astro/src/resources/metricRegistry.ts
"""

from pathlib import Path

from sportsdataverse.registry import load_metric_registry, render_ts

GENERATED = (
    Path(__file__).parents[2] / "astro" / "src" / "resources" / "metricRegistry.ts"
)


def test_metric_registry_ts_matches_the_locked_sportsdataverse():
    committed = GENERATED.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert committed == render_ts(load_metric_registry(), target="gop")
