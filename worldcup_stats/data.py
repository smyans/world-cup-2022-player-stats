"""Load 2022 World Cup data from StatsBomb open data, cached on disk."""

from pathlib import Path

import pandas as pd
from statsbombpy import sb
from tqdm import tqdm

COMPETITION_ID = 43  # FIFA World Cup
SEASON_ID = 106  # 2022
CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"


def _cached(name, fetch):
    path = CACHE_DIR / f"{name}.pkl"
    if path.exists():
        return pd.read_pickle(path)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    df = fetch()
    df.to_pickle(path)
    return df


def load_matches():
    return _cached(
        "matches",
        lambda: sb.matches(competition_id=COMPETITION_ID, season_id=SEASON_ID),
    )


def load_events(match_id):
    return _cached(f"events_{match_id}", lambda: sb.events(match_id=match_id))


def load_lineups(match_id):
    """One row per player per team, with the time ranges they played each position."""

    def fetch():
        frames = [df.assign(team=team) for team, df in sb.lineups(match_id=match_id).items()]
        return pd.concat(frames, ignore_index=True)

    return _cached(f"lineups_{match_id}", fetch)


def load_all():
    """Download (or read from cache) every match, its events and lineups."""
    matches = load_matches()
    for match_id in tqdm(matches["match_id"], desc="Loading matches"):
        load_events(match_id)
        load_lineups(match_id)
    return matches
