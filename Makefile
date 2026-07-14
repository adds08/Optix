# STInventory — top-level Makefile.
# Usage:
#   make ENV=local up        # build + start postgres + api + web
#   make ENV=local seed      # populate sample data
#   make ENV=local logs      # tail logs
#   make ENV=local down      # stop and remove containers
#   make ENV=local reset     # wipe DB volume and reseed (destructive)
#   make ENV=local psql      # psql shell on the DB
#   make ENV=local test      # run vitest in api container

ENV ?= local
ENV_FILE := .env.$(ENV)

ifeq (,$(wildcard $(ENV_FILE)))
$(error Missing $(ENV_FILE) — copy .env.local and edit, or pass ENV=local)
endif

COMPOSE := docker compose --env-file $(ENV_FILE)
SVC ?= api

.DEFAULT_GOAL := help

.PHONY: help up down restart build rebuild logs ps seed reset push migrate studio psql shell test typecheck lint engine mobile

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "; printf "\nSTInventory — make targets (ENV=$(ENV)):\n\n"} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

up: ## Build + start postgres, api, web (detached)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  api  → http://localhost:4100  (health: /health)"
	@echo "  web  → http://localhost:3100"
	@echo "  db   → postgres://postgres:stinventory@localhost:5433/stinventory"
	@echo ""
	@echo "  next: \`make seed\` to populate sample data."

build: ## Build images without starting
	$(COMPOSE) build

rebuild: ## Force rebuild images (no cache)
	$(COMPOSE) build --no-cache

down: ## Stop and remove containers (keeps DB volume)
	$(COMPOSE) down

restart: down up ## Down + up

logs: ## Tail logs from all services
	$(COMPOSE) logs -f --tail=100

ps: ## Show running containers
	$(COMPOSE) ps

seed: ## Populate sample data (idempotent; SEED_RESET=1 to wipe first)
	$(COMPOSE) exec api sh -c "cd /workspace/packages/db && pnpm seed"

push: ## Apply Drizzle schema to DB
	$(COMPOSE) exec api sh -c "cd /workspace/packages/db && pnpm push --force"

migrate: ## Apply existing migrations
	$(COMPOSE) exec api sh -c "cd /workspace/packages/db && pnpm migrate"

studio: ## Open Drizzle Studio
	$(COMPOSE) exec api sh -c "cd /workspace/packages/db && pnpm studio"

reset: ## Wipe DB volume + restart + reseed (DESTRUCTIVE)
	$(COMPOSE) down -v
	$(MAKE) up
	@echo "[reset] waiting for api to start…"
	@sleep 6
	$(MAKE) seed

test: ## Run vitest inside the api container
	$(COMPOSE) exec api sh -c "cd /workspace && pnpm test"

typecheck: ## Run typecheck inside the api container
	$(COMPOSE) exec api sh -c "cd /workspace && pnpm typecheck"

lint: ## Run lint inside the api container
	$(COMPOSE) exec api sh -c "cd /workspace && pnpm lint"

psql: ## Open psql against the DB
	$(COMPOSE) exec postgres psql -U postgres -d stinventory

engine: ## Start the Python AI engine (uvicorn, port 4600)
	@echo "Starting AI engine at http://localhost:4600 ..."
	@cd engine && .venv/bin/uvicorn main:app --port 4600 --reload

mobile: ## Start the Expo mobile app (apps/mobile)
	@cd apps/mobile && EXPO_PUBLIC_API_URL=$${MOBILE_API_URL:-http://localhost:4100} pnpm dev
