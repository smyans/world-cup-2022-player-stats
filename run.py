"""Build the player-match dataset, run the correlation analysis and draw the charts.

    python run.py
"""

from pathlib import Path

from worldcup_stats.analysis import correlate_with_result, winners_vs_losers
from worldcup_stats.data import load_all
from worldcup_stats.features import build_player_match_table
from worldcup_stats.plots import correlation_heatmap, top_metrics_bars

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
FIGURES = ROOT / "figures"


def main():
    RESULTS.mkdir(exist_ok=True)
    FIGURES.mkdir(exist_ok=True)

    load_all()
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


if __name__ == "__main__":
    main()
