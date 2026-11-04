#!/usr/bin/env bash
# GitFill on Google Cloud: one-time infrastructure setup.
#
# Run in Cloud Shell (gcloud is preinstalled and logged in).
# Every section can be re-run safely; steps are added as we go.
#
# Usage:
#   PROJECT_ID=your-project-id bash deploy/gcp/setup.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID, e.g. PROJECT_ID=gitfill-prod-123}"
REGION="${REGION:-asia-south1}"

# ---------------------------------------------------------------------------
# Step 1: project config and APIs
# (Create the project and link billing in the console first.)
# ---------------------------------------------------------------------------
gcloud config set project "$PROJECT_ID"
gcloud config set run/region "$REGION"

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  compute.googleapis.com \
  servicenetworking.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com

gcloud config list
