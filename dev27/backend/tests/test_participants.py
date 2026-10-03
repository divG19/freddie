import asyncio

import httpx

from backend.main import create_app


def test_participants_persist_without_changing_room(tmp_path):
    async def run():
        source = tmp_path / "sample.sqlite"
        registry = tmp_path / "people.sqlite3"
        app = create_app(source, participants_path=registry)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                endpoint = "/api/rooms/demo/participants"
                initial = await client.get(endpoint)
                assert initial.headers["cache-control"] == "no-store"
                assert initial.json() == [
                    {"name": "Priya", "team": "Finance", "author": "Priya"},
                    {"name": "Alex", "team": "Product", "author": "Alex"},
                    {"name": "Sam", "team": "Sales", "author": "Sam"},
                ]
                before = (await client.get("/api/rooms/demo")).json()
                saved = await client.post(endpoint, json={"name": " Div ", "team": " Marketing "})
                assert saved.status_code == 200
                assert saved.json() == {"name": "Div", "team": "Marketing", "author": "Div / Marketing"}
                assert (await client.post(endpoint, json={"name": "div", "team": "marketing"})).json() == saved.json()
                assert (await client.post(endpoint, json={"name": "priya", "team": "finance"})).json()["author"] == "Priya"
                for body in [{"name": " ", "team": "Sales"}, {"name": "Div", "team": ""}, {"name": "x" * 33, "team": "Sales"}, {"name": "Div", "team": "x" * 33}]:
                    assert (await client.post(endpoint, json=body)).status_code == 422
                assert (await client.get("/api/rooms/demo")).json() == before
                people = (await client.get(endpoint)).json()
                assert len(people) == 4

        restarted = create_app(source, participants_path=registry)
        async with restarted.router.lifespan_context(restarted):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restarted), base_url="http://test") as client:
                assert (await client.get(endpoint)).json() == people
                assert (await client.get("/api/rooms/demo")).json()["messages"] == []

    asyncio.run(run())
