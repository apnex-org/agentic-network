# architect-telemetry — Phase 2b+ measurement harness

Durable regression-detection substrate for M-Cognitive-Hypervisor, targeting the
proposed tele-10 "Precision Context Engineering" axis (idea-116).

Aggregates per-thread Gemini usage and cognitive-layer tool-call events from
Cloud Run logs and compares them against the ratified Phase 2b exit thresholds
in [`targets.yaml`](./targets.yaml).

## Run

**Preferred — self-contained health check (auto-discovers latest revision):**

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
  scripts/architect-telemetry/check-health.sh --freshness 1h
```

Emits a single-line marker suitable for log-based alerting:
- `[HealthCheck] HEALTHY revision=...` — all required targets pass
- `[HealthCheck] REGRESSION revision=... failed-targets='...'` — alert Director
- `[HealthCheck] INFRA_ERROR ...` — gcloud auth / missing logs / etc

Exit codes: `0` healthy, `1` regression, `2` infra error.

**Manual aggregator invocation:**

```bash
scripts/architect-telemetry/aggregate.py \
  --revision architect-agent-00045-2pb \
  --freshness 30m \
  --thread-prefix thread-18
```

Exit codes: `0` all required targets pass, `1` one or more required targets
fail, `2` error.

## Files

| File | Purpose |
|---|---|
| `aggregate.py` | Pulls `[ArchitectTelemetry]` + `[Sandwich]` log lines, aggregates per-thread, evaluates targets, renders text/yaml/json report |
| `targets.yaml` | Ratified Phase 2b exit thresholds — the permanent class-squashing spec |

## Signal sources

Three log-line classes feed the aggregator. All three must be emitted for a run
to be interpretable:

1. `[ArchitectTelemetry] {"kind":"llm_usage", ...}` — emitted per Gemini round
   by the sandwich telemetry bridge (Phase 2a ckpt-C). Missing → architect-side
   telemetry bridge regressed.
2. `[ArchitectTelemetry] {"kind":"tool_call", ...}` — emitted by the
   architect-side cognitive pipeline (Phase 2b ckpt-C). Missing → cognitive
   pipeline not wired on McpAgentClient.
3. `[Sandwich] thread-reply ... hit MAX_TOOL_ROUNDS` /
   `[Sandwich] thread-reply LLM attempted out-of-scope tool ...` — shim-level
   diagnostics. Missing is fine — not every run exercises these paths.

## Targets (tele-10 draft, pending architect ratification)

See `targets.yaml`. The regression gate enforces the `required: true` entries:

- Zero hot-path tool-scope leaks (ckpt-A squash)
- ≤ 10% MAX_TOOL_ROUNDS rate (ckpt-A + ckpt-B squash; stochastic tolerance)
- ≤ 50k Gemini tokens per thread at p50 (Phase 2b stated target)
- Non-zero production Virtual Tokens Saved (ckpt-C squash)
- Non-zero tool_call telemetry volume (cognitive-pipeline-wiring canary)

Observational (`required: false`) targets track the tail:
- p95 ≤ 200k Gemini tokens per thread
- ≥ 10% summarize rate on architect-side Hub reads

## Interpretation

- **verdict: pass** — All required + observational targets pass. Phase 2b
  is producing target-state output.
- **verdict: partial** — All required targets pass; some observational
  targets miss. Production is healthy, tail behaviour may need Phase 2c work.
- **verdict: fail** — At least one required target fails. Treat as a
  regression — do not promote the revision without understanding why.

## Prompt-shape matrix for measurement runs

The baseline prompt-shape matrix used in the Phase 2b baseline report:

| # | Prompt | Purpose |
|---|---|---|
| 1 | Simple ack (one line, no tool calls) | Minimum per-round baseline |
| 2 | Ideation (open-ended question, no tools) | Moderate round case |
| 3 | Tool-heavy read (`list_threads` + `get_thread`) | Architect-side cache + summarize path |
| 4 | Design analysis (`get_idea idea-102`) | Single oversized read; exercises ResponseSummarizer |
| 5 | Parallel candidate (3× `get_idea` in batch) | Parallel-tool execution + multi-response summarization |

Error-path prompts (intentionally out-of-scope tool calls) are excluded from
regression runs — they produce false-positive `out_of_scope_rejections`. Test
those via unit tests on `ErrorNormalizer` / `sandwich-scope-override`.

## Scheduling recipe (Cloud Scheduler + Cloud Run Job)

`check-health.sh` is designed to run unattended. Recipe for hourly automated regression detection:

1. **Build a container** that bundles the script + deps:

   ```Dockerfile
   FROM gcr.io/google.com/cloudsdktool/google-cloud-cli:slim
   RUN apt-get update && apt-get install -y python3 && rm -rf /var/lib/apt/lists/*
   COPY scripts/architect-telemetry /app/scripts/architect-telemetry
   WORKDIR /app
   CMD ["scripts/architect-telemetry/check-health.sh", "--freshness", "1h"]
   ```

2. **Create a Cloud Run Job:**

   ```bash
   gcloud run jobs create architect-telemetry-healthcheck \
     --image=gcr.io/PROJECT/architect-telemetry-runner:latest \
     --region=australia-southeast1 \
     --service-account=telemetry-runner@PROJECT.iam.gserviceaccount.com
   ```

   Roles required by the runner SA: `roles/logging.viewer`, `roles/run.viewer`.

3. **Wire Cloud Scheduler to invoke hourly:**

   ```bash
   gcloud scheduler jobs create http architect-telemetry-hourly \
     --schedule="0 * * * *" \
     --http-method=POST \
     --uri="https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/PROJECT/jobs/architect-telemetry-healthcheck:run" \
     --oauth-service-account-email=scheduler@PROJECT.iam.gserviceaccount.com
   ```

4. **Alert on regression** via Cloud Monitoring log-based alert:

   ```
   filter = 'resource.type="cloud_run_job"
             textPayload=~"^\[HealthCheck\] REGRESSION"'
   ```

   Route to Director's notification channel (Slack, email, or a Hub-side
   `list_director_notifications` poll).

## Future work

- Terraform module wrapping steps 1-3 above — gets us to "one `terraform apply`
  enables the gate" rather than the current doc-then-click recipe.
- Driver that opens N threads programmatically so the health check also
  *generates* telemetry rather than only consuming ambient Cloud Run logs.
- Confidence intervals via bootstrap resampling of the per-thread distribution.
- Direct Hub-side Director-notification emission on regression (skip the
  Cloud Monitoring alerting step).
