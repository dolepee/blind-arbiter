#!/usr/bin/env bash
set -euo pipefail

IMAGE_REF="${1:-${ECLOUD_IMAGE_REF:-}}"

if [[ -z "${IMAGE_REF}" ]]; then
  echo "ECLOUD_IMAGE_REF is required, or pass the image ref as the first argument." >&2
  exit 1
fi

APP_NAME="${ECLOUD_NAME:-blind-arbiter-worker}"
DEPLOY_ENV="${ECLOUD_ENV:-sepolia}"
INSTANCE_TYPE="${ECLOUD_INSTANCE_TYPE:-g1-micro-1v}"
ENV_FILE_PATH="${ECLOUD_ENVFILE_PATH:-.env.ecloud}"
DOCKERFILE_PATH="${ECLOUD_DOCKERFILE_PATH:-worker/Dockerfile}"
LOG_VISIBILITY="${ECLOUD_LOG_VISIBILITY:-public}"
RESOURCE_USAGE_MONITORING="${ECLOUD_RESOURCE_USAGE_MONITORING:-enable}"

ecloud compute app deploy \
  --environment "${DEPLOY_ENV}" \
  --name "${APP_NAME}" \
  --image-ref "${IMAGE_REF}" \
  --dockerfile "${DOCKERFILE_PATH}" \
  --env-file "${ENV_FILE_PATH}" \
  --log-visibility "${LOG_VISIBILITY}" \
  --resource-usage-monitoring "${RESOURCE_USAGE_MONITORING}" \
  --instance-type "${INSTANCE_TYPE}" \
  --skip-profile
