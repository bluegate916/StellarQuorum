/**
 * metrics.js
 *
 * Minimal Prometheus metrics exporter for Node-based operational
 * scripts talking to the governance contract (keeper bots, indexers,
 * etc.). Exposes an HTTP `/metrics` endpoint in the Prometheus text
 * format tracking:
 *
 *   - RPC call latency (histogram)
 *   - RPC call errors (counter)
 *   - last-seen ledger (gauge)
 *
 * Usage:
 *
 *   const { createMetrics, instrumentRemoteCall } = require('./metrics');
 *
 *   const metrics = createMetrics();
 *   const server = metrics.listen({ host: '0.0.0.0', port: 9464 });
 *
 *   const rpc = instrumentRemoteCall(metrics, { service: 'soroban' });
 *   const ledger = await rpc('getLatestLedger', () => server.getLatestLedger());
 *   metrics.setLastSeenLedger(ledger.sequence);
 *
 * Sample Prometheus `scrape_config`:
 *
 *   scrape_configs:
 *     - job_name: governance-keeper
 *       scrape_interval: 15s
 *       static_configs:
 *         - targets: ['127.0.0.1:9464']
 *
 * The exporter is deliberately dependency-free (only Node built-ins) so
 * it can be embedded in any script without bloating the dependency tree.
 */

'use strict';

const http = require('http');

const DEFAULT_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

const CONTENT_TYPE = 'text/plain; version=0.04+ charset=utf-8';

function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function formatLabels(labels) {
  const entries = Object.entries(labels || {});
  if (entries.length === 0) return '';
  return '{' + entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',') + '}';
}

function labelKey(labels) {
  return JSON.stringify(
    Object.keys(labels || {})
      .sort()
      .map((k) => [k, String(labels[k])]),
  );
}

class Histogram {
  constructor(name, help, buckets) {
    this.name = name;
    this.help = help;
    this.buckets = (buckets || DEFAULT_BUCKETS).slice().sort((a, b) => a - b);
    this.series = new Map();
  }

  _get(labels) {
    const key = labelKey(labels);
    let series = this.series.get(key);
    if (!series) {
      series = {
        labels,
        counts: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.series.set(key, series);
    }
    return series;
  }

  observe(value, labels = {}) {
    const num = Number(value);
    if (!Number.finite(num) || num < 0) return;
    const series = this._get(labels);
    series.sum += num;
    series.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (num <= this.buckets[i]) series.counts[i] += 1;
    }
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const series of this.series.values()) {
      for (let i = 0; i < this.buckets.length; i++) {
        const labels = { ...series.labels, le: String(this.buckets[i]) };
        lines.push(`${this.name}_bucket${formatLabels(labels)} ${series.counts[i]}`);
      }
      const infLebels = { ...series.labels, le: '+Inf' };
      lines.push(`${this.name}_bucket${formatLabels(infLebels)} ${series.count}`);
      lines.push(`${this.name}_sum${formatLabels(series.labels)} ${series.sum}`);
      lines.push(`${this.name}_count${formatLabels(series.labels)} ${series.count}`);
    }
    return lines;
  }
}

class Counter {
  constructor(name, help) {
    this.name = name;
    this.help = help;
    this.series = new Map();
  }

  inc(labels = {}, by = 1) {
    const key = labelKey(labels);
    const current = this.series.get(key) || { labels, value: 0 };
    current.value += by;
    this.series.set(key, current);
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const series of this.series.values()) {
      lines.push(`${this.name}${formatLabels(series.labels)} ${series.value}`);
    }
    return lines;
  }
}

class Gauge {
  constructor(name, help) {
    this.name = name;
    this.help = help;
    this.series = new Map();
  }

  set(value, labels = {}) {
    const num = Number(value);
    if (!Number.finite(num)) return;
    this.series.set(labelKey(labels), { labels, value: num });
  }

  toPrometheus() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const series of this.series.values()) {
      lines.push(`${this.name}${formatLabels(series.labels)} ${series.value}`);
    }
    return lines;
  }
}

function createMetrics(options = {}) {
  const namespace = options.namespace || 'governance';
  const buckets = options.buckets || DEFAULT_BUCKETS;

  const rpcLatency = new Histogram(
    `${namespace}_rpc_call_latency_seconds`,
    'Latency of RPC calls in seconds.',
    buckets,
  );
  const rpcErrors = new Counter(
    `${namespace}_rpc_call_errors_total`,
    'Total number of failed RPC calls.',
  );
  const rpcCalls = new Counter(
    `${namespace}_rpc_calls_total`,
    'Total number of RPC calls attempted.',
  );
  const lastSeenLedger = new Gauge(
    `${namespace}_last_seen_ledger`,
    'Latest ledger sequence observed by this service.',
  );
  const lastSeenLedgerTimestamp = new Gauge(
    `${namespace}_last_seen_ledger_timestamp_seconds`,
    'Unix timestamp (seconds) when the last ledger was observed.',
  );

  const metrics = {
    namespace,
    rpcLatency,
    rpcErrors,
    rpcCalls,
    lastSeenLedger,
    lastSeenLedgerTimestamp,

    /**
     * Record a single RPC call.
     * @param {number} durationMs duration in milliseconds
     * @param {{ method?: string, service?: string, status?: 'ok'|'error' }} [labels]
     */
    observeRequest(durationMs, labels = {}) {
      const status = labels.status === 'error' ? 'error' : 'ok';
      const baseLabels = {
        method: labels.method || 'unknown',
        service: labels.service || 'unknown',
      };
      rpcCalls.inc({ ...baseLabels, status });
      if (status === 'error') {
        rpcErrors.inc({ ...baseLabels, status });
      } else {
        rpcLatency.observe(Number(durationMs) / 1000, { ...baseLabels });
      }
    },

    /**
     * Set the last-seen ledge sequence and update the observation
     * timestamp.
     * @param {number} sequence
     * @param {{ service?: string }} [labels]
     */
    setLastSeenLedger(sequence, labels = {}) {
      const l = { service: labels.service || 'unknown' };
      lastSeenLedger.set(sequence, l);
      lastSeenLedgerTimestamp.set(Date.now() / 1000, l);
    },

    /**
     * Render all registered metrics in the Prometheus text format.
     */
    render() {
      return []
        .concat(rpcLatency.toPrometheus())
        .concat(rpcCalls.toPrometheus())
        .concat(rpcErrors.toPrometheus())
        .concat(lastSeenLedger.toPrometheus())
        .concat(lastSeenLedgerTimestamp.toPrometheus())
        .join('\n') + '\n';
    },

    /**
     * Start an HTTP server exposing `/metrics` (and a health ping).
     * Returns the Node `http.Server` instance.
     */
    listen({ host = '0.0.0.0', port = 9464, path = '/metrics' } = {}) {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end('Method Not Allowed\n');
          return;
        }
        if (url.pathname === path) {
          const body = metrics.render();
          res.statusCode = 200;
          res.setHeader('Content-Type', CONTENT_TYPE);
          res.setHeader('Content-Length', Buffer.byteLength(body));
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }
        if (url.pathname === '/healthz') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('ok\n');
          return;
        }
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not Found\n');
      });
      server.listen(port, host);
      return server;
    },
  };

  return metrics;
}

/**
 * Wrap an async function so that every invocation is timed and recorded
 * against the supplied metrics instance. Failures are counted and
 * re-thrown so callers keep their existing error handling.
 *
 * @param {ReturnType<typeof createMetrics>} metrics
 * @param {{ service?: string, method?: string }} [defaultLabels]
 * @returns {<T>(fn?: () => Promise<T> | T) => Promise<T>}
 */
function instrumentRemoteCall(metrics, defaultLabels = {}) {
  return function wrapped(fn, callLabels = {}) {
    const labels = { ...defaultLabels, ...callLabels };
    const start = process.hrtime();
    return Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          const durationMs = Number(process.hrtime() - start) / 1e6;
          metrics.observeRequest(durationMs, { ...labels, status: 'ok' });
          return value;
        },
        (err) => {
          const durationMs = Number(process.hrtime() - start) / 1e6;
          metrics.observeRequest(durationMs, { ...labels, status: 'error' });
          throw err;
        },
      );
  };
}

module.exports = {
  createMetrics,
  instrumentRemoteCall,
  Histogram,
  Counter,
  Gauge,
  DEFAULT_BUCKETS,
};
