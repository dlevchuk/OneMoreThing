"""Append only real successful price observations; never mix sources/currencies."""
from datetime import datetime
import math


def update_history(history, observations, limit=730):
    result = {wid: list(points) for wid, points in history.items() if isinstance(points, list)}
    for wid, item in observations.items():
        if item.get('checkFailed'):
            continue
        if not isinstance(item.get('price'), (int, float)) or not math.isfinite(item['price']) or item['price'] <= 0:
            continue
        datetime.fromisoformat(item['checkedAt'].replace('Z', '+00:00'))
        point = {field: item[field] for field in ('price', 'currency', 'url', 'checkedAt')}
        if 'taxIncluded' in item:
            point['taxIncluded'] = item['taxIncluded']
        points = result.setdefault(wid, [])
        key = lambda p: (p.get('checkedAt'), p.get('url'), p.get('currency'), p.get('taxIncluded'))
        index = next((i for i, old in enumerate(points) if key(old) == key(point)), None)
        if index is None:
            points.append(point)
        else:
            points[index] = point
        points.sort(key=lambda p: datetime.fromisoformat(p['checkedAt'].replace('Z', '+00:00')))
        result[wid] = points[-limit:]
    return result
