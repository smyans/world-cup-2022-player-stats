"""Static charts for the README."""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm  # noqa: E402

from .features import POSITION_GROUPS  # noqa: E402

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_SECONDARY = "#52514e"
GRID = "#e4e3df"
POSITIVE = "#2a78d6"  # blue: higher value goes with winning
NEGATIVE = "#e34948"  # red: higher value goes with losing
NOT_SIGNIFICANT = "#c9c8c2"
DIVERGING = LinearSegmentedColormap.from_list(
    "result_diverging", ["#a52f2e", NEGATIVE, "#f0efec", POSITIVE, "#184f95"]
)
SCALE_LIMIT = 0.25

LABELS = {
    "xg": "xG", "xa": "xA", "shots": "Shots", "touches_in_box": "Touches in box",
    "passes": "Passes", "pass_completion_pct": "Pass completion %", "ground_pass_pct": "Ground pass %",
    "chances_created": "Chances created", "long_balls": "Long balls", "switches": "Switches of play",
    "crosses": "Crosses", "passes_into_final_third": "Passes into final third",
    "passes_into_box": "Passes into box", "progressive_passes": "Progressive passes",
    "progressive_carries": "Progressive carries", "actions_under_pressure": "Actions under pressure",
    "successful_dribbles": "Successful dribbles", "turnovers": "Turnovers", "tackles": "Tackles",
    "tackles_won": "Tackles won", "interceptions": "Interceptions", "pressures": "Pressures",
    "blocks": "Blocks", "clearances": "Clearances", "middle_third_recoveries": "Middle-third recoveries",
    "fouls_committed": "Fouls committed",
}


def _style(ax):
    ax.set_facecolor(SURFACE)
    for side in ["top", "right", "left"]:
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=INK_SECONDARY, length=0, labelsize=9)


def correlation_heatmap(corr, path):
    groups = list(POSITION_GROUPS)
    metrics = list(LABELS)  # grouped by theme: shooting, passing, retention, defending
    rho = corr.pivot(index="metric", columns="position_group", values="rho").loc[metrics, groups]
    sig = corr.pivot(index="metric", columns="position_group", values="significant").loc[metrics, groups]

    fig, ax = plt.subplots(figsize=(6.2, 9.5), facecolor=SURFACE)
    norm = TwoSlopeNorm(vmin=-SCALE_LIMIT, vcenter=0, vmax=SCALE_LIMIT)
    image = ax.imshow(rho.values, cmap=DIVERGING, norm=norm, aspect="auto")

    # White gridlines act as the 2px spacer between cells.
    ax.set_xticks(np.arange(len(groups) + 1) - 0.5, minor=True)
    ax.set_yticks(np.arange(len(metrics) + 1) - 0.5, minor=True)
    ax.grid(which="minor", color=SURFACE, linewidth=2)
    ax.tick_params(which="minor", length=0)

    for i, metric in enumerate(metrics):
        for j, group in enumerate(groups):
            if sig.loc[metric, group]:
                value = rho.loc[metric, group]
                ax.text(j, i, f"{value:+.2f}", ha="center", va="center", fontsize=9,
                        fontweight="bold", color="white" if abs(value) > 0.12 else INK)

    ax.set_xticks(range(len(groups)), groups)
    ax.xaxis.tick_top()
    ax.set_yticks(range(len(metrics)), [LABELS[m] for m in metrics])
    _style(ax)
    ax.spines["bottom"].set_visible(False)
    ax.tick_params(axis="x", colors=INK, labelsize=10)

    bar = fig.colorbar(image, ax=ax, orientation="horizontal", fraction=0.03, pad=0.03)
    bar.set_label("Spearman ρ with match result (loss → draw → win)", color=INK_SECONDARY, fontsize=9)
    bar.outline.set_visible(False)
    bar.ax.tick_params(colors=INK_SECONDARY, labelsize=8, length=0)

    fig.suptitle("Which per-90 stats go with winning?", x=0.02, ha="left", color=INK,
                 fontsize=13, fontweight="bold")
    fig.text(0.02, 0.945, "Labelled cells are significant after FDR correction (q < 0.05)",
             color=INK_SECONDARY, fontsize=9)
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    fig.savefig(path, dpi=200, facecolor=SURFACE)
    plt.close(fig)


def top_metrics_bars(corr, path, top_n=8):
    groups = list(POSITION_GROUPS)
    fig, axes = plt.subplots(1, len(groups), figsize=(12, 4.2), sharex=True, facecolor=SURFACE)

    for ax, group in zip(axes, groups):
        sub = corr[corr["position_group"] == group]
        sub = sub.reindex(sub["rho"].abs().sort_values(ascending=False).index).head(top_n).iloc[::-1]
        colors = [
            (POSITIVE if r > 0 else NEGATIVE) if s else NOT_SIGNIFICANT
            for r, s in zip(sub["rho"], sub["significant"])
        ]
        ax.barh([LABELS[m] for m in sub["metric"]], sub["rho"], color=colors, height=0.55)
        ax.axvline(0, color=INK_SECONDARY, linewidth=0.8)
        ax.xaxis.grid(True, color=GRID, linewidth=0.6)
        ax.set_axisbelow(True)
        ax.set_title(f"{group}  (n = {sub['n'].iloc[0]})", loc="left", color=INK, fontsize=11)
        _style(ax)
        ax.tick_params(axis="y", colors=INK)

    axes[0].set_xlim(-SCALE_LIMIT, SCALE_LIMIT)
    fig.supxlabel("Spearman ρ with match result", color=INK_SECONDARY, fontsize=9)
    fig.suptitle("Strongest links to winning, by position (grey = not significant after FDR correction)",
                 x=0.01, ha="left", color=INK, fontsize=12, fontweight="bold")
    fig.tight_layout()
    fig.savefig(path, dpi=200, facecolor=SURFACE)
    plt.close(fig)
