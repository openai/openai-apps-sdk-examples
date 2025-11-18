from __future__ import annotations

from typing import Dict, List

import numpy as np
import pandas as pd

from .schemas import (
    Aggregation,
    BarChartSeries,
    ChartConfig,
    ChartResponse,
    ChartType,
    HistogramBin,
    ScatterPoint,
)
from .utils import ensure_column_exists, to_python_value


def _bar_chart(dataframe: pd.DataFrame, config: ChartConfig) -> List[Dict]:
    ensure_column_exists(dataframe, config.x)
    group_keys = [config.x]
    if config.color:
        ensure_column_exists(dataframe, config.color)
        group_keys.append(config.color)

    working = dataframe.dropna(subset=[config.x])

    if config.aggregation == Aggregation.COUNT:
        grouped = (
            working.groupby(group_keys, dropna=False).size().reset_index(name="value")
        )
    else:
        if config.y is None:
            raise ValueError("Bar charts with sum/avg require `y` column.")
        ensure_column_exists(dataframe, config.y)
        numeric_y = pd.to_numeric(working[config.y], errors="coerce")
        working = working.assign(**{config.y: numeric_y}).dropna(subset=[config.y])
        grouped = working.groupby(group_keys, dropna=False)[config.y]
        if config.aggregation == Aggregation.SUM:
            grouped = grouped.sum().reset_index(name="value")
        else:
            grouped = grouped.mean().reset_index(name="value")

    records: List[Dict] = []
    for _, row in grouped.iterrows():
        base_record = {
            "category": to_python_value(row[config.x]),
            "value": float(row["value"]) if row["value"] is not None else None,
        }
        if config.color:
            base_record["color"] = to_python_value(row[config.color])
        records.append(base_record)
    return records


def _scatter_points(
    dataframe: pd.DataFrame, config: ChartConfig, limit: int = 500
) -> List[Dict]:
    if config.y is None:
        raise ValueError("Scatter charts require `y` column.")

    series_x = pd.to_numeric(ensure_column_exists(dataframe, config.x), errors="coerce")
    series_y = pd.to_numeric(ensure_column_exists(dataframe, config.y), errors="coerce")

    working = pd.DataFrame({config.x: series_x, config.y: series_y})
    if config.color and config.color in dataframe.columns:
        working[config.color] = dataframe[config.color]

    working = working.dropna(subset=[config.x, config.y])
    working = working.iloc[:limit]
    working = working.sort_values(by=config.x)

    points: List[Dict] = []
    for _, row in working.iterrows():
        point = {
            "x": float(row[config.x]),
            "y": float(row[config.y]),
        }
        if config.color and config.color in working.columns:
            point["color"] = to_python_value(row[config.color])
        points.append(point)
    return points


def _histogram_bins(dataframe: pd.DataFrame, config: ChartConfig) -> List[Dict]:
    series = pd.to_numeric(ensure_column_exists(dataframe, config.x), errors="coerce")
    numeric = series.dropna()
    if numeric.empty:
        return []

    bin_count = config.bin_count or 10
    counts, bin_edges = np.histogram(numeric, bins=bin_count)

    bins: List[Dict] = []
    for idx in range(len(counts)):
        bins.append(
            {
                "binStart": float(bin_edges[idx]),
                "binEnd": float(bin_edges[idx + 1]),
                "count": int(counts[idx]),
            }
        )
    return bins


def build_chart_response(
    dataframe: pd.DataFrame, config: ChartConfig, dataset_id: str
) -> ChartResponse:
    if config.chart_type == ChartType.BAR:
        data = _bar_chart(dataframe, config)
        series = [BarChartSeries(**item) for item in data]
        return ChartResponse(
            dataset_id=dataset_id,
            chart_type=config.chart_type,
            series=series,
            config=config,
        )

    if config.chart_type == ChartType.SCATTER:
        data = _scatter_points(dataframe, config)
        points = [ScatterPoint(**item) for item in data]
        return ChartResponse(
            dataset_id=dataset_id,
            chart_type=config.chart_type,
            points=points,
            config=config,
        )

    if config.chart_type == ChartType.HISTOGRAM:
        data = _histogram_bins(dataframe, config)
        bins = [HistogramBin(**item) for item in data]
        return ChartResponse(
            dataset_id=dataset_id,
            chart_type=config.chart_type,
            bins=bins,
            config=config,
        )

    raise ValueError(f"Unsupported chart type: {config.chart_type}")
