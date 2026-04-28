"""Polymarket bracket discovery + price fetching for Elon tweets events.

Auto-discovers all active Elon tweet count events by trying slug patterns.
Events follow: elon-musk-of-tweets-{month}-{day}-{month}-{day}
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Optional

import httpx

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"

# Slug pattern: elon-musk-of-tweets-april-21-april-28
SLUG_PREFIX = "elon-musk-of-tweets-"
MONTH_NAMES = ["january", "february", "march", "april", "may", "june",
               "july", "august", "september", "october", "november", "december"]


def _generate_candidate_slugs() -> list[str]:
    """Generate slug candidates — only windows that haven't ended yet."""
    today = datetime.utcnow().date()
    slugs = []
    for offset in range(-14, 15):
        start = today + timedelta(days=offset)
        for window in [2, 7]:
            end = start + timedelta(days=window)
            # Skip if the window already ended
            if end < today:
                continue
            sm = MONTH_NAMES[start.month - 1]
            em = MONTH_NAMES[end.month - 1]
            slug = f"{SLUG_PREFIX}{sm}-{start.day}-{em}-{end.day}"
            slugs.append(slug)
    return list(dict.fromkeys(slugs))


def discover_events(client: httpx.Client) -> list[dict]:
    """Find all active (not yet ended) Elon tweet count events."""
    candidates = _generate_candidate_slugs()
    events = []
    seen_ids = set()
    now_iso = datetime.utcnow().isoformat() + "Z"

    for slug in candidates:
        try:
            r = client.get(f"{GAMMA}/events", params={"slug": slug}, timeout=5)
            if r.status_code != 200:
                continue
            data = r.json()
            ev = None
            if isinstance(data, list) and data:
                ev = data[0]
            elif isinstance(data, dict) and data.get("id"):
                ev = data

            if ev and str(ev["id"]) not in seen_ids:
                # Skip finished events
                end_date = ev.get("endDate") or ""
                if end_date and end_date < now_iso:
                    continue

                seen_ids.add(str(ev["id"]))
                events.append({
                    "id": str(ev["id"]),
                    "slug": ev.get("slug") or slug,
                    "title": ev.get("title"),
                    "start_date": ev.get("startDate"),
                    "end_date": end_date,
                    "active": 1,
                    "tweet_count": ev.get("tweetCount"),
                    "_raw": ev,
                })
        except Exception:
            continue

    print(f"[poly] tried {len(candidates)} slugs, found {len(events)} events")
    return events


def discover_brackets_for_event(client: httpx.Client, event_slug: str, event_id: str) -> list[dict]:
    """Fetch all bracket markets for a specific event."""
    try:
        r = client.get(f"{GAMMA}/events", params={"slug": event_slug}, timeout=10)
        if r.status_code != 200:
            print(f"[poly] gamma API error for {event_slug}: HTTP {r.status_code}")
            return []
        data = r.json()
        if isinstance(data, list) and data:
            ev = data[0]
        elif isinstance(data, dict) and data.get("id"):
            ev = data
        else:
            return []
    except Exception as e:
        print(f"[poly] gamma API error for {event_slug}: {e}")
        return []

    markets = ev.get("markets") or []
    brackets = []
    for m in markets:
        question = m.get("question") or ""
        bounds = _parse_bounds(question)
        if bounds is None:
            continue
        lower, upper = bounds

        tokens_raw = m.get("clobTokenIds")
        yes_tok = no_tok = None
        if tokens_raw:
            try:
                toks = json.loads(tokens_raw) if isinstance(tokens_raw, str) else tokens_raw
                if len(toks) >= 2:
                    yes_tok, no_tok = toks[0], toks[1]
            except Exception:
                pass

        brackets.append({
            "id": m.get("conditionId") or str(m.get("id")),
            "event_id": event_id,
            "label": f"{lower}-{upper}" if upper < 99999 else f"{lower}+",
            "lower_bound": lower,
            "upper_bound": upper,
            "yes_token_id": yes_tok,
            "no_token_id": no_tok,
            "question": question,
        })

    brackets.sort(key=lambda b: b["lower_bound"])
    return brackets


def discover_all(client: httpx.Client) -> tuple[list[dict], list[dict]]:
    """Discover all events and their brackets. Returns (events, brackets)."""
    events = discover_events(client)
    all_brackets = []
    for ev in events:
        brackets = discover_brackets_for_event(client, ev["slug"], ev["id"])
        all_brackets.extend(brackets)
    return events, all_brackets


def _parse_bounds(question: str) -> Optional[tuple[int, int]]:
    """Extract (lower, upper) from bracket question text."""
    m = re.search(r'(\d+)\s*[-–]\s*(\d+)', question)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r'(\d+)\s*(?:or more|\+)', question)
    if m:
        return int(m.group(1)), 99999
    m = re.search(r'(?:fewer than|under|less than)\s+(\d+)', question, re.IGNORECASE)
    if m:
        return 0, int(m.group(1)) - 1
    return None
