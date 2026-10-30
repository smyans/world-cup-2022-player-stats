"""Write the compact JSON the interactive site (docs/) reads."""

import json

import numpy as np

from .features import POSITION_GROUPS
from .plots import LABELS

RESULT_NAMES = {0.0: "loss", 0.5: "draw", 1.0: "win"}


def _distributions(table):
    """Five-number summaries (10/25/50/75/90th pct) of each metric by group and result."""
    out = {}
    for group in POSITION_GROUPS:
        subset = table[table["position_group"] == group]
        out[group] = {
            metric: {
                RESULT_NAMES[result]: np.nanpercentile(rows[metric], [10, 25, 50, 75, 90]).round(3).tolist()
                for result, rows in subset.groupby("team_result")
            }
            for metric in LABELS
        }
    return out


def _model_payload(scores, coefficients, predictions):
    decisive = predictions[predictions["result"] == 1.0]
    draws = predictions[predictions["result"] == 0.5].drop_duplicates("match_id")
    return {
        "scores": scores.round(3).to_dict("records"),
        "coefficients": coefficients.round(3).to_dict("records"),
        # One entry per decisive match, from the actual winner's point of view (out-of-fold probabilities).
        "matches": [
            {"match": r.match, "stage": r.stage, "winner": r.team, "loser": r.opponent,
             "p_win": round(r.p_win, 3), "p_win_xg_only": round(r.p_win_xg_only, 3),
             "xg": round(r.xg, 2), "xg_opp": round(r.xg - r.xg_diff, 2),
             "pass_share": round(r.pass_share, 1)}
            for r in decisive.itertuples()
        ],
        "draws": [{"match": r.match, "stage": r.stage, "team": r.team, "p_win": round(r.p_win, 3)}
                  for r in draws.itertuples()],
    }


def write_site_data(path, table, corr, shots, touch_grids, model_results, n_events):
    win_grid, lose_grid = touch_grids
    payload = {
        "summary": {
            "matches": int(table["match_id"].nunique()),
            "events": int(n_events),
            "player_matches": len(table),
            "shots": len(shots),
            "goals": int(shots["goal"].sum()),
            "xg": round(float(shots["xg"].sum()), 1),
        },
        "labels": LABELS,
        "groups": list(POSITION_GROUPS),
        "correlations": corr.assign(label=corr["metric"].map(LABELS))
                            .round(4).to_dict("records"),
        "distributions": _distributions(table),
        "shots": shots.assign(x=shots["x"].round(1), y=shots["y"].round(1), xg=shots["xg"].round(3))
                      .drop(columns=["match_id"]).to_dict("records"),
        "touch_grid": {"win": win_grid.round(3).tolist(), "lose": lose_grid.round(3).tolist()},
        "model": _model_payload(*model_results),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
