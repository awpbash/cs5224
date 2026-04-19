"""
Plot load test results from CSV.
Run after: bash scripts/load-test.sh

Usage:
  pip install matplotlib pandas
  python scripts/plot-load-test.py

Outputs:
  results/load-test-latency.png      — avg/p95/p99 latency vs concurrency
  results/load-test-success-rate.png  — success rate vs concurrency
  results/load-test-distribution.png  — box plot latency distribution
"""

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import os

SUMMARY_CSV = "results/load-test-summary.csv"
RAW_CSV = "results/load-test-results.csv"
OUTPUT_DIR = "results"

# ── Clean, report-ready style ──
plt.rcParams.update({
    "figure.facecolor": "white",
    "axes.facecolor": "#FAFBFC",
    "axes.edgecolor": "#D1D5DB",
    "axes.grid": True,
    "axes.axisbelow": True,
    "grid.color": "#E5E7EB",
    "grid.linewidth": 0.8,
    "grid.alpha": 0.7,
    "font.family": "sans-serif",
    "font.size": 10,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "axes.labelsize": 11,
    "xtick.labelsize": 10,
    "ytick.labelsize": 10,
    "legend.fontsize": 9,
    "legend.framealpha": 0.9,
    "legend.edgecolor": "#E5E7EB",
})

PALETTE = {
    "indigo":  "#6366F1",
    "pink":    "#EC4899",
    "amber":   "#F59E0B",
    "green":   "#10B981",
    "red":     "#EF4444",
    "blue":    "#3B82F6",
    "purple":  "#8B5CF6",
    "slate":   "#64748B",
}

ENDPOINT_LABELS = {
    "CloudFront_Home": "CloudFront (Static Frontend)",
    "API_ListPreloaded": "API: List Preloaded Datasets",
    "API_ListProjects": "API: List Projects (DynamoDB)",
}

BOX_COLORS = [PALETTE["indigo"], PALETTE["blue"], PALETTE["purple"], PALETTE["pink"], PALETTE["amber"]]


def friendly_name(ep):
    return ENDPOINT_LABELS.get(ep, ep)


def plot_latency(df):
    """Vertically stacked line charts: latency vs concurrency per endpoint."""
    endpoints = df["endpoint"].unique()
    n = len(endpoints)
    fig, axes = plt.subplots(n, 1, figsize=(10, 4.2 * n))
    if n == 1:
        axes = [axes]

    for idx, ep in enumerate(endpoints):
        ax = axes[idx]
        ep_data = df[df["endpoint"] == ep].sort_values("concurrency")
        x = ep_data["concurrency"]

        ax.fill_between(x, ep_data["min_ms"], ep_data["max_ms"],
                        alpha=0.08, color=PALETTE["indigo"], label="Min\u2013Max range")
        ax.plot(x, ep_data["avg_ms"], "o-", color=PALETTE["indigo"],
                label="Average", linewidth=2.2, markersize=7, zorder=5)
        ax.plot(x, ep_data["p95_ms"], "s--", color=PALETTE["pink"],
                label="P95", linewidth=2, markersize=6, zorder=5)
        ax.plot(x, ep_data["p99_ms"], "^:", color=PALETTE["amber"],
                label="P99", linewidth=2, markersize=6, zorder=5)

        # Annotate avg values
        for xi, yi in zip(x, ep_data["avg_ms"]):
            ax.annotate(f"{yi:.0f}", (xi, yi), textcoords="offset points",
                        xytext=(0, 10), ha="center", fontsize=8, color=PALETTE["indigo"], fontweight="bold")

        ax.set_title(friendly_name(ep), pad=10)
        ax.set_xlabel("Concurrent Requests")
        ax.set_ylabel("Latency (ms)")
        ax.set_ylim(bottom=0, top=ax.get_ylim()[1] * 1.15)
        ax.set_xticks(x)
        ax.legend(loc="upper left", ncol=4)

    fig.suptitle("RetailMind \u2014 Response Latency Under Load",
                 fontsize=16, fontweight="bold", y=1.01)
    fig.tight_layout(h_pad=3.0)
    path = os.path.join(OUTPUT_DIR, "load-test-latency.png")
    fig.savefig(path, dpi=180, bbox_inches="tight")
    print(f"  Saved: {path}")
    plt.close(fig)


def plot_success_rate(df):
    """Grouped bar chart: all endpoints side by side per concurrency level."""
    endpoints = df["endpoint"].unique()
    conc_levels = sorted(df["concurrency"].unique())
    n_ep = len(endpoints)
    n_conc = len(conc_levels)

    fig, ax = plt.subplots(figsize=(12, 5.5))

    bar_width = 0.7 / n_ep
    x_base = np.arange(n_conc)

    for i, ep in enumerate(endpoints):
        ep_data = df[df["endpoint"] == ep].sort_values("concurrency")
        rates = []
        for c in conc_levels:
            row = ep_data[ep_data["concurrency"] == c]
            if len(row) > 0:
                ok = row["success_count"].values[0]
                total = row["total_requests"].values[0]
                rates.append((ok / total) * 100 if total > 0 else 0)
            else:
                rates.append(0)

        x_pos = x_base + (i - n_ep / 2 + 0.5) * bar_width
        color = [PALETTE["indigo"], PALETTE["pink"], PALETTE["amber"]][i % 3]
        bars = ax.bar(x_pos, rates, width=bar_width * 0.9, color=color,
                      alpha=0.85, label=friendly_name(ep), edgecolor="white", linewidth=0.5)

        # Percentage label on each bar
        for bar, rate in zip(bars, rates):
            if rate > 0:
                va = "bottom" if rate > 8 else "bottom"
                y_pos = bar.get_height() + 1
                ax.text(bar.get_x() + bar.get_width() / 2, y_pos,
                        f"{rate:.0f}%", ha="center", va="bottom",
                        fontsize=8, fontweight="bold", color=color)

    ax.set_xticks(x_base)
    ax.set_xticklabels([str(c) for c in conc_levels])
    ax.set_xlabel("Concurrent Requests")
    ax.set_ylabel("Success Rate (%)")
    ax.set_ylim(0, 115)
    ax.axhline(y=100, color=PALETTE["green"], linewidth=1, linestyle="--", alpha=0.5, label="100% target")
    ax.legend(loc="lower left", ncol=2, frameon=True)

    ax.set_title("RetailMind \u2014 Success Rate Under Load",
                 fontsize=14, fontweight="bold", pad=15)
    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "load-test-success-rate.png")
    fig.savefig(path, dpi=180, bbox_inches="tight")
    print(f"  Saved: {path}")
    plt.close(fig)


def plot_latency_distribution(raw_df):
    """Vertically stacked box plots: latency distribution per concurrency level."""
    raw_df = raw_df.copy()
    raw_df["time_ms"] = raw_df["time_total"] * 1000
    endpoints = raw_df["endpoint"].unique()
    n = len(endpoints)

    fig, axes = plt.subplots(n, 1, figsize=(10, 4.2 * n))
    if n == 1:
        axes = [axes]

    for idx, ep in enumerate(endpoints):
        ax = axes[idx]
        ep_data = raw_df[raw_df["endpoint"] == ep]
        conc_levels = sorted(ep_data["concurrency"].unique())
        data_groups = [ep_data[ep_data["concurrency"] == c]["time_ms"].dropna().values for c in conc_levels]

        bp = ax.boxplot(
            data_groups,
            labels=[str(c) for c in conc_levels],
            patch_artist=True,
            widths=0.55,
            showfliers=True,
            flierprops=dict(marker="o", markersize=4, alpha=0.4, markerfacecolor=PALETTE["slate"]),
            medianprops=dict(color="white", linewidth=2),
            whiskerprops=dict(color=PALETTE["slate"], linewidth=1.2),
            capprops=dict(color=PALETTE["slate"], linewidth=1.2),
        )
        for patch, color in zip(bp["boxes"], BOX_COLORS):
            patch.set_facecolor(color)
            patch.set_alpha(0.7)
            patch.set_edgecolor(color)

        # Add median labels
        for i, line in enumerate(bp["medians"]):
            median_val = line.get_ydata()[0]
            ax.text(i + 1, median_val, f" {median_val:.0f}ms",
                    va="center", ha="left", fontsize=8, color=PALETTE["slate"], fontweight="bold")

        ax.set_title(friendly_name(ep), pad=10)
        ax.set_xlabel("Concurrent Requests")
        ax.set_ylabel("Latency (ms)")
        ax.set_ylim(bottom=0)

    fig.suptitle("RetailMind \u2014 Latency Distribution Under Load",
                 fontsize=16, fontweight="bold", y=1.01)
    fig.tight_layout(h_pad=3.0)
    path = os.path.join(OUTPUT_DIR, "load-test-distribution.png")
    fig.savefig(path, dpi=180, bbox_inches="tight")
    print(f"  Saved: {path}")
    plt.close(fig)


def main():
    if not os.path.exists(SUMMARY_CSV):
        print(f"ERROR: {SUMMARY_CSV} not found. Run load-test.sh first.")
        return

    print("Loading results...")
    df = pd.read_csv(SUMMARY_CSV)
    print(f"  Summary: {len(df)} rows across {df['endpoint'].nunique()} endpoints")

    plot_latency(df)
    plot_success_rate(df)

    if os.path.exists(RAW_CSV):
        raw_df = pd.read_csv(RAW_CSV)
        print(f"  Raw data: {len(raw_df)} requests")
        plot_latency_distribution(raw_df)

    print("\nDone! Check the results/ folder for PNG charts.")


if __name__ == "__main__":
    main()
