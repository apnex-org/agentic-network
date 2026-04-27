# ── Project (passthrough for convenience; could be sourced from base) ─

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "australia-southeast1"
}

variable "environment" {
  description = "Environment label (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}

# ── Service Naming ────────────────────────────────────────────────────

variable "hub_service_name" {
  description = "Cloud Run service name for the Hub"
  type        = string
  default     = "hub"
}

variable "architect_service_name" {
  description = "Cloud Run service name for the Architect agent"
  type        = string
  default     = "architect-agent"
}

# ── Auth ──────────────────────────────────────────────────────────────

variable "hub_api_token" {
  description = "Bearer token for Hub /mcp endpoint authentication"
  type        = string
  sensitive   = true
}

# ── Hub Config ────────────────────────────────────────────────────────

variable "hub_min_instances" {
  description = "Minimum Cloud Run instances for Hub (0 = scale to zero)"
  type        = number
  default     = 1
}

variable "hub_max_instances" {
  description = "Maximum Cloud Run instances for Hub"
  type        = number
  default     = 1
}

variable "hub_image" {
  description = "Docker image for Hub (full registry path). Leave empty to use Artifact Registry default."
  type        = string
  default     = ""
}

variable "watchdog_enabled" {
  description = "ADR-017 comms-reliability watchdog. Set to \"false\" during adapter-rollout migration windows to pause the escalation ladder (queue + completion-acks stay operational). Default \"true\" for normal operation."
  type        = string
  default     = "true"
}

# ── Architect Config ──────────────────────────────────────────────────

variable "architect_min_instances" {
  description = "Minimum Cloud Run instances for Architect (0 = scale-to-zero / wake-on-demand, 1 = always warm). Default 1 because scale-to-zero strands pending-action queue drains until an HTTP poke or wake-endpoint fire cold-starts the service — observed during M-Cognitive-Hypervisor Phase 2b-B measurements. Set to 0 explicitly for quiet windows or once the ADR-017 wake-endpoint is confirmed load-bearing."
  type        = number
  default     = 1
}

variable "architect_max_instances" {
  description = "Maximum Cloud Run instances for Architect"
  type        = number
  default     = 1
}

variable "architect_image" {
  description = "Docker image for Architect (full registry path). Leave empty to use Artifact Registry default."
  type        = string
  default     = ""
}

variable "architect_context_prefix" {
  description = "GCS prefix for Architect's context store"
  type        = string
  default     = "architect-context/"
}

variable "event_loop_enabled" {
  description = "Enable Architect's 300s event loop polling"
  type        = bool
  default     = true
}

variable "event_loop_interval" {
  description = "Seconds between Architect event loop polls"
  type        = number
  default     = 300
}

variable "architect_global_instance_id" {
  description = "Stable Mission-18 globalInstanceId for the Architect Agent entity. Generate once with uuidgen and keep in tfvars — changing this creates a new Agent and orphans the queue on the old agentId (use migrate_agent_queue to recover)."
  type        = string
}

variable "architect_labels" {
  description = "Mission-19 routing labels for the Architect Agent, as JSON string. Stamped on first Agent create and immutable (INV-AG1)."
  type        = string
  default     = "{\"env\":\"prod\"}"
}

# ── LLM ───────────────────────────────────────────────────────────────

variable "vertex_ai_location" {
  description = "Vertex AI location for Gemini model"
  type        = string
  default     = "global"
}

# ── IAM ───────────────────────────────────────────────────────────────

variable "hub_allow_unauthenticated" {
  description = "Allow unauthenticated access to Hub (app-level token handles auth)"
  type        = bool
  default     = true
}

variable "architect_allow_unauthenticated" {
  description = "Allow unauthenticated access to Architect (for chat interface)"
  type        = bool
  default     = true
}
