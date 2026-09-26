"""
Book focus time in Tom's calendar for work only he can do.

Reads only the start, end and free/busy state of existing events (never their
subject, body or attendees), finds the first free slot inside working hours,
and creates a "Focus" event there. Nothing touches email.
Uses the Microsoft Graph token Aimelia already holds (Calendars.ReadWrite).
"""
import datetime as dt
import html
from typing import List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from ..settings import settings

GRAPH = "https://graph.microsoft.com/v1.0"
Interval = Tuple[dt.datetime, dt.datetime]


class CalendarError(Exception):
    pass


def _hm(value: str, fallback: str) -> dt.time:
    try:
        h, m = (value or fallback).split(":")
        return dt.time(int(h), int(m))
    except ValueError:
        h, m = fallback.split(":")
        return dt.time(int(h), int(m))


def find_slot(busy: List[Interval], start_from: dt.datetime, minutes: int, work_start: dt.time,
              work_end: dt.time, days: int = 10) -> Optional[Interval]:
    """First gap of `minutes` on a weekday within working hours, at or after start_from (all naive local times)."""
    length = dt.timedelta(minutes=minutes)
    # round up to the next quarter hour so blocks start on tidy times
    t = start_from.replace(second=0, microsecond=0)
    t += dt.timedelta(minutes=(-t.minute) % 15)
    busy = sorted(busy)
    day = t.date()
    for _ in range(days * 2):
        if day.weekday() < 5:
            open_at = max(dt.datetime.combine(day, work_start), t)
            close_at = dt.datetime.combine(day, work_end)
            cursor = open_at
            for b_start, b_end in busy:
                if b_end <= cursor or b_start >= close_at:
                    continue
                if b_start - cursor >= length:
                    return cursor, cursor + length
                cursor = max(cursor, b_end)
                cursor += dt.timedelta(minutes=(-cursor.minute) % 15)
            if close_at - cursor >= length:
                return cursor, cursor + length
        day += dt.timedelta(days=1)
    return None


def _parse(value: str) -> dt.datetime:
    # Graph returns e.g. "2026-09-28T09:00:00.0000000" in the Prefer timezone
    return dt.datetime.fromisoformat(value[:19])


async def book_focus(db: Session, *, title: str, summary: str, minutes: int, work_start: str, work_end: str,
                     now: Optional[dt.datetime] = None) -> dict:
    """now, if given, must be timezone-aware."""
    from ..token_manager import token_manager
    import zoneinfo

    token = await token_manager.get_valid_access_token(db, "tom")
    if not token:
        raise CalendarError("Aimelia is not signed in to Microsoft 365. Sign in on the main dashboard first.")
    tz = settings.TIMEZONE or "Europe/London"
    aware_now = now or dt.datetime.now(zoneinfo.ZoneInfo(tz))
    local_now = aware_now.replace(tzinfo=None)  # slot maths runs on London wall-clock time
    headers = {"Authorization": f"Bearer {token}", "Prefer": f'outlook.timezone="{tz}"'}
    async with httpx.AsyncClient(timeout=30) as client:
        # The window carries its UTC offset: Graph reads a bare time as UTC, an hour out in summer.
        r = await client.get(f"{GRAPH}/me/calendarView", headers=headers, params={
            "startDateTime": aware_now.isoformat(timespec="seconds"),
            "endDateTime": (aware_now + dt.timedelta(days=21)).isoformat(timespec="seconds"),
            "$select": "start,end,showAs,isCancelled", "$top": "500"})
        if r.status_code >= 300:
            raise CalendarError(f"Could not read free and busy times: HTTP {r.status_code}")
        busy = [(_parse(e["start"]["dateTime"]), _parse(e["end"]["dateTime"]))
                for e in r.json().get("value", [])
                if not e.get("isCancelled") and e.get("showAs") not in ("free", "workingElsewhere")]
        slot = find_slot(busy, local_now, minutes, _hm(work_start, "09:00"), _hm(work_end, "17:30"))
        if slot is None:
            raise CalendarError(f"No free {minutes}-minute slot in working hours over the next two weeks.")
        start, end = slot
        body = (f"<p>{html.escape(summary or title)}</p>"
                f"<p><a href=\"{html.escape(settings.AIMELIA_APP_URL)}\">Open in Agent Tasks</a></p>")
        r = await client.post(f"{GRAPH}/me/events", headers=headers, json={
            "subject": f"Focus: {title}"[:255],
            "body": {"contentType": "HTML", "content": body},
            "start": {"dateTime": start.isoformat(timespec="seconds"), "timeZone": tz},
            "end": {"dateTime": end.isoformat(timespec="seconds"), "timeZone": tz},
            "showAs": "busy", "categories": ["Agent Tasks"], "isReminderOn": True,
            "reminderMinutesBeforeStart": 5})
        if r.status_code >= 300:
            raise CalendarError(f"Could not create the calendar block: HTTP {r.status_code}")
        event = r.json()
    return {"id": event.get("id"), "start": start.isoformat(timespec="minutes"),
            "end": end.isoformat(timespec="minutes"), "link": event.get("webLink")}
