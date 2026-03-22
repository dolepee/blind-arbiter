#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-blindarbiter-worker}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%s)}"
IMAGE_TTL="${IMAGE_TTL:-12h}"
IMAGE_REGISTRY="${IMAGE_REGISTRY:-ttl.sh}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-worker/Dockerfile}"
BUILD_CONTEXT="${BUILD_CONTEXT:-.}"

IMAGE_REF="${IMAGE_REGISTRY}/${IMAGE_NAME}-${IMAGE_TAG}:${IMAGE_TTL}"

docker build --platform linux/amd64 -f "${DOCKERFILE_PATH}" -t "${IMAGE_REF}" "${BUILD_CONTEXT}"
docker push "${IMAGE_REF}"

DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${IMAGE_REF}")"

printf 'IMAGE_REF=%s\n' "${IMAGE_REF}"
printf 'IMAGE_DIGEST=%s\n' "${DIGEST}"
