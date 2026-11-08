from datetime import date, datetime

def calendar_day(value) -> str:
    """Device-local calendar date; naive legacy timestamps retain their local interpretation."""
    clean=str(value or '').strip()
    try:
        if len(clean)==10:
            return date.fromisoformat(clean).isoformat()
        stamp=datetime.fromisoformat(clean.replace('Z','+00:00'))
        return (stamp.astimezone() if stamp.tzinfo else stamp).date().isoformat()
    except (ValueError,TypeError):
        return ''
