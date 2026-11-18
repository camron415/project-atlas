#!/usr/bin/env bash
# Curated knowledge pack for xAI Voice Agent Builder Collections.
# Re-run anytime before uploading: ./scripts/export-phone-agent-knowledge.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_RAW="${1:-${ROOT}/server/data/phone-agent-knowledge}"
# Resolve relative OUT against ROOT so callers can't accidentally write atlas/data/...
if [[ "${OUT_RAW}" = /* ]]; then
  OUT="${OUT_RAW}"
else
  OUT="$(cd "${ROOT}" && pwd)/${OUT_RAW#./}"
fi
# If caller passed server-relative ./data/..., prefer server/data
if [[ "${OUT}" == "${ROOT}/data/phone-agent-knowledge" ]]; then
  OUT="${ROOT}/server/data/phone-agent-knowledge"
fi
HOME_DIR="${HOME}"

ATLAS="${ROOT}"
VL=""
for cand in \
  "${HOME_DIR}/Library/Mobile Documents/com~apple~CloudDocs/Documents/Macbook-Documents/vocalLearn" \
  "${HOME_DIR}/Documents/Macbook-Documents/vocalLearn" \
  "${HOME_DIR}/Documents/Macbook-Documents/projects/vocalLearn"; do
  [[ -d "${cand}" ]] && VL="${cand}" && break
done
CAREER=""
for cand in \
  "${HOME_DIR}/Documents/career-planning-roadmap" \
  "${HOME_DIR}/Documents/Macbook-Documents/projects/career-planning-roadmap"; do
  [[ -d "${cand}" ]] && CAREER="${cand}" && break
done
CD="${CAREER}/career-dashboard"

rm -rf "${OUT}"
mkdir -p "${OUT}"/{00-meta,01-camron,02-atlas,03-vocallearn,04-career,05-status}

copy_if() {
  local src="$1"
  local dest="$2"
  if [[ -f "${src}" ]]; then
    mkdir -p "$(dirname "${OUT}/${dest}")"
    cp "${src}" "${OUT}/${dest}"
    echo "  + ${dest}"
  else
    echo "  - missing: ${src}"
  fi
}

# HANDOFF/ROADMAP stay in the pack as history. Phone Atlas must not treat them as current.
stamp_historical() {
  local file="$1"
  [[ -f "${file}" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  {
    echo "> **Historical only.** For what Camron is doing *this week*, read \`00-LATEST.md\` and dated \`05-status/*\` inbox files. If they disagree with this document, LATEST wins."
    echo ""
    cat "${file}"
  } > "${tmp}"
  mv "${tmp}" "${file}"
}

# Newest N matching files → dest_prefix-basename
copy_newest() {
  local dir="$1"
  local pattern="$2"
  local dest_dir="$3"
  local n="${4:-5}"
  local prefix="${5:-}"
  [[ -d "${dir}" ]] || return 0
  local count=0
  local f base dest
  shopt -s nullglob
  local -a files=("${dir}"/${pattern})
  shopt -u nullglob
  ((${#files[@]})) || return 0
  # shellcheck disable=SC2012
  while IFS= read -r f; do
    [[ -f "${f}" ]] || continue
    count=$((count + 1))
    [[ "${count}" -gt "${n}" ]] && break
    base="$(basename "${f}")"
    dest="${dest_dir}/${prefix}${base}"
    mkdir -p "$(dirname "${OUT}/${dest}")"
    cp "${f}" "${OUT}/${dest}"
    echo "  + ${dest}"
  done < <(ls -t "${files[@]}")
}

echo "Exporting phone-agent knowledge → ${OUT}"
echo ""
echo "== Camron / identity =="
copy_if "${ATLAS}/docs/PERSONA.md" "01-camron/atlas-PERSONA.md"
copy_if "${ATLAS}/docs/LEARNING_LEDGER.md" "01-camron/atlas-LEARNING_LEDGER.md"
copy_if "${ATLAS}/docs/LEARNING_TUTOR.md" "01-camron/atlas-LEARNING_TUTOR.md"
if [[ -d "${CD}" ]]; then
  copy_if "${CD}/docs/MY_STORY.md" "01-camron/MY_STORY.md"
  copy_if "${CD}/docs/LEARNING_LEDGER.md" "01-camron/career-LEARNING_LEDGER.md"
  copy_if "${CD}/docs/LINKEDIN_AND_EDUCATION.md" "01-camron/LINKEDIN_AND_EDUCATION.md"
  copy_if "${CD}/docs/COMPASS_INTERVIEW_PREP.md" "01-camron/COMPASS_INTERVIEW_PREP.md"
  copy_if "${CD}/lib/resume-data.ts" "01-camron/resume-data.ts"
fi

echo ""
echo "== Atlas =="
copy_if "${ATLAS}/README.md" "02-atlas/README.md"
copy_if "${ATLAS}/docs/HANDOFF.md" "02-atlas/HANDOFF.md"
copy_if "${ATLAS}/docs/ROADMAP.md" "02-atlas/ROADMAP.md"
copy_if "${ATLAS}/docs/WEEK_STATUS.md" "02-atlas/WEEK_STATUS.md"
copy_if "${ATLAS}/docs/PHASE_2_KICKOFF.md" "02-atlas/PHASE_2_KICKOFF.md"
copy_if "${ATLAS}/docs/PHASE_1_75.md" "02-atlas/PHASE_1_75.md"
copy_if "${ATLAS}/docs/PHONE_VOICE_AGENT.md" "02-atlas/PHONE_VOICE_AGENT.md"
copy_if "${ATLAS}/docs/CURSOR_PROJECT_SYNC.md" "02-atlas/CURSOR_PROJECT_SYNC.md"
copy_if "${ATLAS}/docs/VOICE_ECONOMY.md" "02-atlas/VOICE_ECONOMY.md"
copy_if "${ATLAS}/docs/PROJECT_REGISTRY.md" "02-atlas/PROJECT_REGISTRY.md"
copy_if "${ATLAS}/projects.registry.json" "02-atlas/projects.registry.json"
copy_if "${ATLAS}/docs/managers/ATLAS_POLICY.md" "02-atlas/managers-ATLAS_POLICY.md"
copy_if "${ATLAS}/docs/managers/PERSONAS.md" "02-atlas/managers-PERSONAS.md"
copy_newest "${ATLAS}/inbox" "*morning*.md" "05-status" 5 "atlas-inbox-"
# Non-morning planning notes (skip duplicate morning briefs)
if [[ -d "${ATLAS}/inbox" ]]; then
  count=0
  ls -t "${ATLAS}/inbox"/*.md 2>/dev/null | while read -r f; do
    base="$(basename "${f}")"
    [[ "${base}" == *morning* ]] && continue
    count=$((count + 1))
    [[ "${count}" -gt 4 ]] && break
    cp "${f}" "${OUT}/05-status/atlas-inbox-${base}"
    echo "  + 05-status/atlas-inbox-${base}"
  done
fi

echo ""
echo "== VocalLearn =="
if [[ -n "${VL}" ]]; then
  copy_if "${VL}/README.md" "03-vocallearn/README.md"
  copy_if "${VL}/HANDOFF.md" "03-vocallearn/HANDOFF.md"
  copy_if "${VL}/ROADMAP.md" "03-vocallearn/ROADMAP.md"
  stamp_historical "${OUT}/03-vocallearn/HANDOFF.md"
  stamp_historical "${OUT}/03-vocallearn/ROADMAP.md"
  stamp_historical "${OUT}/03-vocallearn/README.md"
  copy_if "${VL}/CURSOR_START_PROMPT.md" "03-vocallearn/CURSOR_START_PROMPT.md"
  copy_if "${VL}/docs/HALO_PRICING_AND_SCALING.md" "03-vocallearn/HALO_PRICING_AND_SCALING.md"
  copy_if "${ATLAS}/docs/managers/VOCALLEARN_POLICY.md" "03-vocallearn/managers-VOCALLEARN_POLICY.md"
  copy_newest "${VL}/inbox" "*.md" "05-status" 14 "vocallearn-inbox-"
  if [[ -d "${VL}/atlas-personal-context/voice-notes" ]]; then
    for f in "${VL}/atlas-personal-context/voice-notes/"*.md; do
      [[ -f "${f}" ]] || continue
      base="$(basename "${f}")"
      copy_if "${f}" "03-vocallearn/atlas-personal-context-voice-notes-${base}"
    done
    copy_if "${VL}/atlas-personal-context/README.md" "03-vocallearn/atlas-personal-context-README.md"
    copy_if "${VL}/archive/chats/INDEX.md" "03-vocallearn/archive-chats-INDEX.md"
  fi
else
  echo "  - VocalLearn not found"
fi

echo ""
echo "== Career =="
if [[ -n "${CAREER}" ]]; then
  copy_if "${CAREER}/README.md" "04-career/README.md"
  copy_if "${CAREER}/project-foundation.md" "04-career/project-foundation.md"
  copy_if "${CAREER}/CLOUD_HANDOFF.md" "04-career/CLOUD_HANDOFF.md"
  copy_if "${CAREER}/conversation-log.md" "04-career/conversation-log.md"
  # Skip back-from-cloud-handoff.md (~100KB raw dump) — CLOUD_HANDOFF is enough
  if [[ -d "${CD}" ]]; then
    copy_if "${CD}/README.md" "04-career/dashboard-README.md"
    copy_if "${CD}/docs/CAREER_PROJECT_SYNC.md" "04-career/CAREER_PROJECT_SYNC.md"
    copy_if "${CD}/docs/APPLY_WEEK.md" "04-career/APPLY_WEEK.md"
    copy_if "${CD}/docs/APPLY_RESEARCH.md" "04-career/APPLY_RESEARCH.md"
    copy_if "${CD}/docs/CATEGORY_A_LOCAL_BRIEF.md" "04-career/CATEGORY_A_LOCAL_BRIEF.md"
    copy_if "${CD}/docs/HAUL_AUG13.md" "04-career/HAUL_AUG13.md"
    copy_if "${CD}/docs/OPPORTUNITY_RESEARCH.md" "04-career/OPPORTUNITY_RESEARCH.md"
    copy_if "${ATLAS}/docs/managers/CAREER_POLICY.md" "04-career/managers-CAREER_POLICY.md"
  fi
else
  echo "  - career-planning-roadmap not found"
fi

# --- Generated / restored meta files ---
TODAY="$(date +%Y-%m-%d)"

# Prefer canonical instructions in docs/ (do not clobber with an outdated heredoc)
INSTR_SRC="${ATLAS}/docs/ATLAS_PHONE_AGENT_INSTRUCTIONS.md"
if [[ -f "${INSTR_SRC}" ]]; then
  copy_if "${INSTR_SRC}" "00-meta/00-ATLAS-PHONE-AGENT.md"
  cp "${OUT}/00-meta/00-ATLAS-PHONE-AGENT.md" "${OUT}/00-ATLAS-PHONE-AGENT.md"
  echo "  + 00-ATLAS-PHONE-AGENT.md (from docs)"
else
  echo "  - missing docs/ATLAS_PHONE_AGENT_INSTRUCTIONS.md — skipping phone instructions"
fi

# Placeholder WHERE_WE_LEFT_OFF — refresh-phone-knowledge overwrites with live git
cat > "${OUT}/05-status/WHERE_WE_LEFT_OFF.md" <<EOF
# Where we left off — ${TODAY}

Run \`cd server && npm run refresh-phone-knowledge\` after Cursor sessions to refresh this file from live git + session notes.
Until then, use project HANDOFF/ROADMAP files in this pack and recent \`05-status/*\` inbox copies.
EOF
echo "  + 05-status/WHERE_WE_LEFT_OFF.md"

# Manifest
{
  echo "# Phone agent knowledge manifest"
  echo "Exported: ${TODAY}"
  echo ""
  echo "## Upload / sync"
  echo "Preferred: \`cd server && npm run refresh-phone-knowledge\` (exports + Collection sync)."
  echo "Manual: upload all files under this folder in Voice Agent Builder."
  echo ""
  echo "## Files"
  find "${OUT}" -type f | sed "s|^${OUT}/||" | sort | sed 's/^/- /'
} > "${OUT}/00-meta/MANIFEST.md"
echo "  + 00-meta/MANIFEST.md"

cp "${OUT}/05-status/WHERE_WE_LEFT_OFF.md" "${OUT}/WHERE_WE_LEFT_OFF.md"

# Plain-text resume (better retrieval than .ts alone)
if [[ -d "${CD}" ]] && command -v npx >/dev/null 2>&1; then
  RESUME_OUT="${OUT}/01-camron/RESUME.md"
  mkdir -p "$(dirname "${RESUME_OUT}")"
  (
    cd "${CD}" && npx --yes tsx -e '
import { getResumeSnapshot } from "./lib/resume-data.ts";
import fs from "fs";
const s = getResumeSnapshot();
const out = process.argv[1];
const text = [`# ${s.candidateName} — Resume (control)`,``,`${s.location} | ${s.email} | ${s.phone}`,s.workAuthorization,``,`## Summary`,s.summary,``,`## Skills`,s.coreSkills.join(", "),``,`## Projects`,...s.projects.flatMap(p => [`### ${p.name}`,...p.bullets.map(b => `- ${b}`),``]),`## Experience`,...s.experience.flatMap(e => [`### ${e.role} — ${e.company}`,`${e.period} · ${e.location}`,...e.bullets.map(b => `- ${b}`),``]),`## Full plain text`,s.genericResumeText].join("\n");
fs.writeFileSync(out, text);
' "${RESUME_OUT}"
  ) && echo "  + 01-camron/RESUME.md" || echo "  - resume markdown generation skipped"
fi

FILE_COUNT="$(find "${OUT}" -type f | wc -l | tr -d ' ')"
BYTES="$(du -sh "${OUT}" | awk '{print $1}')"
echo ""
echo "Done: ${FILE_COUNT} files, ${BYTES}"
echo "Upload folder:"
echo "  ${OUT}"
echo "Or sync Collection:"
echo "  cd server && npm run refresh-phone-knowledge"
