"""Fetch public Bengaluru geometry and terrain; retain provenance and raw files.

Run with Python 3 from the repository root. Uses only the standard library.
Downloads use four bounded range connections for the large public KML file.
"""
import concurrent.futures
import datetime
import hashlib
import json
import math
import time
from pathlib import Path
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/bengaluru/raw"
PUBLIC = ROOT / "public/data/bengaluru"
GENERATED = ROOT / "src/data"
NS = {"k": "http://www.opengis.net/kml/2.2"}
DATASETS = [
    ("stormwater-drains", "bengaluru-stormwater-drains-maps", "801779e6-ed81-457d-bd2a-7e3cc95ad1ee"),
    ("lakes", "lakes-and-ponds-in-bengaluru-district", "11617e96-5aa2-4f2d-8df3-89727b6a75f3"),
]
# Bellandur–Marathahalli: the Koramangala–Challaghatta valley draining past
# Bellandur Lake toward Varthur, a documented flood area (e.g. Sept 2022).
# 500 m cells keep the model within the engine's 400-region guardrail.
GRID = {"rows": 15, "cols": 21, "cellM": 500, "westLng": 77.615, "northLat": 12.986}
SUBSAMPLES = 3  # 3 x 3 DEM samples averaged per cell
GRID["metersPerDegreeLat"] = 111320
GRID["metersPerDegreeLng"] = 111320 * math.cos(math.radians(GRID["northLat"]))


def read_url(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "FlowShield-Hackathon-DataFetcher/1.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=40) as response:
        return response.read(), dict(response.headers), response.status


def download(resource, destination):
    size = resource["size"]
    if destination.exists() and destination.stat().st_size == size:
        ET.parse(destination)
        return
    parts = RAW / (destination.stem + "-parts")
    parts.mkdir(exist_ok=True)
    ranges = [(start, min(size - 1, start + 1024 * 1024 - 1)) for start in range(0, size, 1024 * 1024)]

    def part(bounds):
        start, end = bounds
        path = parts / str(start)
        if path.exists() and path.stat().st_size == end - start + 1:
            return path
        for attempt in range(3):
            try:
                data, headers, status = read_url(resource["url"], {"Range": f"bytes={start}-{end}"})
                assert status == 206 and headers.get("Content-Range") == f"bytes {start}-{end}/{size}"
                assert len(data) == end - start + 1
                path.write_bytes(data)
                return path
            except Exception:
                if attempt == 2:
                    raise

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        files = list(pool.map(part, ranges))
    temporary = destination.with_suffix(".download")
    with temporary.open("wb") as output:
        for path in files:
            output.write(path.read_bytes())
    assert temporary.stat().st_size == size
    ET.parse(temporary)
    temporary.replace(destination)
    for path in files:
        path.unlink()
    parts.rmdir()


def coords(node):
    values = []
    for value in (node.text or "").split():
        lon, lat, *_ = [float(x) for x in value.split(",")]
        assert math.isfinite(lon) and math.isfinite(lat) and 70 < lon < 85 and 5 < lat < 20
        # Preserve tiny source segments too; rounding can collapse short lines.
        values.append([lon, lat])
    return values


def convert(path, name):
    features = []
    root = ET.parse(path).getroot()
    placemarks = root.findall(".//k:Placemark", NS)
    for index, pm in enumerate(placemarks):
        attributes = {n.get("name"): (n.text or "").strip() for n in pm.findall(".//k:SimpleData", NS)}
        for node in pm.findall(".//k:Data", NS):
            attributes[node.get("name")] = node.findtext("k:value", default="", namespaces=NS)
        label = pm.findtext("k:name", default="", namespaces=NS).strip()
        if name == "stormwater-drains":
            lines = [coords(line) for line in pm.findall(".//k:LineString/k:coordinates", NS)]
            lines = [line for line in lines if len(line) >= 2]
            if not lines:
                raise ValueError(f"Drain placemark {index} has no usable line")
            category = attributes.get("Type", "Unknown").strip().lower()
            if category not in ("primary", "secondary", "tertiary"):
                category = "unclassified"
            geometry = {"type": "MultiLineString", "coordinates": lines}
            # Keep source identifiers and hydraulic fields only if actually present.
            props = {"id": f"swd-{index}", "category": category,
                     "sourceObjectId": attributes.get("OBJECTID_1", attributes.get("OBJECTID", ""))}
        else:
            polygons = []
            for polygon in pm.findall(".//k:Polygon", NS):
                rings = [coords(ring) for ring in polygon.findall("k:outerBoundaryIs/k:LinearRing/k:coordinates", NS)]
                rings += [coords(ring) for ring in polygon.findall("k:innerBoundaryIs/k:LinearRing/k:coordinates", NS)]
                if rings and all(len(ring) >= 4 for ring in rings):
                    for ring in rings:
                        if ring[0] != ring[-1]: ring.append(ring[0])
                    polygons.append(rings)
            if not polygons:
                raise ValueError(f"Lake placemark {index} has no usable polygon")
            geometry = {"type": "MultiPolygon", "coordinates": polygons}
            props = {"id": f"lake-{index}", "name": label or attributes.get("NAME", attributes.get("Name", "Mapped lake/tank"))}
        features.append({"type": "Feature", "properties": props, "geometry": geometry})
    return {"type": "FeatureCollection", "features": features}, len(placemarks)


def simplify_line(points, tolerance=3.0):
    """Display-only RDP in local metres; exact coordinates stay in full GeoJSON."""
    if len(points) <= 2: return [[round(p[0], 5), round(p[1], 5)] for p in points]
    xy = [(p[0] * GRID["metersPerDegreeLng"], p[1] * GRID["metersPerDegreeLat"]) for p in points]
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        first, last = pending.pop()
        ax, ay = xy[first]; bx, by = xy[last]
        dx, dy = bx - ax, by - ay
        denom = dx * dx + dy * dy
        worst, selected = tolerance * tolerance, None
        for i in range(first + 1, last):
            x, y = xy[i]
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / denom)) if denom else 0
            distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
            if distance > worst: worst, selected = distance, i
        if selected is not None:
            keep.add(selected)
            pending.extend([(first, selected), (selected, last)])
    result = [points[i] for i in sorted(keep)]
    if points[0] == points[-1] and len(result) < 4: result = points
    # 5 decimal places is about 1 m: plenty for display, and much smaller files.
    return [[round(p[0], 5), round(p[1], 5)] for p in result]


def display_collection(collection, name):
    features = []
    for feature in collection["features"]:
        geom = feature["geometry"]
        if name == "stormwater-drains":
            coordinates = [simplify_line(line) for line in geom["coordinates"]]
        else:
            coordinates = [[simplify_line(ring) for ring in polygon] for polygon in geom["coordinates"]]
        features.append({**feature, "geometry": {**geom, "coordinates": coordinates}})
    return {"type": "FeatureCollection", "features": features}


def main():
    for path in [RAW, PUBLIC, GENERATED]: path.mkdir(parents=True, exist_ok=True)
    sources = []
    layers = {}
    for name, slug, resource_id in DATASETS:
        metadata_path = RAW / f"{name}-metadata.json"
        if not metadata_path.exists():
            content, _, _ = read_url(f"https://data.opencity.in/api/3/action/package_show?id={slug}")
            metadata_path.write_text(json.dumps(json.loads(content)["result"], indent=2))
        metadata = json.loads(metadata_path.read_text())
        resource = next(r for r in metadata["resources"] if r["id"] == resource_id)
        path = RAW / f"{name}.kml"
        print(f"Downloading/verifying {name} ({resource['size']} bytes)", flush=True)
        download(resource, path)
        collection, count = convert(path, name)
        layers[name] = collection
        (PUBLIC / f"{name}.geojson").write_text(json.dumps(collection, separators=(",", ":")))
        (PUBLIC / f"{name}.display.geojson").write_text(json.dumps(display_collection(collection, name), separators=(",", ":")))
        sources.append({
            "id": name, "title": resource["name"], "datasetUrl": f"https://data.opencity.in/dataset/{slug}",
            "downloadUrl": resource["url"], "resourceId": resource_id,
            "license": metadata.get("license_title"), "resourceLastModified": resource.get("last_modified"),
            "source": "KSRSAC via OpenCity", "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sourcePlacemarkCount": count, "featureCount": len(collection["features"]),
        })
        print(f"Converted all {count} {name} placemarks", flush=True)

    def centre(row, col):
        return (GRID["westLng"] + (col + .5) * GRID["cellM"] / GRID["metersPerDegreeLng"],
                GRID["northLat"] - (row + .5) * GRID["cellM"] / GRID["metersPerDegreeLat"])

    def sample_points(row, col):
        """SUBSAMPLES^2 evenly spaced points inside a (possibly virtual) cell."""
        points = []
        for i in range(SUBSAMPLES):
            for j in range(SUBSAMPLES):
                fx, fy = (j + .5) / SUBSAMPLES, (i + .5) / SUBSAMPLES
                points.append((GRID["westLng"] + (col + fx) * GRID["cellM"] / GRID["metersPerDegreeLng"],
                               GRID["northLat"] - (row + fy) * GRID["cellM"] / GRID["metersPerDegreeLat"]))
        return points

    cells = []
    for row in range(GRID["rows"]):
        for col in range(GRID["cols"]):
            lng, lat = centre(row, col)
            cells.append({"id": f"r{row:02}-{col:02}", "row": row, "col": col, "longitude": lng, "latitude": lat})
    # Open boundary: each edge cell discharges toward the ground just outside it,
    # sampled as a virtual neighbour cell. No river or lake level is invented.
    edges = []
    for c in cells:
        for side, dr, dc in (("N", -1, 0), ("S", 1, 0), ("W", 0, -1), ("E", 0, 1)):
            r, k = c["row"] + dr, c["col"] + dc
            if not (0 <= r < GRID["rows"] and 0 <= k < GRID["cols"]):
                edges.append({"id": f"edge-{c['id']}-{side}", "cellId": c["id"], "side": side, "row": r, "col": k})
    targets = [(c, sample_points(c["row"], c["col"])) for c in cells] + [(e, sample_points(e["row"], e["col"])) for e in edges]
    points = [p for _, pts in targets for p in pts]
    values = []
    for start in range(0, len(points), 100):
        chunk = points[start:start + 100]
        cache = RAW / f"elevation-v2-{start}.json"
        if not cache.exists():
            lat = ",".join(str(round(p[1], 7)) for p in chunk)
            lng = ",".join(str(round(p[0], 7)) for p in chunk)
            for attempt in range(6):
                try:
                    data, _, _ = read_url(f"https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lng}")
                    break
                except urllib.error.HTTPError as error:
                    if error.code != 429 or attempt == 5: raise
                    time.sleep(15 * (attempt + 1))  # public API rate limit
            cache.write_bytes(data)
            time.sleep(1.5)
        elevations = json.loads(cache.read_text())["elevation"]
        assert len(elevations) == len(chunk)
        for elevation in elevations:
            assert isinstance(elevation, (int, float)) and math.isfinite(elevation)
        values.extend(elevations)
    per = SUBSAMPLES * SUBSAMPLES
    for index, (target, _) in enumerate(targets):
        samples = values[index * per:(index + 1) * per]
        key = "elevationM" if "cellId" not in target else "externalElevationM"
        target[key] = round(sum(samples) / len(samples), 2)
        if key == "elevationM":
            target["elevationRangeM"] = [min(samples), max(samples)]
    edge_outlets = [{"id": e["id"], "cellId": e["cellId"], "side": e["side"], "externalElevationM": e["externalElevationM"]} for e in edges]

    # Summarize mapped line length intersecting each coarse cell. Geometry is
    # subdivided into <=25 m pieces; midpoint allocation is a labelled estimate.
    lengths = {c["id"]: 0.0 for c in cells}
    for feature in layers["stormwater-drains"]["features"]:
        for line in feature["geometry"]["coordinates"]:
            for a, b in zip(line, line[1:]):
                dx = (b[0] - a[0]) * GRID["metersPerDegreeLng"]
                dy = (b[1] - a[1]) * GRID["metersPerDegreeLat"]
                length = math.hypot(dx, dy)
                steps = max(1, math.ceil(length / 25))
                for i in range(steps):
                    f = (i + .5) / steps
                    lng, lat = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
                    col = math.floor((lng - GRID["westLng"]) * GRID["metersPerDegreeLng"] / GRID["cellM"])
                    row = math.floor((GRID["northLat"] - lat) * GRID["metersPerDegreeLat"] / GRID["cellM"])
                    key = f"r{row:02}-{col:02}"
                    if key in lengths: lengths[key] += length / steps
    for c in cells: c["mappedDrainLengthM"] = round(lengths[c["id"]], 1)
    terrain = {"grid": GRID, "cells": cells, "edgeOutlets": edge_outlets,
               "elevationSource": "Copernicus DEM GLO-90 via Open-Meteo", "resolutionM": 90,
               "samplesPerCell": per, "sourceUrl": "https://open-meteo.com/en/docs/elevation-api"}
    (PUBLIC / "terrain.json").write_text(json.dumps(terrain, separators=(",", ":")))
    (GENERATED / "bengaluru-terrain.ts").write_text("// Generated by data/bengaluru/fetch.py; source metadata in public/data/bengaluru.\nexport const BENGALURU_TERRAIN = " + json.dumps(terrain, separators=(",", ":")) + " as const;\n")
    counts = {}
    for f in layers["stormwater-drains"]["features"]:
        key = f["properties"]["category"]
        counts[key] = counts.get(key, 0) + 1
    manifest = {"retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "sources": sources,
                "drainCounts": counts, "lakeCount": len(layers["lakes"]["features"]), "displaySimplificationM": 3,
                "terrain": {"source": terrain["elevationSource"], "url": terrain["sourceUrl"], "sampleCount": len(points), "samplesPerCell": per},
                "coverageNote": "All features in the downloaded files; not a verified complete or current inventory of every Bengaluru drain.",
                "missingHydraulics": ["verified flow capacity", "current blockage status", "channel cross-sections", "invert levels", "live water levels"]}
    (PUBLIC / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"drains": counts, "lakes": manifest["lakeCount"], "terrainSamples": len(points), "cells": len(cells), "edgeOutlets": len(edge_outlets)}), flush=True)


if __name__ == "__main__": main()
