"""
Orchestrator agent: a Claude model that plans and delegates work to sub-agents.
For now it manages a single Apify agent, but the tool interface is designed
to support parallel calls as complexity grows (multiple counties, batched runs).
"""
import json
import re
import anthropic
from agents.apify_agent import run_apify_agent

MODEL = "claude-sonnet-4-6"

TOOLS = [
    {
        "name": "create_and_run_apify_task",
        "description": (
            "Delegate to the Apify agent to geocode a county, create a saved "
            "Google Maps scraper task, and start a run."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "county": {
                    "type": "string",
                    "description": "County name, e.g. 'Miami-Dade County, Florida'",
                },
                "categories": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Business categories to search for",
                },
                "task_name": {
                    "type": "string",
                    "description": "Unique name for the saved Apify task",
                },
            },
            "required": ["county", "categories", "task_name"],
        },
    }
]


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def run_orchestrator(county: str, categories: list[str]) -> dict:
    """
    Top-level entry point. Takes a county name and list of business categories,
    orchestrates the creation and execution of an Apify scraping task.
    """
    client = anthropic.Anthropic()

    system = (
        "You are an orchestration agent for a local business data pipeline. "
        "Your job is to coordinate data collection tasks using Apify. "
        "When given a county and list of business categories, "
        "generate a descriptive task name and delegate to the Apify agent."
    )

    user_message = (
        f"Set up a Google Maps scraping task for the following:\n"
        f"County: {county}\n"
        f"Business categories: {', '.join(categories)}\n\n"
        f"Create a task name that includes the county and describes the search. "
        f"Then delegate to the Apify agent to create and start the task."
    )

    messages = [{"role": "user", "content": user_message}]
    results = []

    while True:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=system,
            tools=TOOLS,
            messages=messages,
        )

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            break

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use" and block.name == "create_and_run_apify_task":
                    print(f"[orchestrator] → apify_agent: county={block.input['county']}, "
                          f"task={block.input['task_name']}")
                    agent_result = run_apify_agent(
                        county=block.input["county"],
                        categories=block.input["categories"],
                        task_name=block.input["task_name"],
                    )
                    results.append(agent_result)
                    print(f"[orchestrator] ← apify_agent: {agent_result}")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(agent_result),
                    })

            messages.append({"role": "user", "content": tool_results})

    return {"tasks": results}
