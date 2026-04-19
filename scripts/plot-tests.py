"""
Plot security + API test results.
Run after: bash scripts/test-security.sh

Usage:
  pip install matplotlib pandas
  python scripts/plot-tests.py

Outputs:
  results/security-test-matrix.png     - pass/fail grid by category
  results/api-response-breakdown.png   - stacked bar: connect / ttfb / transfer
  results/cold-start-analysis.png      - sequential call latency (warm-up curve)
"""

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import os

SEC_CSV = "results/security-test-results.csv"
API_CSV = "results/api-response-times.csv"
OUTPUT_DIR = "results"

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
})

GREEN = "#10B981"
RED = "#EF4444"
INDIGO = "#6366F1"
PINK = "#EC4899"
AMBER = "#F59E0B"
BLUE = "#3B82F6"
SLATE = "#64748B"
PURPLE = "#8B5CF6"


# ─────────────────────────────────────────────────────────────
# 1. Security Test Matrix (pass/fail heatmap)
# ─────────────────────────────────────────────────────────────
def plot_security_matrix(df):
    categories = df["category"].unique()

    fig, axes = plt.subplots(1, len(categories), figsize=(5 * len(categories), 0.5 * df.groupby("category").size().max() + 3),
                              gridspec_kw={"wspace": 0.4})
    if len(categories) == 1:
        axes = [axes]

    for idx, cat in enumerate(categories):
        ax = axes[idx]
        cat_df = df[df["category"] == cat].reset_index(drop=True)

        for i, row in cat_df.iterrows():
            color = GREEN if row["passed"] == "PASS" else RED
            alpha = 0.8
            ax.barh(i, 1, color=color, alpha=alpha, height=0.7, edgecolor="white", linewidth=1.5)

            label = row["test_name"]
            if len(label) > 35:
                label = label[:33] + "..."
            ax.text(0.5, i, f"{label}  [{row['actual_code']}]",
                    ha="center", va="center", fontsize=9, fontweight="bold",
                    color="white")

        ax.set_xlim(0, 1)
        ax.set_ylim(-0.5, len(cat_df) - 0.5)
        ax.invert_yaxis()
        ax.set_xticks([])
        ax.set_yticks([])

        cat_pass = (cat_df["passed"] == "PASS").sum()
        cat_total = len(cat_df)
        ax.set_title(f"{cat.replace('_', ' ').title()}\n{cat_pass}/{cat_total} passed", pad=12)

        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["bottom"].set_visible(False)
        ax.spines["left"].set_visible(False)

    # Legend
    pass_patch = mpatches.Patch(color=GREEN, alpha=0.8, label="PASS (expected status code)")
    fail_patch = mpatches.Patch(color=RED, alpha=0.8, label="FAIL (unexpected status code)")
    fig.legend(handles=[pass_patch, fail_patch], loc="lower center", ncol=2,
               fontsize=10, frameon=True, edgecolor="#E5E7EB", bbox_to_anchor=(0.5, -0.02))

    total_pass = (df["passed"] == "PASS").sum()
    total = len(df)
    fig.suptitle(f"RetailMind \u2014 Security Test Results ({total_pass}/{total} passed)",
                 fontsize=15, fontweight="bold", y=1.03)
    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "security-test-matrix.png")
    fig.savefig(path, dpi=180, bbox_inches="tight")
    print(f"  Saved: {path}")
    plt.close(fig)


# ─────────────────────────────────────────────────────────────
# 2. API Response Time Breakdown (stacked bar)
# ─────────────────────────────────────────────────────────────
def plot_api_breakdown(df):
    # Filter to the "3 runs each" section (exclude cold start calls)
    api_df = df[df["description"].str.contains(r"\(r[123]\)", regex=True)].copy()

    if api_df.empty:
        # Fallback: use all data
        api_df = df.copy()

    # Clean endpoint names
    api_df["label"] = api_df["description"].str.replace(r" \(r\d\)", "", regex=True)

    # Compute breakdown
    api_df["connect"] = api_df["time_connect_ms"]
    api_df["server"] = api_df["time_ttfb_ms"] - api_df["time_connect_ms"]
    api_df["transfer"] = api_df["time_total_ms"] - api_df["time_ttfb_ms"]

    grouped = api_df.groupby("label").agg(
        connect=("connect", "mean"),
        server=("server", "mean"),
        transfer=("transfer", "mean"),
        total=("time_total_ms", "mean"),
        total_std=("time_total_ms", "std"),
    ).sort_values("total", ascending=True)

    fig, ax = plt.subplots(figsize=(10, max(4, len(grouped) * 0.9 + 2)))

    y = np.arange(len(grouped))
    h = 0.55

    ax.barh(y, grouped["connect"], height=h, color=BLUE, alpha=0.85, label="TCP Connect")
    ax.barh(y, grouped["server"], height=h, left=grouped["connect"], color=INDIGO, alpha=0.85, label="Server Processing (TTFB)")
    ax.barh(y, grouped["transfer"], height=h,
            left=grouped["connect"] + grouped["server"], color=AMBER, alpha=0.85, label="Response Transfer")

    # Total time labels
    for i, (idx, row) in enumerate(grouped.iterrows()):
        ax.text(row["total"] + 8, i, f'{row["total"]:.0f}ms',
                va="center", ha="left", fontsize=9, fontweight="bold", color=SLATE)

    ax.set_yticks(y)
    ax.set_yticklabels(grouped.index, fontsize=10)
    ax.set_xlabel("Response Time (ms)")
    ax.set_xlim(0, grouped["total"].max() * 1.25)
    ax.legend(loc="lower right", fontsize=9, frameon=True, edgecolor="#E5E7EB")

    ax.set_title("RetailMind \u2014 API Response Time Breakdown (avg of 3 runs)", pad=15)
    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "api-response-breakdown.png")
    fig.savefig(path, dpi=180, bbox_inches="tight")
    print(f"  Saved: {path}")
    plt.close(fig)


# ─────────────────────────────────────────────────────────────
# 3. Cold Start Analysis (sequential calls)
# ─────────────────────────────────────────────────────────────
def plot_cold_start(df):
    cold_df = df[df["description"].str.contains("call #", regex=False)].copy()

    if cold_df.empty:
        print("  Skipping cold start plot (no data)")
        return

    # Extract call number
    cold_df["call_num"] = cold_df["description"].str.extract(r"#(\d+)").astype(int)
    endpoints = cold_df["endpoint"].unique()

    fig, ax = plt.subplots(figsize=(10, 5))

    colors = [INDIGO, PINK, AMBER, GREEN, BLUE]
    for i, ep in enumerate(endpoints):
        ep_data = cold_df[cold_df["endpoint"] == ep].sort_values("call_num")
        color = colors[i % len(colors)]

        ax.plot(ep_data["call_num"], ep_data["time_total_ms"], "o-",
                color=color, linewidth=2.2, markersize=8, label=ep, zorder=5)

        # Annotate each point
        for _, row in ep_data.iterrows():
            ax.annotate(f'{row["time_total_ms"]:.0f}ms',
                        (row["call_num"], row["time_total_ms"]),
                        textcoords="offset points", xytext=(0, 12),
                        ha="center", fontsize=8, fontweight="bold", color=color)

    ax.set_xlabel("Sequential Call Number")
    ax.set_ylabel("Response Time (ms)")
    ax.set_xticks(range(1, 6))
    ax.set_xticklabels(["1st\n(cold?)", "2nd", "3rd", "4th", "5th"])
    ax.set_ylim(bottom=0, top=ax.get_ylim()[1] * 1.2)
    ax.legend(loc="upper right", fontsize=9, frameon=True, edgecolor="#E5E7EB")

    ax.set_title("RetailMind \u2014 Lambda Cold Start Analysis (sequential calls)", pad=15)
    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "cold-start-analysis.png")
    fig.savefig(path, dpi=180, bbox_inches="tight")
    print(f"  Saved: {path}")
    plt.close(fig)


# ─────────────────────────────────────────────────────────────
# 4. Security Summary Donut
# ─────────────────────────────────────────────────────────────
def plot_security_donut(df):
    categories = df["category"].unique()
    n = len(categories) + 1  # +1 for overall

    fig, axes = plt.subplots(1, n, figsize=(3.5 * n, 4))
    if n == 1:
        axes = [axes]

    def draw_donut(ax, passed, failed, title):
        total = passed + failed
        sizes = [passed, failed]
        colors_d = [GREEN, RED] if failed > 0 else [GREEN, "#F3F4F6"]
        if failed == 0:
            sizes = [passed, 0.001]

        wedges, _ = ax.pie(sizes, colors=colors_d, startangle=90,
                           wedgeprops=dict(width=0.35, edgecolor="white", linewidth=2))
        ax.text(0, 0, f"{passed}/{total}", ha="center", va="center",
                fontsize=16, fontweight="bold",
                color=GREEN if failed == 0 else SLATE)
        ax.set_title(title, fontsize=10, fontweight="bold", pad=10)

    # Overall
    total_pass = (df["passed"] == "PASS").sum()
    total_fail = (df["passed"] == "FAIL").sum()
    draw_donut(axes[0], total_pass, total_fail, "Overall")

    # Per category
    for i, cat in enumerate(categories):
        cat_df = df[df["category"] == cat]
        p = (cat_df["passed"] == "PASS").sum()
        f = (cat_df["passed"] == "FAIL").sum()
        draw_donut(axes[i + 1], p, f, cat.replace("_", " ").title())

    fig.suptitle("RetailMind \u2014 Security Test Pass Rate",
                 fontsize=14, fontweight="bold", y=1.05)
    fig.tight_layout()
    path = os.path.join(OUTPUT_DIR, "security-summary-donut.png")
    fig.savefig(path, dpi=180, bbox_inches="tight")
    print(f"  Saved: {path}")
    plt.close(fig)


# ─────────────────────────────────────────────────────────────
def main():
    print("Loading test results...\n")

    if os.path.exists(SEC_CSV):
        sec_df = pd.read_csv(SEC_CSV)
        print(f"  Security tests: {len(sec_df)} tests, {(sec_df['passed']=='PASS').sum()} passed")
        plot_security_matrix(sec_df)
        plot_security_donut(sec_df)
    else:
        print(f"  {SEC_CSV} not found - skipping security plots")

    if os.path.exists(API_CSV):
        api_df = pd.read_csv(API_CSV)
        print(f"  API tests: {len(api_df)} measurements")
        plot_api_breakdown(api_df)
        plot_cold_start(api_df)
    else:
        print(f"  {API_CSV} not found - skipping API plots")

    print("\nDone! Check the results/ folder for PNG charts.")


if __name__ == "__main__":
    main()
