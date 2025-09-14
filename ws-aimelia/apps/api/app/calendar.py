from fastapi import APIRouter
import httpx, datetime as dt
from .settings import settings

router = APIRouter(prefix="/calendar", tags=["calendar"])

@router.get("/next24")
async def next_24h():
    access_token = "REPLACE_WITH_TOKEN"
    start = dt.datetime.utcnow()
    end = start + dt.timedelta(hours=24)
    params = {
        "startDateTime": start.isoformat()+"Z",
        "endDateTime": end.isoformat()+"Z",
        "$top": 20,
        "$orderby": "start/dateTime"
    }
    async with httpx.AsyncClient() as client:
        r = await client.get("https://graph.microsoft.com/v1.0/me/calendarView",
                             headers={"Authorization": f"Bearer {access_token}"}, params=params)
        r.raise_for_status()
        return r.json()