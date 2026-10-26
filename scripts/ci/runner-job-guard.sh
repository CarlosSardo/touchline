#!/usr/bin/env bash
# Job-started hook of the self-hosted deploy runner (ACTIONS_RUNNER_HOOK_JOB_STARTED, installed by
# scripts/ci/install-runner.sh). The runner label is only routing: any workflow on any branch could ask for
# [self-hosted, touchline-deploy] and run as the host user. The runner runs this before any step of every job it
# picks up; a non-zero exit fails the job before a step runs. Only CD's deploy job from main is let through.
# The runner sets these variables from the job message GitHub sends; a workflow's env: does not reach the hook.
set -euo pipefail

allowed_repository=CarlosSardo/touchline
allowed_workflow_ref=CarlosSardo/touchline/.github/workflows/cd.yml@refs/heads/main
allowed_job=deploy
allowed_events=(workflow_run workflow_dispatch schedule)

repository=${GITHUB_REPOSITORY-}
workflow_ref=${GITHUB_WORKFLOW_REF-}
job=${GITHUB_JOB-}
event=${GITHUB_EVENT_NAME-}

reasons=()
[ -n "$repository" ] || reasons+=("GITHUB_REPOSITORY is not set")
[ -n "$workflow_ref" ] || reasons+=("GITHUB_WORKFLOW_REF is not set")
[ -n "$job" ] || reasons+=("GITHUB_JOB is not set")
[ -n "$event" ] || reasons+=("GITHUB_EVENT_NAME is not set")
if [ ${#reasons[@]} -eq 0 ]; then
  [ "$repository" = "$allowed_repository" ] || reasons+=("repository '$repository' is not $allowed_repository")
  [ "$workflow_ref" = "$allowed_workflow_ref" ] || reasons+=("workflow '$workflow_ref' is not $allowed_workflow_ref")
  [ "$job" = "$allowed_job" ] || reasons+=("job '$job' is not '$allowed_job'")
  allowed_event=false
  for e in "${allowed_events[@]}"; do
    if [ "$event" = "$e" ]; then allowed_event=true; fi
  done
  $allowed_event || reasons+=("event '$event' is not one of: ${allowed_events[*]}")
fi

if [ ${#reasons[@]} -eq 0 ]; then
  echo "runner-job-guard: allowed job '$job' of $workflow_ref ($event)"
  exit 0
fi
echo "::error title=Refused by the deploy runner's job guard::This runner only runs the '$allowed_job' job of $allowed_workflow_ref; see the 'Set up runner' log"
echo "runner-job-guard: REFUSED job '${job:-?}' of '${workflow_ref:-?}' (event '${event:-?}', repository '${repository:-?}')"
echo "runner-job-guard: this self-hosted runner only runs the '$allowed_job' job of $allowed_workflow_ref (events: ${allowed_events[*]}):"
for r in "${reasons[@]}"; do echo "runner-job-guard:   - $r"; done
exit 1
