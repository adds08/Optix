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

.PHONY: help dev up down restart build rebuild logs ps seed reset generate migrate push-dangerous studio psql shell test typecheck lint mobile

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

generate: ## Generate a migration from schema changes (commit the result)
	$(COMPOSE) exec api sh -c "cd /workspace/packages/db && pnpm generate"

migrate: ## Apply pending migrations — this is what runs on deploy
	$(COMPOSE) exec api sh -c "cd /workspace/packages/db && pnpm migrate"

# `drizzle-kit push` diffs the live database against the schema and applies the
# difference with no review step and no record. It is how a production column
# gets dropped silently. Change the schema, `make generate`, commit the SQL,
# `make migrate`.
push-dangerous: ## Escape hatch. Never point this at a real database.
	$(COMPOSE) exec api sh -c "cd /workspace/packages/db && pnpm push:dangerous --force"

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

dev: up ## Start web + api + db, then print next steps
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  All services are running."
	@echo ""
	@echo "  Web:     http://localhost:3100"
	@echo "  API:     http://localhost:4100 (health: /health)"
	@echo "  DB:      postgres://postgres:stinventory@localhost:5433/stinventory"
	@echo ""
	@echo "  Login:   admin@stinventory.local / stinventory-demo"
	@echo "           foreman.miguel@stinventory.local  (field layout)"
	@echo ""
	@echo "  Mobile:  make mobile        (Expo — separate terminal)"
	@echo "  Chat:    cd engine && .venv/bin/uvicorn main:app --port 4600"
	@echo "           (the intent engine is NOT a compose service)"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

mobile: ## Start the Expo app (apps/mobile) — run `make up` first
	@echo "Starting Expo. Make sure the API is up (\`make ENV=$(ENV) up\`)."
	@echo "A physical device needs to be on the same wifi as this machine;"
	@echo "the app derives the API host from the Expo dev server automatically."
	@cd apps/mobile && pnpm start
