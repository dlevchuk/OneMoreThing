"""Append only real successful price observations; never mix sources/currencies."""
from datetime import datetime
import math

VALUE_FIELDS = ('price', 'currency', 'url', 'taxIncluded')


def _time(point):
    return datetime.fromisoformat(point['checkedAt'].replace('Z', '+00:00'))


def _same_value(first, second):
    return all(first.get(field) == second.get(field) for field in VALUE_FIELDS)


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
        if index is not None:
            points[index] = point
        elif (len(points) >= 2 and _time(point) > _time(points[-1])
              and _same_value(points[-1], point) and _same_value(points[-2], point)):
            # Flat stretch: keep its first point and slide the last one forward,
            # so an unchanged price never grows the file beyond two points.
            points[-1] = point
        else:
            points.append(point)
        points.sort(key=_time)
        result[wid] = points[-limit:]
    return result
