# Start the Local Development Environment

# Start qdrant
cd WrenAI/docker
docker compose -f docker-compose-dev.yaml up -d

# wren-ai-service
cd wren-ai-service
just start

# wren-engine/ibis-server
cd wren-engine/ibis-server
just run

# wren-engine/core-service
cd wren-engine/wren-core-legacy/docker
docker compose up -d

# wren-ui
cd wren-ui
yarn dev