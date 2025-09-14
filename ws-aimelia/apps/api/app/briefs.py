from datetime import datetime

def render_brief_html(event: dict, recent_summaries: list[str]) -> str:
    who = ", ".join([a.get("emailAddress", {}).get("address", "") for a in event.get("attendees", [])])
    body = f"""
    <h3>Snapshot</h3>
    <p><strong>When:</strong> {event.get('start',{}).get('dateTime','')}<br>
    <strong>Attendees:</strong> {who}</p>
    <h3>Recent Comms</h3>
    <ul>{''.join(f'<li>{x}</li>' for x in recent_summaries[:6])}</ul>
    <h3>Talking Points</h3>
    <ol><li>Topic 1</li><li>Topic 2</li><li>Topic 3</li></ol>
    <h3>Next steps</h3>
    <ul><li>Owner – date</li></ul>
    <p><em>Prepared by Aimelia</em></p>
    """
    return body