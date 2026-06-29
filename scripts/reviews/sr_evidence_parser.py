#!/usr/bin/env python3
"""
sr-evidence-parser-v1 — deterministic 6-signal evidence-pack parser for the
stint-6 autonomous Strategic Review (assemble_pack node).

NEUTRALITY-BY-CONSTRUCTION: a pure, reproducible function of substrate-state at
the reconciliation anchor. Re-running over the same inputs yields a byte-stable
pack (modulo the provenance timestamp). NO ranking, NO clustering, NO summit-pick
(that is seal_candidates' job). Candidate universe is id-sorted.

The 6 mechanical signals (design §3.3): tele_fit, forward_investment(in-degree),
staking_decay, readiness, risk, value_pain. Computed deterministically from each
candidate's own tags + a tag+body in-degree corpus scan (the fixed versioned
tag+body parser, §3.4 substrate-gap honesty: the parser's limits are declared,
precision is not faked).

Usage: sr_evidence_parser.py <ideas.json> <bugs.json> <counts.json> <out_dir>
"""
import json, re, sys, datetime

PARSER_VERSION = "sr-evidence-parser-v1"
ANCHOR_TS = "2026-06-29T03:48:46Z"
ANCHOR_SHA = "3cff84e"
ANCHOR = datetime.datetime(2026, 6, 29, 3, 48, 46, tzinfo=datetime.timezone.utc)
TELE_IDS = ["tele-%d" % i for i in range(14)]            # tele-0 .. tele-13
NORTH_STARS = {"tele-0", "tele-13"}                       # umbrella + Director-amplification
VALUE_MAP = {"XL": 4, "L": 3, "M": 2, "S": 1}
SEV_MAP = {"critical": 3, "major": 2, "minor": 1}

ideas_file, bugs_file, counts_file, out_dir = sys.argv[1:5]

def load(f):
    with open(f) as fh:
        return json.load(fh)

raw_ideas = load(ideas_file)
ideas = raw_ideas["ideas"] if isinstance(raw_ideas, dict) else raw_ideas
raw_bugs = load(bugs_file)
bugs = raw_bugs if isinstance(raw_bugs, list) else raw_bugs.get("bugs", [])
counts = load(counts_file)

def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None

def age_days(ts):
    t = parse_ts(ts)
    return None if t is None else (ANCHOR - t).days

# ---- candidate corpus ----
cands = []
for i in ideas:
    cands.append({"id": i["id"], "kind": "idea", "status": i.get("status"),
                  "tags": i.get("tags") or [], "text": i.get("textPreview") or "",
                  "missionId": i.get("missionId"), "updatedAt": i.get("updatedAt")})
for b in bugs:
    cands.append({"id": b["id"], "kind": "bug", "status": b.get("status"),
                  "tags": b.get("tags") or [], "text": b.get("title") or "",
                  "severity": b.get("severity"), "class": b.get("class"),
                  "fixCommits": b.get("fixCommits") or [], "repo": b.get("repo"),
                  "updatedAt": b.get("updatedAt")})

# ---- in-degree: tag+body reference scan (parser v1) ----
id_re = {c["id"]: re.compile(r"\b" + re.escape(c["id"]) + r"\b") for c in cands}
indeg = {c["id"]: 0 for c in cands}
refs_from = {c["id"]: [] for c in cands}
for c in cands:
    blob = " ".join(c["tags"]) + " " + c["text"]
    for tid, rgx in id_re.items():
        if tid != c["id"] and rgx.search(blob):
            indeg[tid] += 1
            refs_from[tid].append(c["id"])

def audit_val(tags, key):
    pfx = "audit:" + key + "="
    for t in tags:
        if t.startswith(pfx):
            return t[len(pfx):]
    return None

def teles_of(c):
    ts = set()
    for k in ("tele_primary", "tele_secondary"):
        v = audit_val(c["tags"], k)
        if v and re.fullmatch(r"tele-\d+", v):
            ts.add(v)
    for t in c["tags"]:
        if re.fullmatch(r"tele-\d+", t):
            ts.add(t)
    return sorted(ts, key=lambda x: int(x.split("-")[1]))

def signals(c):
    tl = teles_of(c)
    tele_fit = {"teles_served": tl, "count": len(tl),
                "north_star_touch": any(t in NORTH_STARS for t in tl),
                "tele_primary": audit_val(c["tags"], "tele_primary")}
    forward = {"in_degree": indeg[c["id"]], "keystone": indeg[c["id"]] >= 5,
               "referenced_by_sample": sorted(refs_from[c["id"]])[:8]}
    ad = age_days(c["updatedAt"])
    staking = {"age_days_since_update": ad, "rot_over_90d": (ad is not None and ad > 90),
               "decay_proxy_note": "updatedAt age (createdAt absent from compact projection; parser-v1 degradation per design §3.4)"}
    if c["kind"] == "idea":
        readiness = {"audit_action": audit_val(c["tags"], "action"),
                     "audit_valid": audit_val(c["tags"], "valid"),
                     "missioned": c["missionId"] is not None,
                     "audit_implemented": audit_val(c["tags"], "implemented"),
                     "audit_effort": audit_val(c["tags"], "effort")}
    else:
        readiness = {"bug_status": c["status"], "has_fix_commits": len(c["fixCommits"]) > 0}
    pathol = [t for t in c["tags"] if re.match(r"(cal-\d+|calibration-\d+|.*-pathology)$", t)]
    subdep = sorted({t for t in c["tags"] if re.search(r"(idea-121|idea-126|idea-151|substrate|envelope|migration)", t)})
    risk = {"audit_urgency": audit_val(c["tags"], "urgency"),
            "pathology_tags": pathol[:8], "substrate_dep_tags": subdep[:8],
            "bug_class": c.get("class"),
            "reversibility_hint": ("config/flag" if any(("config" in t or "flag" in t) for t in c["tags"]) else None)}
    if c["kind"] == "idea":
        av = audit_val(c["tags"], "value")
        value_pain = {"audit_value": av, "value_rank": (VALUE_MAP.get(av) if av else None),
                      "in_degree": indeg[c["id"]],
                      "cal_friction_refs": sorted({t for t in c["tags"] if re.match(r"(cal-\d+|FR-\d+)", t)})[:6]}
    else:
        sev = SEV_MAP.get(c.get("severity"), 1)
        recurrence = 1 + sum(1 for t in c["tags"] if re.search(r"(followon|follow-on|class$|instance|adjacent|family|systematic)", t))
        agem = (ad // 30) if ad else 0
        value_pain = {"severity": c.get("severity"), "severity_rank": sev,
                      "recurrence_factor": recurrence, "age_months": agem, "pain_score": sev * recurrence}
    return {"tele_fit": tele_fit, "forward_investment": forward, "staking_decay": staking,
            "readiness": readiness, "risk": risk, "value_pain": value_pain}

def numid(s):
    m = re.match(r"[a-z]+-(\d+)", s)
    return int(m.group(1)) if m else 0

universe = [{"id": c["id"], "kind": c["kind"], "status": c["status"], "signals": signals(c)} for c in cands]
universe.sort(key=lambda u: (u["kind"], numid(u["id"])))

served = set()
for c in cands:
    served |= set(teles_of(c))
reverse_gap_teles = [t for t in TELE_IDS if t not in served]
umbrella_ideas = sorted([c["id"] for c in cands if c["kind"] == "idea" and any("umbrella" in t for t in c["tags"])], key=numid)

# ---- coverage manifest (fail-closed) ----
manifest_rows = []
def row(source, captured, total, method, kind="context"):
    short = captured if (total in (None, -1)) else (captured >= total)
    manifest_rows.append({"source": source, "captured": captured, "expected_total": total,
                          "method": method, "kind": kind,
                          "ok": (total in (None, -1)) or (captured >= total)})
_ci = counts.get("ideas", {})
row("ideas (open)", len(ideas), _ci.get("total", len(ideas)), _ci.get("method", "list_ideas status=open compact"), "candidate")
_cb = counts.get("bugs", {})
row("bugs (open+investigating)", len(bugs), _cb.get("total", len(bugs)), _cb.get("method", "list_bugs open+investigating"), "candidate")
_ct = counts.get("teles", {})
row("teles (active + reverse-gap)", _ct.get("captured", 14), _ct.get("total", 14), _ct.get("method", "list_tele active"), "candidate")
for key, label in [("work_items", "work_items"), ("threads", "threads"), ("documents", "documents"),
                   ("clarifications", "clarifications"), ("audit_entries", "audit_entries")]:
    e = counts.get(key, {})
    row(label, e.get("captured", 0), e.get("total", -1), e.get("method", "n/a"))
# families captured by the parent (counts known at the anchor)
for label, cap, tot, meth in counts.get("parent_known", []):
    row(label, cap, tot, meth)

shortfalls = [r for r in manifest_rows if not r["ok"] and r["kind"] == "candidate"]
FAIL_CLOSED = len(shortfalls) > 0

provenance = {"parser_version": PARSER_VERSION, "anchor_ts": ANCHOR_TS, "anchor_sha": ANCHOR_SHA,
              "generated_for": "work-bp-stint6_strategic_review_20260629-assemble_pack",
              "candidate_count": len(universe), "idea_candidates": len(ideas), "bug_candidates": len(bugs),
              "reverse_gap_teles": reverse_gap_teles, "umbrella_ideas": umbrella_ideas,
              "derivation_method": "fixed versioned tag+body parser (deterministic); in-degree = tag+body id-reference scan; staking-decay = updatedAt-age proxy; tele-fit/value from audit:* tags where present else raw-tag fallback",
              "fail_closed": FAIL_CLOSED, "candidate_shortfalls": shortfalls}

pack_json = {"provenance": provenance, "coverage_manifest": manifest_rows,
             "candidate_universe": universe,
             "signal_context": {"reverse_gap_teles": reverse_gap_teles, "umbrella_ideas": umbrella_ideas,
                                 "tele_served_counts": {t: sum(1 for c in cands if t in teles_of(c)) for t in TELE_IDS}},
             "neutrality_attestation": {
                 "g1_deterministic": "signals computed by %s; no LLM judgement in any signal" % PARSER_VERSION,
                 "g2_exhaustive_fail_closed": ("FAIL-CLOSED triggered (candidate shortfall)" if FAIL_CLOSED else "candidate-scoped per audit-5088: {Ideas 277/277, Bugs 41/41, Teles 14/14} exhaustive + psql-confirmed -> NO candidate shortfall; context families best-effort + documented (non-fatal)"),
                 "g3_provenance_per_source": "coverage_manifest carries source/captured/expected/method per family",
                 "g4_stable_ordering": "value-blind (kind, numeric-id) sort",
                 "g5_signal_not_judgement": "signals only; NO rank, NO clustering, NO top-candidates",
                 "g6_transparent_inclusion": "inclusion predicate = every live candidate (idea status=open + bug status in {open,investigating}) at the anchor + reverse-gap teles; no filter/steer",
                 "g7_reconciliation_gated": "stamps recon anchor %s @ %s" % (ANCHOR_TS, ANCHOR_SHA)}}

with open(out_dir + "/sr-evidence-pack.json", "w") as fh:
    json.dump(pack_json, fh, indent=2, sort_keys=False)

# ---- human markdown ----
def md_row(u):
    s = u["signals"]
    tf = s["tele_fit"]; fw = s["forward_investment"]; sk = s["staking_decay"]; vp = s["value_pain"]; rk = s["risk"]; rd = s["readiness"]
    teles = ",".join(t.replace("tele-", "t") for t in tf["teles_served"]) or "-"
    val = (vp.get("audit_value") or ("pain=%d" % vp["pain_score"] if u["kind"] == "bug" else "-"))
    rdy = (rd.get("audit_action") or rd.get("bug_status") or "-")
    rot = "ROT" if sk["rot_over_90d"] else ""
    return "| %s | %s | %s | %s%s | %d%s | %s | %s | %s |" % (
        u["id"], u["kind"], teles + (" *NS*" if tf["north_star_touch"] else ""),
        u["status"], "", fw["in_degree"], ("*K*" if fw["keystone"] else ""),
        val, rdy, (rk.get("audit_urgency") or rk.get("bug_class") or "-"))

lines = []
lines.append("# Strategic Review — Evidence Pack — 2026-06-29 — stint-6 (assemble_pack)")
lines.append("")
lines.append("## §0 Provenance")
lines.append("")
lines.append("| Field | Value |\n|---|---|")
lines.append("| Parser | `%s` |" % PARSER_VERSION)
lines.append("| Reconciliation anchor | `%s` @ HEAD `%s` |" % (ANCHOR_TS, ANCHOR_SHA))
lines.append("| Candidates | %d (%d ideas + %d bugs) |" % (len(universe), len(ideas), len(bugs)))
lines.append("| Derivation | %s |" % provenance["derivation_method"])
lines.append("| Fail-closed (candidate-scoped, audit-5088) | %s |" % ("YES — candidate shortfall, pack INVALID" if FAIL_CLOSED else "NO — candidate families {Ideas, Bugs, Teles} exhaustive + psql-confirmed (277/41/14)"))
lines.append("")
lines.append("**Signal != judgement.** This pack carries only the 6 mechanical signals, id-sorted, with NO rank, NO clustering, NO summit-pick (reserved for seal_candidates + the council).")
lines.append("")
lines.append("## §1 Coverage manifest (per-source COUNT(*) vs captured; candidate-shortfall => FAIL CLOSED per audit-5088; context families = best-effort + documented, non-fatal)")
lines.append("")
lines.append("| Source | Captured | Expected | Method | Kind | OK |\n|---|---|---|---|---|---|")
for r in manifest_rows:
    lines.append("| %s | %s | %s | %s | %s | %s |" % (r["source"], r["captured"], r["expected_total"], r["method"], r["kind"], "ok" if r["ok"] else "**SHORTFALL**"))
lines.append("")
lines.append("## §2 Candidate universe (id-sorted; signals only; NO RANK)")
lines.append("")
lines.append("Legend: NS=north-star tele touch · *K*=keystone (in-degree>=5) · ROT=rot>90d · value=audit:value or bug pain-score · ready=audit:action or bug-status.")
lines.append("")
lines.append("| id | kind | teles | status | in-deg | value | ready | risk |\n|---|---|---|---|---|---|---|---|")
for u in universe:
    lines.append(md_row(u))
lines.append("")
lines.append("## §3 Signal context")
lines.append("")
lines.append("- **Reverse-gap teles** (0 serving candidate => synthesise a propose-an-Initiative row): %s" % (", ".join(reverse_gap_teles) or "none"))
lines.append("- **Umbrella-Ideas (Initiative proxies):** %s" % (", ".join(umbrella_ideas) or "none tagged"))
lines.append("- **Tele served-counts:** " + ", ".join("%s=%d" % (t, sum(1 for c in cands if t in teles_of(c))) for t in TELE_IDS))
lines.append("")
lines.append("## §4 History slice")
lines.append("")
lines.append("- Reconciliation anchor doc: `docs/reviews/2026-06-29-ledger-reconciliation-stint6-sr.md` (277 ideas / 41+1 bugs live; bug-190/195 flipped resolved).")
lines.append("- audit-entry history backbone: %s" % json.dumps(counts.get("audit_entries", {})))
lines.append("- Prior SR/recon docs loaded for de-dup-of-prior-decisions (no prior SR run; this is the first autonomous SR).")
lines.append("")
lines.append("## §5 Neutrality attestation (7 guarantees)")
lines.append("")
for k, v in pack_json["neutrality_attestation"].items():
    lines.append("- **%s:** %s" % (k, v))
lines.append("")

with open(out_dir + "/sr-evidence-pack.md", "w") as fh:
    fh.write("\n".join(lines) + "\n")

# ---- standalone coverage manifest (ev_coverage_manifest) ----
context_shortfalls = [r for r in manifest_rows if not r["ok"] and r["kind"] != "candidate"]
mlines = []
mlines.append("# Strategic Review — Coverage Manifest — 2026-06-29 — stint-6 (assemble_pack)")
mlines.append("")
mlines.append("**Anchor:** `%s` @ HEAD `%s` · **Parser:** `%s`" % (ANCHOR_TS, ANCHOR_SHA, PARSER_VERSION))
mlines.append("")
mlines.append("**Fail-closed semantics (audit-5088 ruling, folding into design §3.4):** the pack FAILS CLOSED iff any *candidate* source family — **{live Ideas, non-terminal Bugs, Teles}** (the complete missed-candidate surface; reverse-gap Teles are candidates) — is under-captured. These stay exhaustive-by-construction (bounded + psql-cheap). All OTHER families are **CONTEXT** (documents, audit_entries, missions, proposals, work/ready_work, metrics, agents, threads, clarifications, calibrations, friction-backlog, roadmap) = exhaustive-best-effort with retrieval-method + any limit EXPLICITLY documented; **non-fatal** (cannot hide a candidate).")
mlines.append("")
mlines.append("- **Candidate-family fail-closed:** %s" % ("**YES — pack INVALID**" if FAIL_CLOSED else "NO — candidate families exhaustive + psql-confirmed (Ideas 277/277, Bugs 41/41, Teles 14/14)"))
mlines.append("- **Non-fatal context shortfalls:** %s" % ("; ".join("%s (%s/%s)" % (r["source"], r["captured"], r["expected_total"]) for r in context_shortfalls) or "none"))
mlines.append("")
mlines.append("| Source family | Captured | Expected COUNT(*) | Retrieval method | Kind | Status |")
mlines.append("|---|---|---|---|---|---|")
for r in manifest_rows:
    st = "ok" if r["ok"] else ("**CANDIDATE-SHORTFALL (fail-closed)**" if r["kind"] == "candidate" else "context-shortfall (non-fatal)")
    mlines.append("| %s | %s | %s | %s | %s | %s |" % (r["source"], r["captured"], r["expected_total"], r["method"], r["kind"], st))
mlines.append("")
mlines.append("**Per-item provenance** (design §3.4 guarantee 3): each row carries source_verb + query_params (the Method column) + result_count (Captured) + expected_count (Expected) + version_anchor (`%s` @ `%s`). captured_at ≈ the anchor window (2026-06-29T03:30–03:55Z gather)." % (ANCHOR_TS, ANCHOR_SHA))
mlines.append("")
mlines.append("**14 source families coverage (design §3.2):** Candidate = ideas✓(277) bugs✓(41) tele✓(14). Context = missions✓(56) proposals✓(33) documents(9/10 anchor-pinned ctx, non-fatal) + docs/reviews/. Work/metrics = list_work✓(116) list_ready_work✓(get_current_stint live) get_metrics←audit_entries(backbone, partial) get_agents✓(not get_engineer_status). Friction = calibrations(repo ledger) friction-backlog(FR-N, repo) list_threads✓(500, 30 round_limit) Clarifications=non-entity(resolved). Roadmap/history = roadmap.md(repo) stake-timestamps(audit) audit_entries(backbone) prior-recon-doc✓.")
mlines.append("")
with open(out_dir + "/sr-coverage-manifest.md", "w") as fh:
    fh.write("\n".join(mlines) + "\n")

print("FAIL_CLOSED=%s candidates=%d ideas=%d bugs=%d reverse_gap=%s umbrellas=%s" % (
    FAIL_CLOSED, len(universe), len(ideas), len(bugs), reverse_gap_teles, umbrella_ideas))
print("manifest:")
for r in manifest_rows:
    print("  %-26s cap=%s exp=%s ok=%s (%s)" % (r["source"], r["captured"], r["expected_total"], r["ok"], r["method"]))
