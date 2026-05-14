import requests


def geocode_county(county_name: str) -> dict:
    """
    Resolve a county name to center coordinates and a bounding box via Nominatim.
    Returns: {lat, lng, zoom, bbox: {north, south, east, west}}
    """
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": county_name,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
    }
    headers = {"User-Agent": "clay-agent/1.0"}

    response = requests.get(url, params=params, headers=headers, timeout=10)
    response.raise_for_status()
    results = response.json()

    if not results:
        raise ValueError(f"Could not geocode county: {county_name!r}")

    result = results[0]
    # Nominatim boundingbox: [min_lat, max_lat, min_lon, max_lon]
    bb = result["boundingbox"]
    south, north, west, east = float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])
    lat = (north + south) / 2
    lng = (east + west) / 2

    # Pick zoom level based on the geographic span of the county
    lat_span = north - south
    lng_span = east - west
    max_span = max(lat_span, lng_span)
    if max_span < 0.3:
        zoom = 13
    elif max_span < 0.7:
        zoom = 12
    elif max_span < 1.5:
        zoom = 11
    elif max_span < 3.0:
        zoom = 10
    else:
        zoom = 9

    return {
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "zoom": zoom,
        "bbox": {"north": north, "south": south, "east": east, "west": west},
        "display_name": result.get("display_name", county_name),
    }
