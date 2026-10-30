"""Location-based views of the tournament: every shot, and where winning teams have the ball."""

import numpy as np
import pandas as pd

from .data import load_events, load_lineups, load_matches
from .features import ON_BALL_TYPES, SHOOTOUT_PERIOD, _match_result

ON_TARGET = {"Goal", "Saved", "Saved to Post"}
GRID_X, GRID_Y = 6, 4  # 20x20-unit zones on the 120x80 StatsBomb pitch; finer grids are mostly noise


def match_label(match):
    return f"{match['home_team']} {match['home_score']}–{match['away_score']} {match['away_team']}"


def display_names():
    """Map StatsBomb's full legal names to the names fans know (e.g. 'Lionel Messi')."""
    names = {}
    for match_id in load_matches()["match_id"]:
        lineups = load_lineups(match_id)
        for full, nickname in zip(lineups["player_name"], lineups["player_nickname"]):
            names[full] = nickname or full
    return names


def load_shots():
    """Every non-shootout shot of the tournament, one row each."""
    names = display_names()
    frames = []
    for _, match in load_matches().iterrows():
        events = load_events(match["match_id"])
        shots = events[(events["type"] == "Shot") & (events["period"] != SHOOTOUT_PERIOD)]
        frames.append(pd.DataFrame({
            "match_id": match["match_id"],
            "match": match_label(match),
            "stage": match["competition_stage"],
            "team": shots["team"],
            "player": shots["player"].map(names),
            "minute": shots["minute"],
            "x": shots["location"].str[0],
            "y": shots["location"].str[1],
            "xg": shots["shot_statsbomb_xg"],
            "outcome": shots["shot_outcome"],
            "shot_type": shots["shot_type"],
            "body_part": shots["shot_body_part"],
        }))
    shots = pd.concat(frames, ignore_index=True)
    shots["goal"] = shots["outcome"] == "Goal"
    shots["on_target"] = shots["outcome"].isin(ON_TARGET)
    return shots


def touch_share_grid():
    """Share of a team's on-ball actions in each pitch zone, averaged over winning and losing teams.

    Returns two (GRID_Y, GRID_X) arrays in percent, oriented so the team attacks left to right.
    """
    grids = {1.0: [], 0.0: []}
    for _, match in load_matches().iterrows():
        events = load_events(match["match_id"])
        on_ball = events[(events["period"] != SHOOTOUT_PERIOD) & events["type"].isin(ON_BALL_TYPES)
                         & events["location"].notna()]
        for team, team_events in on_ball.groupby("team"):
            result = _match_result(match, team)
            if result == 0.5:
                continue
            x = team_events["location"].str[0].clip(0, 119.99)
            y = team_events["location"].str[1].clip(0, 79.99)
            counts, _, _ = np.histogram2d(y, x, bins=[GRID_Y, GRID_X], range=[[0, 80], [0, 120]])
            grids[result].append(counts / counts.sum() * 100)
    return np.mean(grids[1.0], axis=0), np.mean(grids[0.0], axis=0)
