"""Lightweight WebSocket relay server.

Collector pushes events here, browser clients receive them instantly.
Runs on port 3001 alongside the Next.js app on port 3000.
"""
import asyncio
import json
import signal
from typing import Set

import websockets
from websockets.server import ServerConnection

# Connected browser clients
clients: Set[ServerConnection] = set()

# Internal push endpoint (collector sends here)
push_queue: asyncio.Queue = asyncio.Queue()


async def handle_client(websocket: ServerConnection) -> None:
    """Handle a browser client connection."""
    clients.add(websocket)
    print(f"[ws] client connected ({len(clients)} total)")
    try:
        async for message in websocket:
            # Clients don't send anything, but keep connection alive
            if message == "ping":
                await websocket.send("pong")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)
        print(f"[ws] client disconnected ({len(clients)} total)")


async def broadcaster() -> None:
    """Broadcast queued messages to all connected clients."""
    while True:
        msg = await push_queue.get()
        if clients:
            await asyncio.gather(
                *[client.send(msg) for client in clients],
                return_exceptions=True,
            )


async def push_handler(websocket: ServerConnection) -> None:
    """Handle push messages from the collector (internal)."""
    async for message in websocket:
        await push_queue.put(message)


async def main() -> None:
    # Public endpoint for browser clients (port 3001)
    client_server = await websockets.serve(handle_client, "0.0.0.0", 3001)
    # Internal endpoint for collector to push events (port 3002)
    push_server = await websockets.serve(push_handler, "127.0.0.1", 3002)

    print("[ws] relay server started — clients: 3001, push: 3002")

    # Start broadcaster task
    asyncio.create_task(broadcaster())

    # Wait forever
    stop = asyncio.Future()
    loop = asyncio.get_event_loop()
    loop.add_signal_handler(signal.SIGTERM, stop.set_result, None)
    loop.add_signal_handler(signal.SIGINT, stop.set_result, None)
    await stop

    client_server.close()
    push_server.close()
    print("[ws] stopped")


if __name__ == "__main__":
    asyncio.run(main())
