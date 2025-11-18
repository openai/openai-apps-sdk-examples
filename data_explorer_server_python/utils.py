from __future__ import annotations

from datetime import datetime
from typing import Any, List

import numpy as np
import pandas as pd


def to_python_value(value: Any) -> Any:
    """Convert pandas/numpy scalars into JSON-serializable Python primitives."""
    if value is None:
        return None

    if isinstance(value, (str, bool, int, float)):
        return value

    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, (np.integer,)):
        return int(value)

    if isinstance(value, (np.floating,)):
        return float(value)

    if isinstance(value, (np.bool_,)):
        return bool(value)

    if isinstance(value, (pd.Timestamp, pd.Timedelta)):
        return value.isoformat()

    if pd.isna(value):
        return None

    return str(value)


def series_sample(series: pd.Series, limit: int = 5) -> List[Any]:
    values = series.dropna().head(limit).tolist()
    return [to_python_value(v) for v in values]


def dataframe_preview(
    dataframe: pd.DataFrame, *, limit: int, offset: int = 0
) -> List[dict]:
    frame = dataframe.iloc[offset : offset + limit]
    converted = frame.convert_dtypes()
    records = converted.to_dict(orient="records")
    return [{k: to_python_value(v) for k, v in row.items()} for row in records]


def coerce_value_for_series(series: pd.Series, value: Any) -> Any:
    if value is None or pd.isna(value):
        return value

    dtype = series.dtype
    try:
        if pd.api.types.is_numeric_dtype(dtype):
            if isinstance(value, str) and value.strip() == "":
                return None
            return float(value)
        if pd.api.types.is_bool_dtype(dtype):
            if isinstance(value, str):
                lowered = value.strip().lower()
                if lowered in {"true", "1", "yes"}:
                    return True
                if lowered in {"false", "0", "no"}:
                    return False
            return bool(value)
        if pd.api.types.is_datetime64_any_dtype(dtype):
            return pd.to_datetime(value, errors="coerce")
    except Exception:
        return value
    return value


def ensure_column_exists(dataframe: pd.DataFrame, column: str) -> pd.Series:
    if column not in dataframe.columns:
        raise KeyError(f"Column '{column}' not found")
    return dataframe[column]


def infer_role(series: pd.Series) -> str:
    dtype = series.dtype
    if pd.api.types.is_bool_dtype(dtype):
        return "boolean"
    if pd.api.types.is_numeric_dtype(dtype):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "datetime"
    if pd.api.types.is_categorical_dtype(dtype):
        return "categorical"
    if pd.api.types.is_string_dtype(dtype):
        unique_ratio = series.nunique(dropna=True) / max(len(series), 1)
        return "text" if unique_ratio > 0.6 else "categorical"
    return "text"


def top_value_counts(series: pd.Series, limit: int = 5) -> List[dict]:
    counts = series.value_counts(dropna=True).head(limit)
    total = counts.sum() or 1
    return [
        {
            "value": to_python_value(index),
            "count": int(count),
            "percentage": float(count / total),
        }
        for index, count in counts.items()
    ]
