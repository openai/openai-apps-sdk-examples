from __future__ import annotations

from typing import Any, Dict, List

import pandas as pd

from .utils import infer_role, series_sample, to_python_value, top_value_counts


def _numeric_stats(series: pd.Series) -> Dict[str, Any]:
    clean = series.dropna().astype("float64")
    if clean.empty:
        return {
            "min": None,
            "max": None,
            "mean": None,
            "median": None,
            "stdDev": None,
        }
    return {
        "min": to_python_value(clean.min()),
        "max": to_python_value(clean.max()),
        "mean": to_python_value(clean.mean()),
        "median": to_python_value(clean.median()),
        "stdDev": to_python_value(clean.std(ddof=0)),
    }


def _datetime_stats(series: pd.Series) -> Dict[str, Any]:
    clean = pd.to_datetime(series.dropna(), errors="coerce")
    clean = clean.dropna()
    if clean.empty:
        return {"min": None, "max": None}
    return {
        "min": to_python_value(clean.min()),
        "max": to_python_value(clean.max()),
    }


def profile_dataframe(dataframe: pd.DataFrame) -> Dict[str, Any]:
    frame = dataframe.copy()
    frame = frame.convert_dtypes()
    columns: List[Dict[str, Any]] = []

    total_rows = int(frame.shape[0])

    for column in frame.columns:
        series = frame[column]
        role = infer_role(series)
        missing = int(series.isna().sum())
        non_null = total_rows - missing
        distinct = int(series.nunique(dropna=True))
        column_profile: Dict[str, Any] = {
            "name": column,
            "role": role,
            "dtype": str(series.dtype),
            "nonNullCount": non_null,
            "missingCount": missing,
            "missingProportion": float(missing / total_rows) if total_rows else 0.0,
            "distinctCount": distinct,
            "sampleValues": series_sample(series, limit=5),
        }

        if role == "numeric":
            column_profile["stats"] = _numeric_stats(series)
        elif role == "datetime":
            column_profile["stats"] = _datetime_stats(series)

        if role in {"categorical", "text", "boolean"}:
            column_profile["topValues"] = top_value_counts(series, limit=5)

        columns.append(column_profile)

    profile = {
        "rowCount": total_rows,
        "columnCount": int(frame.shape[1]),
        "columns": columns,
        "memoryUsageBytes": int(frame.memory_usage(deep=True).sum()),
    }

    return profile
