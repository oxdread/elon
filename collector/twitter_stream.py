"""X API filtered stream for @elonmusk tweets.

Uses the v2 filtered stream endpoint. Runs in a daemon thread.
Calls on_tweet(tweet_dict) whenever Elon tweets.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Callable, Optional

import httpx

ELON_USER_ID = "1869793352918675456"  # @Rendegenob (testing)
STREAM_URL = "https://api.x.com/2/tweets/search/stream"
RULES_URL = "https://api.x.com/2/tweets/search/stream/rules"

_connected = False
_lock = threading.Lock()


def is_connected() -> bool:
    with _lock:
        return _connected


def _get_bearer() -> str:
    token = os.environ.get("X_BEARER_TOKEN", "")
    if not token:
        print("[twitter] WARNING: X_BEARER_TOKEN not set")
    return token


def _setup_rules(bearer: str) -> bool:
    """Check existing rules, only modify if needed."""
    headers = {"Authorization": f"Bearer {bearer}"}
    try:
        r = httpx.get(RULES_URL, headers=headers, timeout=10)
        if r.status_code != 200:
            print(f"[twitter] rules GET failed: HTTP {r.status_code}")
            return False
        existing = r.json().get("data") or []

        # Check if our rule already exists
        for rule in existing:
            if "Rendegenob" in rule.get("value", ""):
                print(f"[twitter] filter rule already set: {rule['value']}")
                return True

        # Need to set up — delete old rules first
        if existing:
            ids = [rule["id"] for rule in existing]
            httpx.post(RULES_URL, headers={**headers, "Content-Type": "application/json"},
                json={"delete": {"ids": ids}}, timeout=10)

        ar = httpx.post(
            RULES_URL,
            headers={**headers, "Content-Type": "application/json"},
            json={"add": [{"value": "from:Rendegenob", "tag": "test"}]},
            timeout=10,
        )
        if ar.status_code in (200, 201):
            print("[twitter] filter rule set: from:elonmusk")
            return True
        else:
            print(f"[twitter] rules ADD failed: HTTP {ar.status_code} {ar.text}")
            return False
    except Exception as e:
        print(f"[twitter] rules setup error: {e}")
        return False


def _stream_loop(bearer: str, on_tweet: Callable[[dict], None]) -> None:
    """Connect to filtered stream and process tweets."""
    global _connected
    headers = {"Authorization": f"Bearer {bearer}"}
    # Request referenced_tweets to detect replies vs originals/quotes/retweets
    params = {"tweet.fields": "created_at,author_id,text,referenced_tweets"}

    with _lock:
        _connected = False

    backoff = 1.0
    while True:
        try:
            with httpx.stream(
                "GET",
                STREAM_URL,
                headers=headers,
                params=params,
                timeout=httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=10.0),
            ) as response:
                if response.status_code == 429:
                    retry_after = int(response.headers.get("retry-after", 60))
                    print(f"[twitter] rate limited, retry in {retry_after}s")
                    time.sleep(retry_after)
                    continue
                if response.status_code != 200:
                    print(f"[twitter] stream HTTP {response.status_code}")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 16.0)
                    continue

                with _lock:
                    _connected = True
                backoff = 1.0
                print("[twitter] stream connected")

                for line in response.iter_lines():
                    if not line.strip():
                        continue  # heartbeat
                    try:
                        data = json.loads(line)
                        tweet_data = data.get("data")
                        if not tweet_data or tweet_data.get("author_id") != ELON_USER_ID:
                            continue

                        # Filter: only main posts, quotes, retweets — NOT replies
                        ref_tweets = tweet_data.get("referenced_tweets") or []
                        is_reply = any(r.get("type") == "replied_to" for r in ref_tweets)
                        if is_reply:
                            print(f"[twitter] REPLY (skipped): {tweet_data.get('text', '')[:60]}")
                            continue

                        # Determine tweet type
                        tweet_type = "original"
                        for r in ref_tweets:
                            if r.get("type") == "quoted":
                                tweet_type = "quote"
                            elif r.get("type") == "retweeted":
                                tweet_type = "retweet"

                        tweet = {
                            "id": tweet_data["id"],
                            "text": tweet_data.get("text", ""),
                            "author_id": tweet_data["author_id"],
                            "ts": int(time.time()),
                            "tweet_type": tweet_type,
                            "raw_json": json.dumps(data),
                        }
                        print(f"[twitter] TWEET ({tweet_type}): {tweet['text'][:80]}")
                        on_tweet(tweet)
                    except json.JSONDecodeError:
                        continue

        except (httpx.ReadTimeout, httpx.RemoteProtocolError):
            print("[twitter] stream timeout/disconnect, reconnecting...")
        except Exception as e:
            print(f"[twitter] stream error: {type(e).__name__}: {e}")

        with _lock:
            _connected = False
        time.sleep(backoff)
        backoff = min(backoff * 2, 16.0)


def start(on_tweet: Callable[[dict], None]) -> None:
    """Start the Twitter stream in a daemon thread."""
    bearer = _get_bearer()
    if not bearer:
        print("[twitter] no bearer token, stream disabled")
        return

    _setup_rules(bearer)

    def _thread():
        _stream_loop(bearer, on_tweet)

    t = threading.Thread(target=_thread, name="twitter-stream", daemon=True)
    t.start()
