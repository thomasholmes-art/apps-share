#!/usr/bin/env bash
# Restores box-office-estate's seed data (module 07, lab 07-hackathon-two-worlds):
# removes the database volume, so every seat sold during the lab is free
# again, and starts the estate. Run it from anywhere in the checkout.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose down -v && docker compose up -d
