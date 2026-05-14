"""
Entry point for the clay-agent pipeline.

Usage:
    python main.py

Or import and call run() directly with custom inputs.
"""
import json
from agents.orchestrator import run_orchestrator

DEFAULT_COUNTY = "Miami-Dade County, Florida"
DEFAULT_CATEGORIES = [
    "restaurant",
    "nail salon",
    "bar",
    "hair salon",
    "coffee shop",
]


def run(county: str = DEFAULT_COUNTY, categories: list[str] = DEFAULT_CATEGORIES) -> dict:
    print(f"\n=== clay-agent ===")
    print(f"County   : {county}")
    print(f"Categories: {', '.join(categories)}")
    print("==================\n")

    result = run_orchestrator(county=county, categories=categories)

    print("\n=== Result ===")
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    run()
