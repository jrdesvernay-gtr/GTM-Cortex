import os
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
APIFY_TOKEN = os.environ["APIFY_TOKEN"]

# Default Google Maps scraper actor on Apify
GOOGLE_MAPS_ACTOR_ID = "compass/crawler-google-places"

# Default scraper settings
DEFAULT_MAX_PLACES_PER_SEARCH = 100
DEFAULT_LANGUAGE = "en"
