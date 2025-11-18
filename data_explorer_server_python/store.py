from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, Iterable, Optional
from uuid import uuid4

import pandas as pd


@dataclass(slots=True)
class DatasetRecord:
    dataset_id: str
    name: str
    filename: Optional[str]
    created_at: datetime
    updated_at: datetime
    dataframe: pd.DataFrame
    profile: Dict
    row_count: int
    column_count: int


class DatasetStore:
    """In-memory dataset registry keyed by dataset id."""

    def __init__(self) -> None:
        self._datasets: Dict[str, DatasetRecord] = {}
        self._lock = Lock()

    def create(
        self,
        *,
        name: str,
        filename: Optional[str],
        dataframe: pd.DataFrame,
        profile: Dict,
    ) -> DatasetRecord:
        dataset_id = str(uuid4())
        now = datetime.now(timezone.utc)
        record = DatasetRecord(
            dataset_id=dataset_id,
            name=name,
            filename=filename,
            created_at=now,
            updated_at=now,
            dataframe=dataframe,
            profile=profile,
            row_count=int(dataframe.shape[0]),
            column_count=int(dataframe.shape[1]),
        )
        with self._lock:
            self._datasets[dataset_id] = record
        return record

    def get(self, dataset_id: str) -> DatasetRecord:
        with self._lock:
            record = self._datasets.get(dataset_id)
        if record is None:
            raise KeyError(dataset_id)
        return record

    def update_profile(self, dataset_id: str, profile: Dict) -> None:
        with self._lock:
            if dataset_id not in self._datasets:
                raise KeyError(dataset_id)
            record = self._datasets[dataset_id]
            record.profile = profile
            record.row_count = int(record.dataframe.shape[0])
            record.column_count = int(record.dataframe.shape[1])
            record.updated_at = datetime.now(timezone.utc)

    def list_recent(self, limit: int = 5) -> Iterable[DatasetRecord]:
        with self._lock:
            records = list(self._datasets.values())
        records.sort(key=lambda rec: rec.updated_at, reverse=True)
        return records[:limit]

    def clear(self) -> None:
        with self._lock:
            self._datasets.clear()
