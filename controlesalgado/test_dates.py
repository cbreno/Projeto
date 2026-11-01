from datetime import datetime
from app import _resolve_date

BRT = 180
night = datetime(2026, 5, 11, 1, 0)   # 10/05 22:00 em Brasília
day = datetime(2026, 5, 11, 15, 0)    # 11/05 12:00 em Brasília

assert _resolve_date({"date": "2026-05-10", "tz_offset": BRT}, night) == "2026-05-11T01:00:00"
assert _resolve_date({"date": "2026-05-01", "tz_offset": BRT}, night) == "2026-05-02T01:00:00"
assert _resolve_date({"date": "2026-05-01", "tz_offset": BRT}, day) == "2026-05-01T15:00:00"
assert _resolve_date({"date": "2026-05-01"}, day) == "2026-05-01T15:00:00"
assert _resolve_date({}, day) == day.isoformat()
for bad in ({"date": "x"}, {"date": "2026-05-01", "tz_offset": "x"}, {"date": "2026-05-01", "tz_offset": 99999},
            {"date": "9999-12-31", "tz_offset": BRT}):
    assert _resolve_date(bad, night) is None, bad
print("ok")
