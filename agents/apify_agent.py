"""
Apify agent: a Claude model equipped with tools to interact with Apify.
Invoked by the orchestrator to create and run Google Maps scraper tasks.
"""
import json
import anthropic
from config import APIFY_TOKEN
from tools.geocoding import geocode_county
from tools import apify_tools

MODEL = "claude-sonnet-4-6"

TOOLS = [
    {
        "name": "verify_connection",
        "description": "Verify the Apify API token is valid and return account info.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "geocode_county",
        "description": (
            "Resolve a county name to center coordinates and zoom level "
            "for use in the Google Maps scraper."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "county_name": {
                    "type": "string",
                    "description": "County name, e.g. 'Miami-Dade County, Florida'",
                }
            },
            "required": ["county_name"],
        },
    },
    {
        "name": "create_task",
        "description": (
            "Create a saved Apify task for the Google Maps scraper with a name, "
            "list of business categories, and location coordinates."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_name": {"type": "string", "description": "Unique task name on Apify"},
                "categories": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Business categories to search for",
                },
                "lat": {"type": "number"},
                "lng": {"type": "number"},
                "zoom": {"type": "integer", "description": "Map zoom level (9-13)"},
            },
            "required": ["task_name", "categories", "lat", "lng", "zoom"],
        },
    },
    {
        "name": "run_task",
        "description": "Trigger a run of an existing Apify task by its ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Apify task ID to run"}
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "get_run_status",
        "description": "Get the current status of an Apify run by run ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string"}
            },
            "required": ["run_id"],
        },
    },
]


def _execute_tool(name: str, inputs: dict) -> dict:
    if name == "verify_connection":
        return apify_tools.verify_connection(APIFY_TOKEN)
    elif name == "geocode_county":
        return geocode_county(inputs["county_name"])
    elif name == "create_task":
        return apify_tools.create_task(
            api_token=APIFY_TOKEN,
            task_name=inputs["task_name"],
            categories=inputs["categories"],
            lat=inputs["lat"],
            lng=inputs["lng"],
            zoom=inputs["zoom"],
        )
    elif name == "run_task":
        return apify_tools.run_task(APIFY_TOKEN, inputs["task_id"])
    elif name == "get_run_status":
        return apify_tools.get_run_status(APIFY_TOKEN, inputs["run_id"])
    else:
        return {"error": f"Unknown tool: {name}"}


def run_apify_agent(county: str, categories: list[str], task_name: str) -> dict:
    """
    Entry point called by the orchestrator.
    Runs an agentic loop: geocode county → create task → start run.
    Returns a summary dict with task_id, run_id, and status.
    """
    client = anthropic.Anthropic()

    system = (
        "You are an Apify automation agent. Your job is to:\n"
        "1. Verify the Apify connection.\n"
        "2. Geocode the county to get coordinates.\n"
        "3. Create a Google Maps scraper task with those coordinates and the given categories.\n"
        "4. Start the task run.\n"
        "Work step by step. Use the tools in order. "
        "When all steps are complete, summarize the result as JSON."
    )

    user_message = (
        f"Create and start an Apify Google Maps scraping task.\n"
        f"County: {county}\n"
        f"Business categories: {', '.join(categories)}\n"
        f"Task name: {task_name}"
    )

    messages = [{"role": "user", "content": user_message}]
    result = {}

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
            # Extract final text summary
            for block in response.content:
                if hasattr(block, "text"):
                    result["summary"] = block.text
            break

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    tool_output = _execute_tool(block.name, block.input)
                    # Track key outputs for the caller
                    if block.name == "create_task" and tool_output.get("ok"):
                        result["task_id"] = tool_output["task_id"]
                        result["task_name"] = tool_output["task_name"]
                    if block.name == "run_task" and tool_output.get("ok"):
                        result["run_id"] = tool_output["run_id"]
                        result["run_status"] = tool_output["status"]
                    if block.name == "geocode_county":
                        result["location"] = tool_output.get("display_name")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(tool_output),
                    })

            messages.append({"role": "user", "content": tool_results})

    return result
