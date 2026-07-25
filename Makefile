# STInventory — top-level Makefile.
# Usage:
#   make dev                # run everything (docker + print mobile cmd)
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

.PHONY: help dev up down restart build rebuild logs ps seed reset push migrate studio psql shell test typecheck lint mobile

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "; printf "\nSTInventory — make targets (ENV=$(ENV)):\n\n"} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

up: ## Build + start postgres, api, web, desktop (detached)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  api      → http://localhost:4100  (health: /health)"
	@echo "  web      → http://localhost:3100  (Next.js - shadcn new-york)"
	@echo "  db       → postgres://postgres:stinventory@localhost:5433/stinventory"
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

dev: up desktop-build ## Build Flutter + start everything
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  All services are running!"
	@echo ""
	@echo "  Web:     http://localhost:3100  (Next.js - shadcn new-york)"
	@echo "  API:     http://localhost:4100 (health: /health)"
	@echo "  DB:      postgres://postgres:stinventory@localhost:5433/stinventory"
	@echo ""
	@echo "  Login:   admin@stinventory.local / stinventory-demo"
	@echo ""
	@echo "  To set up LLM intent parsing, add LLM_API_KEY to .env.local"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

	@cd apps/desktop && flutter build web --dart-define=API_URL=http://localhost:4100

	@cd apps/desktop && flutter run -d web-server --web-port 3200 --dart-define=API_URL=http://localhost:4100

mobile: ## Start the Flutter app (apps/mobile)
	@echo "Starting Flutter app — ensure 'make dev' is running first."
	@echo "API URL: $${API_URL:-http://localhost:4100}"
	@cd apps/mobile && flutter run --dart-define=API_URL=$${API_URL:-http://localhost:4100}
