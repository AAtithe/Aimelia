from fastapi import APIRouter, Depends
import httpx, datetime as dt
from .settings import settings
from .db import get_db

router = APIRouter(prefix="/emails", tags=["emails"])

# TODO: load tokens from DB and refresh when needed
async def graph_get(path: str, access_token: str, params=None):
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"https://graph.microsoft.com/v1.0{path}",
                             headers={"Authorization": f"Bearer {access_token}"}, params=params)
        r.raise_for_status()
        return r.json()

async def graph_post(path: str, access_token: str, json=None):
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"https://graph.microsoft.com/v1.0{path}",
                              headers={"Authorization": f"Bearer {access_token}"}, json=json)
        r.raise_for_status()
        return r.json()

@router.post("/triage/run")
async def run_triage():
    # stub: fetch recent messages and return count
    access_token = "REPLACE_WITH_TOKEN"
    data = await graph_get("/me/messages", access_token, params={"$top": 10})
    return {"checked": len(data.get('value', []))}

@router.post("/drafts/create")
async def create_draft(to: str, subject: str, body_html: str):
    access_token = "REPLACE_WITH_TOKEN"
    payload = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html + "<br><br><em>Drafted by Aimelia</em>"},
        "toRecipients": [{"emailAddress": {"address": to}}]
    }
    res = await graph_post("/me/messages", access_token, json=payload)
    return {"draft_id": res.get('id')}