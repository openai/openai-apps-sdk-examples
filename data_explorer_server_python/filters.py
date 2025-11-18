from __future__ import annotations

from typing import Iterable

import pandas as pd

from .schemas import EqualsFilter, Filter, RangeFilter
from .utils import coerce_value_for_series, ensure_column_exists


def apply_filters(dataframe: pd.DataFrame, filters: Iterable[Filter]) -> pd.DataFrame:
    filters_list = list(filters) if filters is not None else []
    if not filters_list:
        return dataframe

    mask = pd.Series(True, index=dataframe.index)

    for raw_filter in filters_list:
        try:
            series = ensure_column_exists(dataframe, raw_filter.column)
        except KeyError:
            # Ignore filters that reference non-existent columns.
            continue

        if raw_filter.type == "equals":
            equals_filter = (
                raw_filter
                if isinstance(raw_filter, EqualsFilter)
                else EqualsFilter.model_validate(raw_filter.model_dump())
            )
            value = coerce_value_for_series(series, equals_filter.value)
            if value is None or pd.isna(value):
                mask &= series.isna()
            else:
                mask &= series == value
        elif raw_filter.type == "range":
            range_filter = (
                raw_filter
                if isinstance(raw_filter, RangeFilter)
                else RangeFilter.model_validate(raw_filter.model_dump())
            )
            if range_filter.min is not None:
                min_value = coerce_value_for_series(series, range_filter.min)
                mask &= series >= min_value
            if range_filter.max is not None:
                max_value = coerce_value_for_series(series, range_filter.max)
                mask &= series <= max_value

    return dataframe[mask]
