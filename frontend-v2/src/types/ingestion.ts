export interface IngestionPartition {
  partition: string;
  market: 'US' | 'IN';
  label: string;
  symbol_count: number;
}

export interface IngestionRun {
  run_id: string;
  run_type?: 'symbol' | 'batch';
  partition?: string;
  parent_run_id?: string | null;
  market?: string;
  symbol?: string | null;
  datasets?: string[];
  dry_run?: boolean;
  plan?: {
    symbol_count?: number;
    batch_count?: number;
    batch_size?: number;
  };
  status: string;
  counts?: Record<string, number>;
  error_count?: number;
  started_at?: string;
  finished_at?: string;
  duration_s?: number;
  results?: Array<{ symbol: string; status: string; error?: string; run_id?: string }>;
  partitions?: IngestionRun[];
  plan_detail?: {
    batches?: Array<{ batch_index: number; symbols: string[]; count: number }>;
  };
}

export interface IngestionJob {
  job_id: string;
  type: string;
  status: string;
  payload?: Record<string, unknown>;
  queued_at?: string;
  finished_at?: string;
  result?: unknown;
  error?: string;
}

export interface IngestionStatus {
  partitions: IngestionPartition[];
  datasets: string[];
  symbol_datasets?: string[];
  market_datasets?: string[];
  tiers?: {
    tier1: string[];
    tier2: string[];
    tier3: string[];
  };
  smart_scrape?: {
    datasets: string[];
    ttl_hours: Record<string, number>;
  };
  freshness_summary?: Record<string, number>;
  freshness_by_dataset?: Record<string, Record<string, number>>;
  tier_coverage?: {
    tier1_coverage?: { documents: Record<string, number>; universe_us?: number; universe_in?: number };
    tier2_coverage?: { documents: Record<string, number> };
    tier3_coverage?: { documents: Record<string, number>; universe_in?: number };
  };
  universe_coverage?: {
    us?: {
      symbol_count?: number;
      coverage_pct?: Record<string, number>;
      covered?: Record<string, number>;
      freshness_sla?: Array<Record<string, unknown>>;
    };
    india?: {
      symbol_count?: number;
      coverage_pct?: Record<string, number>;
      covered?: Record<string, number>;
    };
    summary?: Record<string, number>;
    freshness_sla_hours?: number;
  };
  prerequisites?: {
    ok: boolean;
    planned_datasets?: string[];
    tier_coverage?: {
      tier1_pct?: number;
      tier2_pct?: number;
      tier3_pct?: number;
    };
    issues?: Record<string, string[]>;
  };
  recent_runs: IngestionRun[];
  recent_errors: Array<Record<string, unknown>>;
  queued_jobs: IngestionJob[];
  ts: string;
}

export interface IngestionRefreshResponse {
  status: string;
  job_id?: string;
  symbol?: string;
  market?: string;
  partition?: string;
  datasets?: string[];
  result?: IngestionRun;
}
