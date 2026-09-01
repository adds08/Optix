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
#
# Two droplets, nothing here needs ENV:
#   make deploy               # ship main to production (urban.optixtec.com)
#   make prod-status          # what is running there
#   make prod-logs            # tail its logs
#   make dev-deploy           # ship development to dev (urban.bodhitechlabs.com)
#   make dev-status           # what is running there
#   make dev-logs             # tail its logs

# --- production droplet (optix-prod-app-01, urban.optixtec.com) --------------
# Overridable, but these are the real values so `make deploy` works unconfigured.
PROD_HOST ?= 157.245.129.195
PROD_USER ?= root
PROD_KEY  ?= $(HOME)/.ssh/do@it_urban
PROD_URL  ?= https://urban.optixtec.com
PROD_SSH  := ssh -o ConnectTimeout=20 -i $(PROD_KEY) $(PROD_USER)@$(PROD_HOST)
PROD_DIR  := /opt/stinventory
PROD_COMPOSE := cd $(PROD_DIR) && docker compose -f docker-compose.prod.yml --env-file .env.production

# --- dev/test droplet (optix-dev-app-01, urban.bodhitechlabs.com) ------------
DEV_HOST ?= 68.183.27.164
DEV_USER ?= root
DEV_KEY  ?= $(HOME)/.ssh/do@it_urban
DEV_URL  ?= https://urban.bodhitechlabs.com
DEV_SSH  := ssh -o ConnectTimeout=20 -i $(DEV_KEY) $(DEV_USER)@$(DEV_HOST)
DEV_DIR  := /opt/stinventory
DEV_COMPOSE := cd $(DEV_DIR) && docker compose -f docker-compose.prod.yml --env-file .env.production

ENV ?= local
ENV_FILE := .env.$(ENV)

ifeq (,$(wildcard $(ENV_FILE)))
$(error Missing $(ENV_FILE) — copy .env.local and edit, or pass ENV=local)
endif

COMPOSE := docker compose --env-file $(ENV_FILE)
SVC ?= api

.DEFAULT_GOAL := help

# `e2e` and `e2e-install` MUST be listed here: there is a directory called
# `e2e/`, so without .PHONY make sees a target that is already satisfied by a
# file of the same name and prints "'e2e' is up to date" without running
# anything. The browser suite silently did not run for anyone invoking it
# through make. CI calls playwright directly, so CI never noticed.
.PHONY: help dev up down restart build rebuild logs ps seed reset generate migrate push-dangerous studio psql shell test typecheck lint e2e e2e-install mobile deploy prod-status prod-logs prod-shell dev-deploy dev-status dev-logs dev-shell

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "; printf "\nSTInventory — make targets (ENV=$(ENV)):\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

up: ## Build + start postgres, api, web (detached); seeds on first boot
	$(COMPOSE) up -d --build
	@$(COMPOSE) exec -T api sh -c "cd /workspace/packages/db && pnpm seed" >/dev/null 2>&1 || true
	@echo ""
	@echo "  api      → http://localhost:4100  (health: /health)"
	@echo "  web      → http://localhost:3100  (Next.js - shadcn new-york)"
	@echo "  db       → postgres://postgres:stinventory@localhost:5433/stinventory"
	@echo ""
	@echo "  seeded sample data (idempotent — skips if the tenant already exists)."

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

e2e: ## Run the browser suite against the running stack (STI-001)
	@# Deliberately NOT inside the api container. The suite drives a browser
	@# against web:3100 and api:4100 from OUTSIDE, which is the only way to
	@# test the stack rather than a process's opinion of itself — and the
	@# container has no browser. `make ENV=local up` must be running.
	pnpm --dir e2e exec playwright test

e2e-install: ## One-time: fetch the Chromium the browser suite drives
	pnpm --dir e2e exec playwright install chromium

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
	@echo "  Chat:    configure a model at /settings, then use /chat"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

mobile: ## Start the Expo app (apps/mobile) — run `make up` first
	@echo "Starting Expo. Make sure the API is up (\`make ENV=$(ENV) up\`)."
	@echo "A physical device needs to be on the same wifi as this machine;"
	@echo "the app derives the API host from the Expo dev server automatically."
	@cd apps/mobile && pnpm start

# --- remote localhost (docs/20, G) -------------------------------------------
#
# A quick tunnel so a phone on the yard wifi can hit the local build before
# anything is pushed. cloudflared quick tunnels need no account and print a
# public URL. The web dev server must listen on 0.0.0.0 for this to work;
# NEXT_PUBLIC_API_URL stays http://localhost:4100 for the browser itself,
# because the tunnel only carries the page — the API calls go direct.

tunnel: ## Expose localhost:3100 through a cloudflared quick tunnel
	@if ! command -v cloudflared >/dev/null 2>&1; then \
		echo "  cloudflared is not installed. Install it first:"; \
		echo "    brew install cloudflared   (macOS)"; \
		echo "    or https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; \
		exit 1; \
	fi
	@echo "  Tunneling http://localhost:3100 — the printed URL is your public address."
	@echo "  Web dev must be listening on 0.0.0.0:  pnpm --filter @stinventory/web dev -- -H 0.0.0.0"
	@cloudflared tunnel --url http://localhost:3100

# --- production ---------------------------------------------------------------
#
# The droplet is a git checkout and deploys by pulling origin/main, so what runs
# there is whatever has been PUSHED — not whatever is in your working tree. The
# checks below exist because "I ran make deploy and my change isn't there" is
# otherwise a genuinely confusing ten minutes.
#
# Normally you do not need this at all: pushing to main deploys through CI. This
# is for when CI is unavailable, or to re-run a deploy without a new commit.

deploy: ## Ship main to the production droplet (CI does this on push; this is the manual path)
	@if [ -n "$$(git status --porcelain)" ]; then 		echo "  ! Uncommitted changes — these will NOT be deployed:"; 		git status --short | sed 's/^/      /'; 		echo ""; 	fi
	@UNPUSHED=$$(git rev-list --count origin/main..main 2>/dev/null || echo 0); 	if [ "$$UNPUSHED" != "0" ]; then 		echo "  ! $$UNPUSHED commit(s) on main not pushed. The server pulls from origin,"; 		echo "    so it cannot deploy them. Run: git push origin main"; 		echo ""; 		exit 1; 	fi
	@echo "  deploying $$(git rev-parse --short origin/main) to $(PROD_HOST)"
	@$(PROD_SSH) bash $(PROD_DIR)/docker/deploy.sh
	@echo ""
	@printf "  %s -> " "$(PROD_URL)"; curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 $(PROD_URL)

prod-status: ## What is running on the droplet, and at which commit
	@$(PROD_SSH) "cd $(PROD_DIR) && echo 'commit:' \$$(git rev-parse --short HEAD) \"\$$(git log -1 --format=%s)\" && $(PROD_COMPOSE) ps --format '{{.Name}}\t{{.Status}}'"
	@printf "\n  health -> "; curl -s --max-time 20 $(PROD_URL)/health || echo "unreachable"
	@echo ""

prod-logs: ## Tail production logs (SVC=api|web|caddy)
	@$(PROD_SSH) -t "$(PROD_COMPOSE) logs -f --tail 100 $(SVC)"

prod-shell: ## Shell on the droplet
	@$(PROD_SSH) -t "cd $(PROD_DIR) && bash"

dev-deploy: ## Ship development to the dev droplet (CI does this on push; this is the manual path)
	@if [ -n "$$(git status --porcelain)" ]; then 		echo "  ! Uncommitted changes — these will NOT be deployed:"; 		git status --short | sed 's/^/      /'; 		echo ""; 	fi
	@UNPUSHED=$$(git rev-list --count origin/development..development 2>/dev/null || echo 0); 	if [ "$$UNPUSHED" != "0" ]; then 		echo "  ! $$UNPUSHED commit(s) on development not pushed. The server pulls from origin,"; 		echo "    so it cannot deploy them. Run: git push origin development"; 		echo ""; 		exit 1; 	fi
	@echo "  deploying $$(git rev-parse --short origin/development) to $(DEV_HOST)"
	@$(DEV_SSH) DEPLOY_BRANCH=development bash $(DEV_DIR)/docker/deploy.sh
	@echo ""
	@printf "  %s -> " "$(DEV_URL)"; curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 $(DEV_URL)

dev-status: ## What is running on the dev droplet, and at which commit
	@$(DEV_SSH) "cd $(DEV_DIR) && echo 'commit:' \$$(git rev-parse --short HEAD) \"\$$(git log -1 --format=%s)\" && $(DEV_COMPOSE) ps --format '{{.Name}}\t{{.Status}}'"
	@printf "\n  health -> "; curl -s --max-time 20 $(DEV_URL)/health || echo "unreachable"
	@echo ""

dev-logs: ## Tail dev logs (SVC=api|web|caddy)
	@$(DEV_SSH) -t "$(DEV_COMPOSE) logs -f --tail 100 $(SVC)"

dev-shell: ## Shell on the dev droplet
	@$(DEV_SSH) -t "cd $(DEV_DIR) && bash"
