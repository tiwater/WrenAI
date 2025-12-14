# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WrenAI is a GenBI (Generative Business Intelligence) agent that converts natural language into SQL queries. It's a microservices architecture with five main services: UI (Next.js), AI Service (Python/FastAPI), Engine (Rust/Python/Java), Launcher (Go), and Qdrant vector database.

## Key Development Commands

### Full Stack Operations
```bash
# Start all services (production)
docker-compose -f docker/docker-compose.yaml up

# Start all services (development)
docker-compose -f docker/docker-compose-dev.yaml up

# View running containers
docker ps

# Check service logs
docker logs <container-name>
```

### Wren UI (Frontend) - `/wren-ui/`
```bash
# Development
yarn dev                    # Start dev server on port 3000
yarn build                  # Production build
yarn test                   # Run Jest unit tests
yarn test:e2e              # Run Playwright e2e tests
yarn lint                   # ESLint check
yarn format                 # Prettier formatting

# Database operations
yarn db:migrate             # Run Knex migrations
yarn db:rollback           # Rollback migrations
```

### Wren AI Service - `/wren-ai-service/`
```bash
# Development
just start                  # Start FastAPI server
poetry run pytest          # Run all tests
poetry run pytest -k <test_name>  # Run specific test
just curate_eval_data      # Launch data curation UI

# Code quality
poetry run ruff check      # Lint check
poetry run ruff format     # Format code
```

### Wren Engine - `/wren-engine/`
```bash
# Ibis Server (Python)
cd ibis-server
poetry install
poetry run python -m app.main  # Start server

# Wren Core (Rust)
cd wren-core
cargo build                # Build all workspace members
cargo test                 # Run all tests
cargo test -p wren-core    # Test specific package
cargo fmt                  # Format code
cargo clippy              # Lint check

# Python bindings
cd wren-core-py
maturin develop           # Build and install locally
```

### Wren Launcher - `/wren-launcher/`
```bash
make build                 # Build binary
make test                  # Run tests
make lint                  # Run golangci-lint
make build-all            # Build for all platforms
```

## Architecture Overview

### Service Communication Flow
1. **User Query** → UI (Next.js) → GraphQL API
2. **GraphQL** → AI Service (FastAPI) → LLM providers
3. **SQL Generation** → Engine (Rust/Python) → Database connectors
4. **Vector Search** → Qdrant → Semantic retrieval

### Key Architectural Patterns

**MDL (Metric Definition Language)**: Central semantic layer that defines business metrics, relationships, and calculations. Located in UI service, consumed by AI and Engine services.

**Multi-LLM Support**: AI Service uses LiteLLM to abstract LLM providers. Configuration in `wren-ai-service/config.yaml`.

**Query Pipeline**: 
- Text → Intent Classification (AI Service)
- Intent → SQL Generation (AI Service + Engine)
- SQL → Validation (Engine)
- Validated SQL → Execution (Engine → Database)

**Vector Embeddings**: Questions and metadata stored in Qdrant for semantic search and context retrieval.

### Service Dependencies

- **UI** depends on: AI Service API, Engine API
- **AI Service** depends on: Engine for SQL validation, Qdrant for embeddings, LLM providers
- **Engine** depends on: Database connectors
- **All services** require: Docker network for inter-service communication

### Configuration Files

- **Global**: `docker/config.yaml` - Environment variables and service configs
- **UI**: `.env.local` for Next.js, `knexfile.js` for database
- **AI Service**: `config.yaml` for LLM providers, `pyproject.toml` for dependencies
- **Engine**: Separate configs per sub-component (Cargo.toml, pyproject.toml, pom.xml)

### Testing Strategy

- **Unit Tests**: Each service has its own test suite
- **Integration Tests**: Docker Compose for service integration
- **E2E Tests**: Playwright in UI for user flows
- **Load Tests**: Locust in AI Service for performance

### Code Quality Standards

- **Python**: Ruff with line-length=88, follows Black formatting
- **TypeScript**: ESLint + Prettier with strict rules
- **Rust**: rustfmt + clippy with deny warnings
- **Go**: golangci-lint with comprehensive checks

When modifying code:
1. Run the appropriate lint/format commands before committing
2. Ensure tests pass in the service you're modifying
3. Check docker logs if services fail to communicate
4. Use existing patterns - check similar files in the same service first