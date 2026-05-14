"""
Raw Apify API functions used as tools by the Apify agent.
Each function returns a plain dict so it can be serialized as a tool result.
"""
from apify_client import ApifyClient
from config import GOOGLE_MAPS_ACTOR_ID, DEFAULT_MAX_PLACES_PER_SEARCH, DEFAULT_LANGUAGE


def _client(api_token: str) -> ApifyClient:
    return ApifyClient(api_token)


def verify_connection(api_token: str) -> dict:
    """Verify the Apify token works by fetching the current user profile."""
    try:
        user = _client(api_token).user("me").get()
        return {
            "ok": True,
            "username": user.get("username"),
            "email": user.get("email"),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def create_task(
    api_token: str,
    task_name: str,
    categories: list[str],
    lat: float,
    lng: float,
    zoom: int,
    max_places: int = DEFAULT_MAX_PLACES_PER_SEARCH,
) -> dict:
    """
    Create a saved Apify task for the Google Maps scraper with the given
    search terms and location.
    """
    task_input = {
        "searchStringsArray": categories,
        "lat": lat,
        "lng": lng,
        "zoom": zoom,
        "maxCrawledPlacesPerSearch": max_places,
        "language": DEFAULT_LANGUAGE,
        "maxImages": 0,
        "exportPlaceUrls": False,
        "additionalInfo": False,
        "reviews": False,
    }
    try:
        task = _client(api_token).tasks().create(
            actor_id=GOOGLE_MAPS_ACTOR_ID,
            name=task_name,
            task_input=task_input,
        )
        return {
            "ok": True,
            "task_id": task["id"],
            "task_name": task["name"],
            "actor_id": GOOGLE_MAPS_ACTOR_ID,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def run_task(api_token: str, task_id: str) -> dict:
    """Trigger a run of an existing Apify task and return the run metadata."""
    try:
        run = _client(api_token).task(task_id).call()
        return {
            "ok": True,
            "run_id": run["id"],
            "task_id": task_id,
            "status": run["status"],
            "dataset_id": run.get("defaultDatasetId"),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def get_run_status(api_token: str, run_id: str) -> dict:
    """Return the current status of a run."""
    try:
        run = _client(api_token).run(run_id).get()
        return {
            "ok": True,
            "run_id": run_id,
            "status": run["status"],
            "dataset_id": run.get("defaultDatasetId"),
            "stats": run.get("stats", {}),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
