"""Build the datasets, run the analyses, draw the charts and export data for the website.

    python run.py
"""

from pathlib import Path

from worldcup_stats.analysis import correlate_with_result, winners_vs_losers
from worldcup_stats.data import load_all, load_events
from worldcup_stats.export import write_site_data
from worldcup_stats.features import build_player_match_table
from worldcup_stats.model import evaluate
from worldcup_stats.pitch import load_shots, touch_share_grid
from worldcup_stats.plots import (
    correlation_heatmap,
    model_coefficients,
    shot_map,
    top_metrics_bars,
    touch_difference_map,
)

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
FIGURES = ROOT / "figures"
SITE_DATA = ROOT / "docs" / "data" / "site.json"


def main():
    RESULTS.mkdir(exist_ok=True)
    FIGURES.mkdir(exist_ok=True)

    matches = load_all()
    n_events = sum(len(load_events(match_id)) for match_id in matches["match_id"])

    # Player-level correlations
    table = build_player_match_table()
    table.round(3).to_csv(RESULTS / "player_match_stats.csv", index=False)
    print(f"Built {len(table)} player-match rows from {table['match_id'].nunique()} matches.")

    corr = correlate_with_result(table)
    corr.round(4).to_csv(RESULTS / "correlations.csv", index=False)
    winners_vs_losers(table).to_csv(RESULTS / "winners_vs_losers_medians.csv")
    correlation_heatmap(corr, FIGURES / "correlation_heatmap.png")
    top_metrics_bars(corr, FIGURES / "top_metrics_by_position.png")

    for group, sub in corr.groupby("position_group"):
        hits = sub[sub["significant"]].sort_values("rho", ascending=False)
        found = ", ".join(f"{m} ({r:+.2f})" for m, r in zip(hits["metric"], hits["rho"])) or "none"
        print(f"{group}: significant metrics -> {found}")

    # Pitch views
    shots = load_shots()
    shots.to_csv(RESULTS / "shots.csv", index=False)
    touch_grids = touch_share_grid()
    shot_map(shots, FIGURES / "shot_map.png")
    touch_difference_map(*touch_grids, FIGURES / "touch_difference.png")

    # Team-level win model
    scores, coefficients, predictions = evaluate()
    scores.round(3).to_csv(RESULTS / "model_scores.csv", index=False)
    coefficients.round(3).to_csv(RESULTS / "model_coefficients.csv", index=False)
    predictions.round(3).to_csv(RESULTS / "model_predictions.csv", index=False)
    model_coefficients(coefficients, FIGURES / "model_coefficients.png")
    print(scores.round(3).to_string(index=False))

    write_site_data(SITE_DATA, table, corr, shots, touch_grids, (scores, coefficients, predictions), n_events)
    print(f"Wrote {SITE_DATA.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
