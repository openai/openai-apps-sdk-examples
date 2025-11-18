from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChartType(str, Enum):
    BAR = "bar"
    SCATTER = "scatter"
    HISTOGRAM = "histogram"


class Aggregation(str, Enum):
    COUNT = "count"
    SUM = "sum"
    AVG = "avg"


class UploadDatasetInput(BaseModel):
    dataset_name: str = Field(alias="datasetName", min_length=1)
    csv_text: Optional[str] = Field(default=None, alias="csvText", min_length=1)
    file_path: Optional[str] = Field(default=None, alias="filePath", min_length=1)
    file_uri: Optional[str] = Field(default=None, alias="fileUri", min_length=1)
    delimiter: Optional[str] = Field(default=None)
    has_header: bool = Field(default=True, alias="hasHeader")
    filename: Optional[str] = Field(default=None)
    encoding: Optional[str] = Field(default=None)

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @model_validator(mode="after")
    def _ensure_source(self) -> UploadDatasetInput:  # type: ignore[override]
        if not (self.csv_text or self.file_path or self.file_uri):
            raise ValueError(
                "Provide csvText, filePath, or fileUri when uploading a dataset."
            )
        return self


class UploadInitInput(BaseModel):
    dataset_name: str = Field(alias="datasetName", min_length=1)
    delimiter: Optional[str] = Field(default=None)
    has_header: bool = Field(default=True, alias="hasHeader")
    filename: Optional[str] = Field(default=None)

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class UploadInitResponse(BaseModel):
    upload_id: str = Field(alias="uploadId")

    model_config = ConfigDict(populate_by_name=True)


class UploadChunkInput(BaseModel):
    upload_id: str = Field(alias="uploadId", min_length=1)
    chunk_text: str = Field(alias="chunkText", min_length=1)
    is_final: bool = Field(alias="isFinal")
    chunk_index: Optional[int] = Field(default=None, alias="chunkIndex", ge=0)

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class UploadChunkStatus(BaseModel):
    upload_id: str = Field(alias="uploadId")
    received_bytes: int = Field(alias="receivedBytes", ge=0)
    is_finalized: bool = Field(alias="isFinalized")
    dataset: Optional[DatasetSummary] = None
    preview: Optional[List[Dict[str, Any]]] = None
    columns: Optional[List[str]] = None

    model_config = ConfigDict(populate_by_name=True)


class BaseFilter(BaseModel):
    column: str
    type: str

    model_config = ConfigDict(extra="ignore")


class EqualsFilter(BaseFilter):
    type: Literal["equals"] = "equals"
    value: Any


class RangeFilter(BaseFilter):
    type: Literal["range"] = "range"
    min: Optional[float | str] = None
    max: Optional[float | str] = None


Filter = Annotated[
    Union[EqualsFilter, RangeFilter],
    Field(discriminator="type"),
]


class ChartConfig(BaseModel):
    chart_type: ChartType = Field(alias="chartType")
    x: str
    y: Optional[str] = None
    color: Optional[str] = None
    bin_count: Optional[int] = Field(default=10, alias="binCount")
    aggregation: Aggregation = Aggregation.COUNT

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class DatasetColumnProfile(BaseModel):
    name: str
    role: str
    dtype: str
    non_null_count: int = Field(alias="nonNullCount")
    missing_count: int = Field(alias="missingCount")
    missing_proportion: float = Field(alias="missingProportion")
    distinct_count: int = Field(alias="distinctCount")
    sample_values: List[Any] = Field(alias="sampleValues")
    stats: Optional[Dict[str, Any]] = None
    top_values: Optional[List[Dict[str, Any]]] = Field(default=None, alias="topValues")

    model_config = ConfigDict(populate_by_name=True)


class DatasetProfile(BaseModel):
    row_count: int = Field(alias="rowCount")
    column_count: int = Field(alias="columnCount")
    columns: List[DatasetColumnProfile]
    memory_usage_bytes: int = Field(alias="memoryUsageBytes")

    model_config = ConfigDict(populate_by_name=True)


class DatasetSummary(BaseModel):
    dataset_id: str = Field(alias="datasetId")
    dataset_name: str = Field(alias="datasetName")
    row_count: int = Field(alias="rowCount")
    column_count: int = Field(alias="columnCount")
    created_at: str = Field(alias="createdAt")
    filename: Optional[str] = None

    profile: DatasetProfile

    model_config = ConfigDict(populate_by_name=True)


class UploadDatasetResponse(BaseModel):
    dataset: DatasetSummary
    preview: List[Dict[str, Any]]
    columns: List[str]


class PreviewInput(BaseModel):
    dataset_id: str = Field(alias="datasetId")
    limit: int = Field(default=20, ge=1, le=200)
    offset: int = Field(default=0, ge=0)
    filters: List[Filter] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class PreviewResponse(BaseModel):
    dataset_id: str = Field(alias="datasetId")
    total_rows: int = Field(alias="totalRows")
    rows: List[Dict[str, Any]]
    columns: List[str]
    applied_filters: List[Filter] = Field(alias="appliedFilters")

    model_config = ConfigDict(populate_by_name=True)


class ChartInput(BaseModel):
    dataset_id: str = Field(alias="datasetId")
    config: ChartConfig
    filters: List[Filter] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class BarChartSeries(BaseModel):
    category: Any
    value: float
    color: Optional[str] = None


class ScatterPoint(BaseModel):
    x: float
    y: float
    color: Optional[str] = None


class HistogramBin(BaseModel):
    bin_start: float = Field(alias="binStart")
    bin_end: float = Field(alias="binEnd")
    count: int


class ChartResponse(BaseModel):
    dataset_id: str = Field(alias="datasetId")
    chart_type: ChartType = Field(alias="chartType")
    series: Optional[List[BarChartSeries]] = None
    points: Optional[List[ScatterPoint]] = None
    bins: Optional[List[HistogramBin]] = None
    config: ChartConfig

    model_config = ConfigDict(populate_by_name=True)


class OpenResponse(BaseModel):
    datasets: List[DatasetSummary]
    active_dataset_id: Optional[str] = Field(default=None, alias="activeDatasetId")
    supports_chunk_upload: bool = Field(default=False, alias="supportsChunkUpload")
    max_upload_bytes: int = Field(default=0, alias="maxUploadBytes")

    model_config = ConfigDict(populate_by_name=True)
