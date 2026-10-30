"""Can a team's in-game stats tell us who won? A match-level logistic regression.

Each decisive match becomes two rows, one from each team's point of view. Features are
differentials (team minus opponent), so with no intercept the model is symmetric:
P(A beats B) + P(B beats A) = 1. Cross-validation holds out whole matches, so a match's
mirrored row never leaks into its own training fold.
"""

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .data import load_events, load_matches
from .features import SHOOTOUT_PERIOD, _match_result, _player_counts, _prepare_events
from .pitch import match_label

FEATURES = {
    "xg": "xG",
    "shots": "Shots",
    "touches_in_box": "Touches in box",
    "pass_share": "Possession (share of passes)",
    "pass_completion_pct": "Pass completion %",
    "progressive_passes": "Progressive passes",
    "pressures": "Pressures",
    "defensive_actions": "Tackles + interceptions + blocks",
}
BOOTSTRAP_SAMPLES = 1000


def team_match_table():
    """One row per team per match with team totals and differentials vs the opponent."""
    rows = []
    for _, match in load_matches().iterrows():
        events = _prepare_events(load_events(match["match_id"]))
        events = events[events["period"] != SHOOTOUT_PERIOD]
        shots = events[events["type"] == "Shot"]
        shot_xg = dict(zip(shots["id"], shots["shot_statsbomb_xg"]))
        total_passes = (events["type"] == "Pass").sum()
        for team, team_events in events.groupby("team"):
            counts = _player_counts(team_events, shot_xg)
            rows.append({
                "match_id": match["match_id"],
                "match": match_label(match),
                "stage": match["competition_stage"],
                "team": team,
                "result": _match_result(match, team),
                "xg": counts["xg"],
                "shots": counts["shots"],
                "touches_in_box": counts["touches_in_box"],
                "pass_share": counts["passes"] / total_passes * 100,
                "pass_completion_pct": counts["pass_completion_pct"],
                "progressive_passes": counts["progressive_passes"],
                "pressures": counts["pressures"],
                "defensive_actions": counts["tackles"] + counts["interceptions"] + counts["blocks"],
            })
    df = pd.DataFrame(rows)

    opponent = df.groupby("match_id")[list(FEATURES)].transform("sum") - df[list(FEATURES)]
    for feature in FEATURES:
        df[f"{feature}_diff"] = df[feature] - opponent[feature]
    df["opponent"] = df.groupby("match_id")["team"].transform(lambda teams: teams.iloc[::-1].values)
    return df


def _model():
    return make_pipeline(StandardScaler(with_mean=False), LogisticRegression(fit_intercept=False, C=1.0))


def _out_of_fold(decisive, columns):
    X, y, groups = decisive[columns].values, decisive["result"].values, decisive["match_id"].values
    probs = np.empty(len(decisive))
    for train, test in LeaveOneGroupOut().split(X, y, groups):
        probs[test] = _model().fit(X[train], y[train]).predict_proba(X[test])[:, 1]
    return probs


def _scores(name, y, probs):
    return {
        "model": name,
        "accuracy": accuracy_score(y, probs > 0.5),
        "log_loss": log_loss(y, probs, labels=[0, 1]),
        "brier": brier_score_loss(y, probs),
    }


def evaluate():
    """Cross-validated scores, standardised coefficients with bootstrap CIs, and per-match predictions."""
    teams = team_match_table()
    decisive = teams[teams["result"] != 0.5].reset_index(drop=True)
    y = decisive["result"].values
    all_columns = [f"{f}_diff" for f in FEATURES]

    xg_probs = _out_of_fold(decisive, ["xg_diff"])
    full_probs = _out_of_fold(decisive, all_columns)
    scores = pd.DataFrame([
        _scores("Coin flip (50%)", y, np.full(len(y), 0.5)),
        _scores("xG difference only", y, xg_probs),
        _scores("All 8 stat differences", y, full_probs),
    ])

    # Coefficients are on standardised features, so they compare "one standard deviation more than the opponent".
    final = _model().fit(decisive[all_columns].values, y)
    coefs = final[-1].coef_[0]
    rng = np.random.default_rng(2022)
    match_ids = decisive["match_id"].unique()
    boot = []
    for _ in range(BOOTSTRAP_SAMPLES):
        sample = rng.choice(match_ids, size=len(match_ids), replace=True)
        resampled = pd.concat([decisive[decisive["match_id"] == m] for m in sample])
        boot.append(_model().fit(resampled[all_columns].values, resampled["result"].values)[-1].coef_[0])
    low, high = np.percentile(boot, [2.5, 97.5], axis=0)
    coefficients = pd.DataFrame({
        "feature": list(FEATURES), "label": list(FEATURES.values()),
        "coefficient": coefs, "ci_low": low, "ci_high": high,
    })

    predictions = decisive.assign(p_win=full_probs, p_win_xg_only=xg_probs)
    draws = teams[teams["result"] == 0.5]
    predictions = pd.concat([predictions, draws.assign(p_win=final.predict_proba(draws[all_columns].values)[:, 1])])
    return scores, coefficients, predictions
