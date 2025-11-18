import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import clsx from "clsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMaxHeight } from "../use-max-height";
import { useWidgetProps } from "../use-widget-props";
import { useWidgetState } from "../use-widget-state";
import { useOpenAiGlobal } from "../use-openai-global";
import { callToolJson } from "./utils/callTool";
import {
  formatBytes,
  formatNumber,
  formatPercentage,
  formatValue,
} from "./utils/format";
import type {
  ChartConfig,
  ChartResponse,
  ChartType,
  DatasetColumnProfile,
  DatasetSummary,
  FilterDefinition,
  OpenResponse,
  PreviewResponse,
  UploadChunkFinal,
  UploadChunkResponse,
  UploadDatasetResponse,
  UploadInitResponse,
  WidgetState,
} from "./types";

const DEFAULT_PREVIEW_LIMIT = 20;
const COLOR_PALETTE = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#facc15"];
const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_CHARS_PER_CHUNK = 180_000;

function normalizeChartConfig(config: ChartConfig): ChartConfig {
  const base: ChartConfig = {
    chartType: config.chartType,
    x: config.x,
  };

  if (config.chartType === "bar") {
    base.aggregation = config.aggregation ?? "count";
    if (config.y) {
      base.y = config.y;
    }
    if (config.color) {
      base.color = config.color;
    }
    return base;
  }

  if (config.chartType === "scatter") {
    if (config.y) {
      base.y = config.y;
    }
    if (config.color) {
      base.color = config.color;
    }
    return base;
  }

  if (config.chartType === "histogram") {
    if (config.binCount != null) {
      base.binCount = config.binCount;
    }
    return base;
  }

  return config;
}

export function App(): JSX.Element {
  const maxHeight = useMaxHeight() ?? undefined;
  const displayMode = useOpenAiGlobal("displayMode");
  const defaultWidgetProps = useMemo(
    () => ({
      datasets: [],
      activeDatasetId: null,
      supportsChunkUpload: false,
      maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
    }),
    []
  );
  const widgetProps = useWidgetProps<OpenResponse>(defaultWidgetProps);

  const baseWidgetState: WidgetState = useMemo(
    () => ({
      datasetId: widgetProps.activeDatasetId ?? null,
      filters: [],
      preview: { limit: DEFAULT_PREVIEW_LIMIT, offset: 0 },
      chartConfig: null,
    }),
    [widgetProps.activeDatasetId]
  );

  const [widgetState, setWidgetState] = useWidgetState<WidgetState>(
    () => baseWidgetState
  );

  const currentState = widgetState ?? baseWidgetState;

  const mergeWidgetState = useCallback(
    (
      updater:
        | Partial<WidgetState>
        | ((current: WidgetState) => WidgetState | Partial<WidgetState>)
    ) => {
      setWidgetState((previous) => {
        const baseline = previous ?? baseWidgetState;
        if (typeof updater === "function") {
          return updater(baseline) as WidgetState;
        }
        return { ...baseline, ...updater };
      });
    },
    [baseWidgetState, setWidgetState]
  );

  useEffect(() => {
    if (!widgetState?.datasetId && baseWidgetState.datasetId) {
      mergeWidgetState({ datasetId: baseWidgetState.datasetId });
    }
  }, [widgetState?.datasetId, baseWidgetState.datasetId, mergeWidgetState]);

  const datasetsFromProps = widgetProps?.datasets ?? [];
  const [datasets, setDatasets] = useState<DatasetSummary[]>(
    datasetsFromProps
  );
  useEffect(() => {
    setDatasets(datasetsFromProps);
  }, [datasetsFromProps]);

  const currentDatasetId = currentState.datasetId;
  const currentDataset = useMemo(
    () =>
      currentDatasetId
        ? datasets.find((item) => item.datasetId === currentDatasetId) ?? null
        : null,
    [datasets, currentDatasetId]
  );

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [chart, setChart] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState({
    upload: false,
    preview: false,
    chart: false,
  });
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filters = currentState.filters ?? [];
  const previewSettings = currentState.preview ?? {
    limit: DEFAULT_PREVIEW_LIMIT,
    offset: 0,
  };

  const defaultChartConfig = useMemo(() => {
    const firstColumn = currentDataset?.profile.columns[0];
    return {
      chartType: "bar" as ChartType,
      x: firstColumn?.name ?? "",
      aggregation: "count",
    };
  }, [currentDataset]);

  const [chartConfigDraft, setChartConfigDraft] = useState<ChartConfig>(
    currentState.chartConfig ?? defaultChartConfig
  );

  useEffect(() => {
    setChartConfigDraft(currentState.chartConfig ?? defaultChartConfig);
  }, [currentState.chartConfig, defaultChartConfig]);

  useEffect(() => {
    if (!currentDatasetId) {
      setPreview(null);
      setChart(null);
      return;
    }

    let isCancelled = false;
    setLoading((state) => ({ ...state, preview: true }));

    callToolJson<PreviewResponse>("data-explorer.preview", {
      datasetId: currentDatasetId,
      filters,
      limit: previewSettings.limit,
      offset: previewSettings.offset,
    })
      .then((response) => {
        if (isCancelled) {
          return;
        }
        setPreview(response);
        setError(null);
      })
      .catch((err) => {
        if (isCancelled) {
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to load preview data."
        );
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading((state) => ({ ...state, preview: false }));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    currentDatasetId,
    filters,
    previewSettings.limit,
    previewSettings.offset,
  ]);

  const maxUploadBytes = widgetProps?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const supportsChunkUpload = widgetProps?.supportsChunkUpload ?? false;
  const chunkThreshold = useMemo(() => {
    return Math.max(512 * 1024, Math.floor(maxUploadBytes * 0.6));
  }, [maxUploadBytes]);

  const handleUpload = useCallback(
    async (file: File, datasetName: string) => {
      setLoading((state) => ({ ...state, upload: true }));
      setUploadStatus(null);
      try {
        const friendlyName = datasetName.trim() || file.name;
        const useChunkedUpload =
          supportsChunkUpload && file.size > chunkThreshold;

        let response: UploadDatasetResponse | UploadChunkFinal;

        if (useChunkedUpload) {
          response = await uploadFileInChunks({
            file,
            datasetName: friendlyName,
            maxUploadBytes,
            setStatus: setUploadStatus,
          });
        } else {
          const text = await file.text();
          response = await callToolJson<UploadDatasetResponse>(
            "data-explorer.upload",
            {
              datasetName: friendlyName,
              csvText: text,
              filename: file.name,
            }
          );
        }

        setDatasets((previous) => {
          const filtered = previous.filter(
            (item) => item.datasetId !== response.dataset.datasetId
          );
          return [response.dataset, ...filtered];
        });

        mergeWidgetState({
          datasetId: response.dataset.datasetId,
          filters: [],
          preview: { limit: DEFAULT_PREVIEW_LIMIT, offset: 0 },
          chartConfig: null,
        });

        setPreview({
          datasetId: response.dataset.datasetId,
          totalRows: response.dataset.rowCount,
          rows: response.preview,
          columns: response.columns,
          appliedFilters: [],
        });
        setChart(null);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to upload dataset."
        );
      } finally {
        setUploadStatus(null);
        setLoading((state) => ({ ...state, upload: false }));
      }
    },
    [chunkThreshold, maxUploadBytes, mergeWidgetState, supportsChunkUpload]
  );

  const handleSelectDataset = useCallback(
    (datasetId: string | null) => {
      mergeWidgetState((state) => ({
        ...state,
        datasetId,
        preview: { ...state.preview, offset: 0 },
      }));
      setChart(null);
    },
    [mergeWidgetState]
  );

  const handleFiltersChange = useCallback(
    (nextFilters: FilterDefinition[]) => {
      mergeWidgetState((state) => ({
        ...state,
        filters: nextFilters,
        preview: { ...state.preview, offset: 0 },
      }));
      setChart(null);
    },
    [mergeWidgetState]
  );

  const handlePreviewPage = useCallback(
    (delta: number) => {
      mergeWidgetState((state) => {
        const nextOffset = Math.max(
          0,
          state.preview.offset + delta * state.preview.limit
        );
        return {
          ...state,
          preview: { ...state.preview, offset: nextOffset },
        };
      });
    },
    [mergeWidgetState]
  );

  const handleSetLimit = useCallback(
    (limit: number) => {
      mergeWidgetState((state) => ({
        ...state,
        preview: { limit, offset: 0 },
      }));
    },
    [mergeWidgetState]
  );

  const handleBuildChart = useCallback(
    async (config: ChartConfig) => {
      if (!currentDatasetId) {
        return;
      }
      const normalizedConfig = normalizeChartConfig(config);
      setLoading((state) => ({ ...state, chart: true }));
      try {
        const response = await callToolJson<ChartResponse>(
          "data-explorer.chart",
          {
            datasetId: currentDatasetId,
            config: normalizedConfig,
            filters,
          }
        );
        setChart(response);
        mergeWidgetState((state) => ({
          ...state,
          chartConfig: normalizedConfig,
        }));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chart request failed.");
      } finally {
        setLoading((state) => ({ ...state, chart: false }));
      }
    },
    [currentDatasetId, filters, mergeWidgetState]
  );

  const isFullscreen = displayMode === "fullscreen";

  return (
    <div
      className={clsx(
        "flex w-full flex-col gap-4 bg-white text-neutral-900",
        isFullscreen ? "p-6" : "p-4"
      )}
      style={{ maxHeight }}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Data Explorer</h1>
        <p className="text-sm text-neutral-500">
          Upload a CSV dataset, inspect column profiles, filter rows, and build
          simple charts inline.
        </p>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </header>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[320px,1fr]">
        <aside className="flex flex-col gap-4 overflow-y-auto pr-1">
          <UploadSection
            uploading={loading.upload}
            onUpload={handleUpload}
            statusMessage={uploadStatus}
          />
          <DatasetSelector
            datasets={datasets}
            activeId={currentDatasetId}
            onSelect={handleSelectDataset}
          />
          <ProfileSummary dataset={currentDataset} />
          <FilterBuilder
            columns={currentDataset?.profile.columns ?? []}
            filters={filters}
            onFiltersChange={handleFiltersChange}
          />
        </aside>

        <main className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <TablePreview
            preview={preview}
            loading={loading.preview}
            onChangePage={handlePreviewPage}
            onChangeLimit={handleSetLimit}
            settings={previewSettings}
          />
          <ChartBuilder
            dataset={currentDataset}
            draftConfig={chartConfigDraft}
            setDraftConfig={setChartConfigDraft}
            chart={chart}
            loading={loading.chart}
            onRun={handleBuildChart}
          />
        </main>
      </div>
    </div>
  );
}

type UploadSectionProps = {
  uploading: boolean;
  onUpload: (file: File, datasetName: string) => Promise<void>;
  statusMessage: string | null;
};

function UploadSection({ uploading, onUpload, statusMessage }: UploadSectionProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setSelectedFile(file);
      if (file) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setDatasetName(nameWithoutExt);
      }
    },
    []
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedFile) {
        return;
      }
      await onUpload(selectedFile, datasetName);
      setSelectedFile(null);
      setDatasetName("");
      const fileInput = event.currentTarget.elements.namedItem(
        "file"
      ) as HTMLInputElement | null;
      if (fileInput) {
        fileInput.value = "";
      }
    },
    [datasetName, onUpload, selectedFile]
  );

  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <h2 className="text-sm font-semibold text-neutral-700">Upload CSV</h2>
      <form className="mt-3 flex flex-col gap-3" onSubmit={handleSubmit}>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          disabled={uploading}
          onChange={handleFileChange}
          className="block w-full text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800"
        />
        <label className="text-xs font-medium text-neutral-500" htmlFor="dataset-name">
          Dataset name
        </label>
        <input
          id="dataset-name"
          type="text"
          value={datasetName}
          onChange={(event) => setDatasetName(event.target.value)}
          placeholder="Friendly dataset name"
          disabled={uploading}
          className="rounded-md border border-neutral-200 px-2 py-1 text-sm focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
        />
        <button
          type="submit"
          disabled={!selectedFile || uploading}
          className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {uploading ? "Uploading…" : "Upload dataset"}
        </button>
        {statusMessage ? (
          <p className="text-xs text-neutral-500">{statusMessage}</p>
        ) : null}
      </form>
    </section>
  );
}

type DatasetSelectorProps = {
  datasets: DatasetSummary[];
  activeId: string | null;
  onSelect: (datasetId: string | null) => void;
};

function DatasetSelector({
  datasets,
  activeId,
  onSelect,
}: DatasetSelectorProps) {
  if (!datasets.length) {
    return (
      <section className="rounded-lg border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">
        Upload a dataset to begin exploring.
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Active dataset
      </label>
      <select
        value={activeId ?? ""}
        onChange={(event) => onSelect(event.target.value || null)}
        className="mt-2 w-full rounded-md border border-neutral-200 px-2 py-1 text-sm focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
      >
        <option value="">Choose dataset…</option>
        {datasets.map((dataset) => (
          <option key={dataset.datasetId} value={dataset.datasetId}>
            {dataset.datasetName} ({formatNumber(dataset.rowCount)} rows)
          </option>
        ))}
      </select>
    </section>
  );
}

type ProfileSummaryProps = {
  dataset: DatasetSummary | null;
};

function ProfileSummary({ dataset }: ProfileSummaryProps) {
  if (!dataset) {
    return null;
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-col gap-1 text-sm">
        <h2 className="text-sm font-semibold text-neutral-700">
          {dataset.datasetName}
        </h2>
        {dataset.filename && (
          <p className="text-xs text-neutral-500">{dataset.filename}</p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <SummaryStat label="Rows" value={formatNumber(dataset.rowCount)} />
          <SummaryStat
            label="Columns"
            value={formatNumber(dataset.columnCount)}
          />
          <SummaryStat
            label="Memory"
            value={formatBytes(dataset.profile.memoryUsageBytes)}
          />
          <SummaryStat
            label="Created"
            value={new Date(dataset.createdAt).toLocaleString()}
          />
        </div>
      </div>
      <div className="mt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Columns
        </h3>
        <ul className="mt-2 flex max-h-48 flex-col gap-2 overflow-y-auto pr-1 text-xs">
          {dataset.profile.columns.map((column) => (
            <li
              key={column.name}
              className="rounded-md border border-neutral-200 px-2 py-2"
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium text-neutral-700">
                  {column.name}
                </span>
                <span className="text-neutral-500">{column.role}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-neutral-500">
                <span>
                  Missing {formatPercentage(column.missingProportion)} (
                  {formatNumber(column.missingCount)})
                </span>
                <span>Distinct {formatNumber(column.distinctCount)}</span>
              </div>
              {column.stats && (
                <div className="mt-1 grid grid-cols-2 gap-2 text-neutral-500">
                  {Object.entries(column.stats).map(([key, value]) => (
                    <span key={key}>
                      {key}:{" "}
                      {typeof value === "number"
                        ? formatNumber(value)
                        : formatValue(value)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type SummaryStatProps = {
  label: string;
  value: string;
};

function SummaryStat({ label, value }: SummaryStatProps) {
  return (
    <div className="flex flex-col rounded-md border border-neutral-200 px-2 py-2">
      <span className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className="text-sm font-semibold text-neutral-700">{value}</span>
    </div>
  );
}

type FilterBuilderProps = {
  columns: DatasetColumnProfile[];
  filters: FilterDefinition[];
  onFiltersChange: (filters: FilterDefinition[]) => void;
};

function FilterBuilder({
  columns,
  filters,
  onFiltersChange,
}: FilterBuilderProps) {
  const [draftColumn, setDraftColumn] = useState<string>("");
  const [draftType, setDraftType] = useState<"equals" | "range">("equals");
  const [draftValue, setDraftValue] = useState<string>("");
  const [draftMin, setDraftMin] = useState<string>("");
  const [draftMax, setDraftMax] = useState<string>("");

  useEffect(() => {
    if (!draftColumn && columns.length) {
      setDraftColumn(columns[0].name);
    }
  }, [columns, draftColumn]);

  const handleAddFilter = useCallback(() => {
    if (!draftColumn) {
      return;
    }
    const column = columns.find((item) => item.name === draftColumn);
    if (!column) {
      return;
    }

    const nextFilters: FilterDefinition[] = [...filters];

    if (draftType === "equals") {
      if (!draftValue.trim()) {
        return;
      }
      nextFilters.push({
        type: "equals",
        column: draftColumn,
        value: coerceDraftValue(column, draftValue),
      });
    } else {
      const minValue = coerceRangeBoundary(column, draftMin);
      const maxValue = coerceRangeBoundary(column, draftMax);
      if (minValue == null && maxValue == null) {
        return;
      }
      nextFilters.push({
        type: "range",
        column: draftColumn,
        min: minValue,
        max: maxValue,
      });
    }

    onFiltersChange(nextFilters);
    setDraftValue("");
    setDraftMin("");
    setDraftMax("");
  }, [columns, draftColumn, draftMax, draftMin, draftType, draftValue, filters, onFiltersChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onFiltersChange(filters.filter((_, idx) => idx !== index));
    },
    [filters, onFiltersChange]
  );

  if (!columns.length) {
    return null;
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-700">Filters</h2>
      <div className="mt-3 flex flex-col gap-2">
        {filters.length === 0 ? (
          <p className="text-xs text-neutral-500">No filters applied.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-xs">
            {filters.map((filter, index) => (
              <li
                key={`${filter.column}-${index}`}
                className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-2 py-1"
              >
                <span className="truncate">
                  <strong>{filter.column}</strong>{" "}
                  {filter.type === "equals"
                    ? `= ${formatValue(filter.value)}`
                    : `between ${filter.min ?? "…"} and ${filter.max ?? "…"}`}
                </span>
                <button
                  type="button"
                  className="text-xs text-neutral-500 hover:text-neutral-800"
                  onClick={() => handleRemove(index)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex flex-col gap-2 rounded-md border border-dashed border-neutral-200 p-3">
          <div className="flex gap-2">
            <select
              value={draftColumn}
              onChange={(event) => setDraftColumn(event.target.value)}
              className="w-full rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
            >
              {columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name} ({column.role})
                </option>
              ))}
            </select>
            <select
              value={draftType}
              onChange={(event) =>
                setDraftType(event.target.value as "equals" | "range")
              }
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
            >
              <option value="equals">Equals</option>
              <option value="range">Range</option>
            </select>
          </div>
          {draftType === "equals" ? (
            <input
              type="text"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              placeholder="Value"
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={draftMin}
                onChange={(event) => setDraftMin(event.target.value)}
                placeholder="Min"
                className="w-full rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <input
                type="text"
                value={draftMax}
                onChange={(event) => setDraftMax(event.target.value)}
                placeholder="Max"
                className="w-full rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
            </div>
          )}
          <button
            type="button"
            className="self-start rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-400"
            onClick={handleAddFilter}
          >
            Add filter
          </button>
        </div>
      </div>
    </section>
  );
}

function coerceDraftValue(
  column: DatasetColumnProfile,
  raw: string
): string | number | boolean | null {
  const trimmed = raw.trim();
  if (!trimmed.length) {
    return null;
  }
  if (column.role === "boolean") {
    const normalized = trimmed.toLowerCase();
    return ["true", "1", "yes"].includes(normalized);
  }
  if (column.role === "numeric") {
    const numeric = Number(trimmed);
    return Number.isNaN(numeric) ? trimmed : numeric;
  }
  return trimmed;
}

function coerceRangeBoundary(
  column: DatasetColumnProfile,
  raw: string
): number | string | null {
  const trimmed = raw.trim();
  if (!trimmed.length) {
    return null;
  }
  if (column.role === "numeric") {
    const numeric = Number(trimmed);
    return Number.isNaN(numeric) ? null : numeric;
  }
  return trimmed;
}

type ChunkUploadParams = {
  file: File;
  datasetName: string;
  maxUploadBytes: number;
  setStatus: (status: string | null) => void;
};

async function uploadFileInChunks({
  file,
  datasetName,
  maxUploadBytes,
  setStatus,
}: ChunkUploadParams): Promise<UploadChunkFinal> {
  setStatus("Initializing upload…");
  const initResponse = await callToolJson<UploadInitResponse>(
    "data-explorer.uploadInit",
    {
      datasetName,
      filename: file.name,
      hasHeader: true,
    }
  );

  const fullText = await file.text();
  const chunkSize = Math.max(
    32_000,
    Math.min(DEFAULT_CHARS_PER_CHUNK, Math.floor(maxUploadBytes / 8))
  );
  const totalChunks = Math.max(1, Math.ceil(fullText.length / chunkSize));
  let offset = 0;
  let chunkIndex = 0;
  let lastResponse: UploadChunkResponse | null = null;

  while (offset < fullText.length) {
    const chunkText = fullText.slice(offset, offset + chunkSize);
    const isFinal = offset + chunkSize >= fullText.length;
    setStatus(
      isFinal
        ? "Finalizing upload…"
        : `Uploading chunk ${chunkIndex + 1} of ${totalChunks}…`
    );

    const chunkResponse = await callToolJson<UploadChunkResponse>(
      "data-explorer.uploadChunk",
      {
        uploadId: initResponse.uploadId,
        chunkText,
        isFinal,
        chunkIndex,
      }
    );

    lastResponse = chunkResponse;
    offset += chunkSize;
    chunkIndex += 1;
  }

  if (!lastResponse || lastResponse.isFinalized !== true) {
    throw new Error("Upload session did not finalize as expected.");
  }

  return lastResponse;
}

type TablePreviewProps = {
  preview: PreviewResponse | null;
  loading: boolean;
  settings: { limit: number; offset: number };
  onChangePage: (delta: number) => void;
  onChangeLimit: (limit: number) => void;
};

function TablePreview({
  preview,
  loading,
  settings,
  onChangePage,
  onChangeLimit,
}: TablePreviewProps) {
  const totalRows = preview?.totalRows ?? 0;
  const currentPage =
    totalRows === 0 ? 1 : Math.floor(settings.offset / settings.limit) + 1;
  const totalPages =
    totalRows === 0 ? 1 : Math.ceil(totalRows / settings.limit);

  const columns = preview?.columns ?? [];

  return (
    <section className="flex min-h-[260px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-neutral-700">Table preview</span>
          <span className="text-xs text-neutral-500">
            {loading ? "Loading…" : `${formatNumber(totalRows)} rows`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-neutral-500">Rows per page</label>
          <select
            value={settings.limit}
            onChange={(event) => onChangeLimit(Number(event.target.value))}
            className="rounded-md border border-neutral-200 px-2 py-1 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          >
            {[10, 20, 50, 100].map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChangePage(-1)}
              disabled={loading || settings.offset === 0}
              className="rounded-md border border-neutral-200 px-2 py-1 text-neutral-500 hover:border-neutral-400 disabled:cursor-not-allowed disabled:border-neutral-100 disabled:text-neutral-300"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => onChangePage(1)}
              disabled={loading || currentPage >= totalPages}
              className="rounded-md border border-neutral-200 px-2 py-1 text-neutral-500 hover:border-neutral-400 disabled:cursor-not-allowed disabled:border-neutral-100 disabled:text-neutral-300"
            >
              Next
            </button>
            <span className="hidden text-neutral-500 sm:inline">
              Page {currentPage} of {totalPages}
            </span>
          </div>
        </div>
      </header>
      <div className="relative min-h-0 flex-1 overflow-auto">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-2 text-left font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 text-xs text-neutral-700">
            {preview?.rows?.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-neutral-50">
                {columns.map((column) => (
                  <td key={column} className="px-4 py-2">
                    {formatValue(row[column])}
                  </td>
                ))}
              </tr>
            ))}
            {!preview && !loading && (
              <tr>
                <td
                  colSpan={columns.length || 1}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  Select a dataset to load preview data.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={columns.length || 1}
                  className="px-4 py-6 text-center text-neutral-500"
                >
                  Loading rows…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ChartBuilderProps = {
  dataset: DatasetSummary | null;
  draftConfig: ChartConfig;
  setDraftConfig: (config: ChartConfig) => void;
  chart: ChartResponse | null;
  loading: boolean;
  onRun: (config: ChartConfig) => void;
};

function ChartBuilder({
  dataset,
  draftConfig,
  setDraftConfig,
  chart,
  loading,
  onRun,
}: ChartBuilderProps) {
  const columns = dataset?.profile.columns ?? [];

  const handleChange = <K extends keyof ChartConfig>(
    key: K,
    value: ChartConfig[K]
  ) => {
    setDraftConfig({ ...draftConfig, [key]: value });
  };

  const canRun = Boolean(dataset) && Boolean(draftConfig.x);

  return (
    <section className="flex flex-col gap-4 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-700">
            Chart builder
          </h2>
          <select
            value={draftConfig.chartType}
            onChange={(event) =>
              handleChange("chartType", event.target.value as ChartConfig["chartType"])
            }
            className="rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          >
            <option value="bar">Bar</option>
            <option value="scatter">Scatter</option>
            <option value="histogram">Histogram</option>
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="X axis"
            value={draftConfig.x ?? ""}
            onChange={(value) => handleChange("x", value)}
            options={columns.map((column) => ({
              value: column.name,
              label: `${column.name} (${column.role})`,
            }))}
          />
          {draftConfig.chartType !== "histogram" && (
            <SelectField
              label="Y axis"
              value={draftConfig.y ?? ""}
              onChange={(value) =>
                handleChange("y", value ? value : undefined)
              }
              options={[
                { value: "", label: "None" },
                ...columns
                  .filter((column) => column.role === "numeric")
                  .map((column) => ({
                    value: column.name,
                    label: `${column.name} (${column.role})`,
                  })),
              ]}
            />
          )}
          <SelectField
            label="Color"
            value={draftConfig.color ?? ""}
            onChange={(value) =>
              handleChange("color", value ? value : undefined)
            }
            options={[
              { value: "", label: "None" },
              ...columns.map((column) => ({
                value: column.name,
                label: `${column.name} (${column.role})`,
              })),
            ]}
          />
          {draftConfig.chartType === "bar" && (
            <SelectField
              label="Aggregation"
              value={draftConfig.aggregation ?? "count"}
              onChange={(value) =>
                handleChange("aggregation", value as ChartConfig["aggregation"])
              }
              options={[
                { value: "count", label: "Count" },
                { value: "sum", label: "Sum" },
                { value: "avg", label: "Average" },
              ]}
            />
          )}
          {draftConfig.chartType === "histogram" && (
            <SelectField
              label="Bins"
              value={String(draftConfig.binCount ?? 10)}
              onChange={(value) =>
                handleChange("binCount", Number(value) || 10)
              }
              options={["10", "20", "30"].map((count) => ({
                value: count,
                label: count,
              }))}
            />
          )}
        </div>

        <button
          type="button"
          disabled={!canRun || loading}
          onClick={() => onRun(normalizeChartConfig(draftConfig))}
          className="self-start rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {loading ? "Building chart…" : "Build chart"}
        </button>
      </div>

      <div className="min-h-[220px] flex-1">
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            Building chart…
          </div>
        )}
        {!loading && chart && <ChartCanvas response={chart} />}
        {!loading && !chart && (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-neutral-200 text-sm text-neutral-500">
            Configure chart inputs and run to see a visualization.
          </div>
        )}
      </div>
    </section>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
};

function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type ChartCanvasProps = {
  response: ChartResponse;
};

function ChartCanvas({ response }: ChartCanvasProps) {
  if (response.chartType === "bar" && response.series) {
    const data = response.series.map((item) => ({
      category: formatValue(item.category),
      value: item.value ?? 0,
      color: item.color ? String(item.color) : undefined,
    }));

    return (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="category" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="value" name="Value">
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={COLOR_PALETTE[index % COLOR_PALETTE.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (response.chartType === "scatter" && response.points) {
    const seriesMap = new Map<string, typeof response.points>();
    response.points.forEach((point) => {
      const key =
        point.color !== undefined && point.color !== null
          ? String(point.color)
          : "Series";
      if (!seriesMap.has(key)) {
        seriesMap.set(key, []);
      }
      seriesMap.get(key)!.push(point);
    });

    const series = Array.from(seriesMap.entries());

    return (
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name={response.config.x}
            tick={{ fontSize: 10 }}
            tickFormatter={(value) => formatNumber(value as number)}
            domain={['dataMin', 'dataMax']}
            allowDuplicatedCategory={false}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={response.config.y ?? "y"}
            tick={{ fontSize: 10 }}
            tickFormatter={(value) => formatNumber(value as number)}
            domain={['dataMin', 'dataMax']}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Legend />
          {series.map(([key, data], index) => (
            <Scatter
              key={key}
              name={key}
              data={data}
              fill={COLOR_PALETTE[index % COLOR_PALETTE.length]}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (response.chartType === "histogram" && response.bins) {
    const data = response.bins.map((bin) => ({
      range: `${formatNumber(bin.binStart)}-${formatNumber(bin.binEnd)}`,
      count: bin.count,
    }));

    return (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="range" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Bar dataKey="count" name="Count" fill={COLOR_PALETTE[0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-neutral-200 text-sm text-neutral-500">
      No chart data.
    </div>
  );
}
