# This file is only used for OSS, it will force deploy the mdl for the OSS users
# Since we allow users to customize llm and embedding models, which means qdrant collections may need to be recreated
# So, this file automates the process of force deploying the mdl

import asyncio
import os
from pathlib import Path

import aiohttp
import backoff
from dotenv import load_dotenv

if Path(".env.dev").exists():
    load_dotenv(".env.dev", override=True)


@backoff.on_exception(backoff.expo, aiohttp.ClientError, max_time=60, max_tries=3)
async def force_deploy():
    wren_ui_endpoint = os.getenv("WREN_UI_ENDPOINT", "http://wren-ui:3000").rstrip("/")
    graphql_endpoint = f"{wren_ui_endpoint}/api/graphql"

    async with aiohttp.ClientSession() as session:
        # Get an existing projectId (OSS docker startup may run before the user creates any project)
        async with session.post(
            graphql_endpoint,
            json={
                "query": "query ListProjects { listProjects { projects { id } } }",
                "variables": {},
            },
            timeout=aiohttp.ClientTimeout(total=60),
        ) as response:
            res = await response.json()

        projects = (
            res.get("data", {})
            .get("listProjects", {})
            .get("projects", [])
            if isinstance(res, dict)
            else []
        )
        if not projects:
            print(
                "Forcing deployment skipped: no projects found yet. "
                "Create a project in wren-ui and deploy from the UI.",
            )
            return

        project_id = projects[0].get("id")
        if project_id is None:
            print(
                "Forcing deployment skipped: listProjects returned invalid project payload.",
            )
            return

        async with session.post(
            graphql_endpoint,
            json={
                "query": (
                    "mutation Deploy($projectId: Int!, $force: Boolean!) { "
                    "deploy(projectId: $projectId, force: $force) "
                    "}"
                ),
                "variables": {"force": True, "projectId": project_id},
            },
            timeout=aiohttp.ClientTimeout(total=60),  # 60 seconds
        ) as response:
            res = await response.json()
            print(f"Forcing deployment: {res}")


if os.getenv("ENGINE", "wren_ui") == "wren_ui":
    asyncio.run(force_deploy())
