export type DataRole = "numeric" | "categorical" | "datetime" | "boolean" | "text";

export type DatasetColumnProfile = {
  name: string;
  role: DataRole;
  dtype: string;
  nonNullCount: number;
  missingCount: number;
  missingProportion: number;
  distinctCount: number;
  sampleValues: unknown[];
  stats?: Record<string, unknown> | null;
  topValues?: Array<{
    value: unknown;
    count: number;
    percentage: number;
  }> | null;
};

export type DatasetProfile = {
  rowCount: number;
  columnCount: number;
  columns: DatasetColumnProfile[];
  memoryUsageBytes: number;
};

export type DatasetSummary = {
  datasetId: string;
  datasetName: string;
  rowCount: number;
  columnCount: number;
  createdAt: string;
  filename?: string | null;
  profile: DatasetProfile;
};

export type FilterEquals = {
  type: "equals";
  column: string;
  value: string | number | boolean | null;
};

export type FilterRange = {
  type: "range";
  column: string;
  min?: number | string | null;
  max?: number | string | null;
};

export type FilterDefinition = FilterEquals | FilterRange;

export type ChartType = "bar" | "scatter" | "histogram";
export type ChartAggregation = "count" | "sum" | "avg";

export type ChartConfig = {
  chartType: ChartType;
  x: string;
  y?: string | null;
  color?: string | null;
  binCount?: number | null;
  aggregation?: ChartAggregation;
};

export type UploadDatasetResponse = {
  dataset: DatasetSummary;
  preview: Array<Record<string, unknown>>;
  columns: string[];
};

export type UploadInitResponse = {
  uploadId: string;
};

export type UploadChunkIntermediate = {
  uploadId: string;
  receivedBytes: number;
  isFinalized: false;
};

export type UploadChunkFinal = UploadDatasetResponse & {
  uploadId: string;
  receivedBytes: number;
  isFinalized: true;
};

export type UploadChunkResponse = UploadChunkIntermediate | UploadChunkFinal;

export type PreviewResponse = {
  datasetId: string;
  totalRows: number;
  rows: Array<Record<string, unknown>>;
  columns: string[];
  appliedFilters: FilterDefinition[];
};

export type BarChartSeries = {
  category: unknown;
  value: number | null;
  color?: unknown;
};

export type ScatterPoint = {
  x: number;
  y: number;
  color?: unknown;
};

export type HistogramBin = {
  binStart: number;
  binEnd: number;
  count: number;
};

export type ChartResponse = {
  datasetId: string;
  chartType: ChartType;
  series?: BarChartSeries[];
  points?: ScatterPoint[];
  bins?: HistogramBin[];
  config: ChartConfig;
};

export type OpenResponse = {
  datasets: DatasetSummary[];
  activeDatasetId: string | null;
  supportsChunkUpload?: boolean;
  maxUploadBytes?: number;
};

export type WidgetState = {
  datasetId: string | null;
  filters: FilterDefinition[];
  preview: {
    limit: number;
    offset: number;
  };
  chartConfig: ChartConfig | null;
};
