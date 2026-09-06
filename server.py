#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local development server for AlMahatta.

Serves the static site and exposes the API routes used by app.js:
  /api/weather
  /api/forecast
  /api/history/today
  /api/history/month
  /api/history/year
  /api/prayer
  /api/health

No third-party Python packages are required.
Configuration is read from a local .env file in the same folder and/or
from real environment variables.
"""

from __future__ import annotations

import json
import math
import calendar
import mimetypes
import os
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent
RIYADH_TZ = timezone(timedelta(hours=3))
STATION_NAME = "أبيار الماشي · المدينة المنورة"
RAIN_STATS_START_YEAR = 2026
RAIN_STATS_START_MONTH = 7


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv(ROOT / ".env")

WU_API_KEY = os.getenv("WU_API_KEY", "").strip()
STATION_ID = os.getenv("WU_STATION_ID", "IMEDIN86").strip() or "IMEDIN86"
OFFLINE_AFTER = float(os.getenv("STATION_OFFLINE_AFTER_MINUTES", "15") or 15)
PORT = int(os.getenv("PORT", "8000") or 8000)
LAT_ENV = os.getenv("STATION_LATITUDE", "").strip()
LON_ENV = os.getenv("STATION_LONGITUDE", "").strip()


def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def first_finite(*values):
    for value in values:
        number = finite(value)
        if number is not None:
            return number
    return None


def metric(row, key):
    return (row or {}).get("metric", {}).get(key)


def pick_temp(row):
    return first_finite(metric(row, "temp"), (row or {}).get("imperial", {}).get("temp"))


def pick_humidity(row):
    return first_finite((row or {}).get("humidity"))


def pick_wind(row):
    return first_finite(metric(row, "windSpeed"), (row or {}).get("imperial", {}).get("windSpeed"))


def pick_gust(row):
    return first_finite(metric(row, "windGust"), (row or {}).get("imperial", {}).get("windGust"))


def pick_pressure(row):
    return first_finite(metric(row, "pressure"), (row or {}).get("imperial", {}).get("pressure"))


def pick_rain(row):
    return first_finite(
        metric(row, "precipRate"),
        (row or {}).get("imperial", {}).get("precipRate"),
        (row or {}).get("precipRate"),
        metric(row, "precipTotal"),
        (row or {}).get("imperial", {}).get("precipTotal"),
        (row or {}).get("precipTotal"),
    )


def pick_daily_rain(summary, row):
    return first_finite(
        metric(summary, "precipTotal"),
        (summary or {}).get("imperial", {}).get("precipTotal"),
        (summary or {}).get("precipTotal"),
        metric(row, "precipTotal"),
        (row or {}).get("imperial", {}).get("precipTotal"),
        (row or {}).get("precipTotal"),
    )


def pick_rain_total(row):
    """Cumulative rainfall when WU provides it; rate is only a last fallback."""
    return first_finite(
        metric(row, "precipTotal"),
        (row or {}).get("imperial", {}).get("precipTotal"),
        (row or {}).get("precipTotal"),
        metric(row, "precipRate"),
        (row or {}).get("imperial", {}).get("precipRate"),
        (row or {}).get("precipRate"),
    )


def pick_solar(row):
    return first_finite(
        (row or {}).get("solarRadiation"),
        metric(row, "solarRadiation"),
        (row or {}).get("imperial", {}).get("solarRadiation"),
    )


def pick_dew(row):
    return first_finite(
        metric(row, "dewpt"), metric(row, "dewPoint"),
        (row or {}).get("imperial", {}).get("dewpt"),
        (row or {}).get("imperial", {}).get("dewPoint"),
    )


def calculate_feels_like(temp_c, humidity, wind_kmh):
    if temp_c is None:
        return None
    if temp_c >= 27 and humidity is not None and 0 < humidity <= 100:
        tf = temp_c * 9 / 5 + 32
        rh = humidity
        hi = (
            -42.379 + 2.04901523 * tf + 10.14333127 * rh
            - 0.22475541 * tf * rh - 0.00683783 * tf * tf
            - 0.05481717 * rh * rh + 0.00122874 * tf * tf * rh
            + 0.00085282 * tf * rh * rh - 0.00000199 * tf * tf * rh * rh
        )
        return (hi - 32) * 5 / 9
    if temp_c <= 10 and wind_kmh is not None and wind_kmh >= 4.8:
        return 13.12 + 0.6215 * temp_c - 11.37 * wind_kmh ** 0.16 + 0.3965 * temp_c * wind_kmh ** 0.16
    return temp_c


def pick_feels(row):
    actual = first_finite(
        metric(row, "feelsLike"), metric(row, "feelslike"),
        (row or {}).get("imperial", {}).get("feelsLike"),
        (row or {}).get("imperial", {}).get("feelslike"),
        (row or {}).get("feelsLike"), (row or {}).get("feelslike"),
    )
    if actual is not None:
        return actual
    return calculate_feels_like(pick_temp(row), pick_humidity(row), pick_wind(row))


def parse_datetime(value):
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=RIYADH_TZ)
        return dt
    except ValueError:
        return None


def observation_time(row):
    return (row or {}).get("obsTimeUtc") or (row or {}).get("obsTimeLocal")


def connected(row):
    dt = parse_datetime(observation_time(row))
    if not dt:
        return False
    age = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60
    return -5 <= age <= OFFLINE_AFTER


def resolve_coordinates(*rows):
    for row in rows:
        lat = first_finite((row or {}).get("lat"), (row or {}).get("latitude"))
        lon = first_finite((row or {}).get("lon"), (row or {}).get("longitude"))
        if lat is not None and lon is not None:
            return lat, lon, "wu"
    lat = finite(LAT_ENV)
    lon = finite(LON_ENV)
    if lat is not None and lon is not None:
        return lat, lon, "env"
    return None


def condition(row):
    hour = datetime.now(RIYADH_TZ).hour
    rain = pick_rain(row)
    wind = pick_wind(row)
    gust = pick_gust(row)
    temp = pick_temp(row)
    if rain is not None and rain > 0:
        return {"label": "مطر", "icon": "🌧️"}
    if (gust is not None and gust >= 35) or (wind is not None and wind >= 30):
        return {"label": "رياح قوية", "icon": "💨"}
    if hour < 6 or hour >= 18:
        return {"label": "صافي ليلاً", "icon": "🌙"}
    if temp is not None and temp >= 40:
        return {"label": "حار جدًا", "icon": "☀️"}
    return {"label": "مشمس", "icon": "☀️"}


def wu_get(url):
    req = Request(url, headers={"User-Agent": "AlMahatta-local/1.5"})
    try:
        with urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"WU HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc


def current_url():
    query = urlencode({
        "stationId": STATION_ID,
        "format": "json",
        "units": "m",
        "numericPrecision": "decimal",
        "apiKey": WU_API_KEY,
    })
    return f"https://api.weather.com/v2/pws/observations/current?{query}"


def hourly_url():
    query = urlencode({
        "stationId": STATION_ID,
        "format": "json",
        "units": "m",
        "numericPrecision": "decimal",
        "apiKey": WU_API_KEY,
    })
    return f"https://api.weather.com/v2/pws/observations/hourly/7day?{query}"


def history_hourly_url(date_key):
    """WU hourly history for one Riyadh calendar day (YYYYMMDD)."""
    query = urlencode({
        "stationId": STATION_ID,
        "format": "json",
        "units": "m",
        "date": date_key,
        "numericPrecision": "decimal",
        "apiKey": WU_API_KEY,
    })
    return f"https://api.weather.com/v2/pws/history/hourly?{query}"


def history_rows(data):
    if not isinstance(data, dict):
        return []
    rows = data.get("observations") or data.get("summaries") or []
    return rows if isinstance(rows, list) else []


def hmetric(row, *keys):
    for key in keys:
        value = finite(metric(row, key))
        if value is not None:
            return value
    return None


def pick_history_temp(row):
    return first_finite(
        hmetric(row, "tempAvg", "temp"),
        hmetric(row, "tempHigh", "tempLow"),
    )


def pick_history_humidity(row):
    return first_finite(
        (row or {}).get("humidityAvg"),
        (row or {}).get("humidity"),
        hmetric(row, "humidityAvg", "humidity"),
    )


def pick_history_wind(row):
    return hmetric(row, "windspeedAvg", "windSpeedAvg", "windSpeed", "windspeedHigh")


def pick_history_gust(row):
    return hmetric(row, "windgustHigh", "windGustHigh", "windGust", "windgustAvg")


def pick_history_pressure(row):
    return hmetric(row, "pressureAvg", "pressure", "pressureMax", "pressureMin")


def pick_history_rain(row):
    return first_finite(
        hmetric(row, "precipTotal", "precipRate"),
        (row or {}).get("precipTotal"),
        (row or {}).get("precipRate"),
    )


def load_day_hourly(date_key):
    """For the current day prefer WU recent 7-day hourly summaries.

    The historical endpoint is intended primarily for completed/past dates and can
    return an incomplete current day. The recent-hourly feed gives the hourly
    summaries needed for today's charts and high/low values.
    """
    try:
        return wu_get(hourly_url())
    except Exception:
        return wu_get(history_hourly_url(date_key))


def daily_range_url(start_key, end_key):
    query = urlencode({
        "stationId": STATION_ID,
        "format": "json",
        "units": "m",
        "startDate": start_key,
        "endDate": end_key,
        "numericPrecision": "decimal",
        "apiKey": WU_API_KEY,
    })
    return f"https://api.weather.com/v2/pws/history/daily?{query}"


def daily_url(date_key):
    # Historical daily endpoint is more reliable for today's recorded high/low.
    return daily_range_url(date_key, date_key)


def latest_observation(data):
    rows = (data or {}).get("observations") or []
    valid = [(parse_datetime(observation_time(r)), r) for r in rows]
    valid = [(dt, r) for dt, r in valid if dt]
    return max(valid, key=lambda pair: pair[0])[1] if valid else None


def date_iso(row):
    return str((row or {}).get("obsTimeLocal") or (row or {}).get("obsTimeUtc") or "")[:10]


def minmax_from_hourly(hourly, iso):
    lows = []
    highs = []
    for row in history_rows(hourly):
        stamp = str((row or {}).get("obsTimeLocal") or (row or {}).get("obsTimeUtc") or "")
        if not stamp.startswith(iso):
            continue
        avg = pick_history_temp(row)
        low = first_finite(hmetric(row, "tempLow"), avg)
        high = first_finite(hmetric(row, "tempHigh"), avg)
        if low is not None:
            lows.append(low)
        if high is not None:
            highs.append(high)
    return (min(lows), max(highs)) if lows and highs else (None, None)


def require_key():
    if not WU_API_KEY:
        raise ValueError("WU_API_KEY غير مضبوط. ضع المفتاح في ملف .env داخل مجلد المشروع.")


def api_weather():
    require_key()
    current = None
    hourly = None
    try:
        data = wu_get(current_url())
        current = (data.get("observations") or [None])[0]
    except Exception:
        try:
            hourly = wu_get(hourly_url())
            current = latest_observation(hourly)
        except Exception:
            pass
    if not current:
        return 502, {"stationConnected": False, "observedAt": None, "error": "لم تصل قراءة من المحطة."}

    iso = date_iso(current)
    summary = None
    date_key = iso.replace("-", "") if len(iso) == 10 else ""
    if date_key:
        try:
            daily = wu_get(daily_url(date_key))
            summaries = daily.get("observations") or daily.get("summaries") or []
            summary = next((x for x in summaries if str(x.get("obsTimeLocal") or x.get("obsTimeUtc") or "").startswith(iso)), summaries[0] if summaries else None)
        except Exception:
            summary = None

    low = first_finite(metric(summary, "tempLow"))
    high = first_finite(metric(summary, "tempHigh"))
    current_temp = pick_temp(current)

    # بعض ملخصات اليوم الجاري تعيد 0 أو قيمًا فارغة للعظمى/الصغرى قبل اكتمال اليوم.
    suspicious_daily = (
        low is None or high is None or
        (current_temp is not None and current_temp > 10 and (low == 0 or high == 0))
    )
    if suspicious_daily:
        try:
            hourly = load_day_hourly(date_key) if date_key else (hourly or wu_get(hourly_url()))
        except Exception:
            hourly = None

    fb_low, fb_high = minmax_from_hourly(hourly, iso)
    # سجل اليوم هو المرجع الأول عند توفره، ثم الملخص اليومي، ثم القراءة الحالية.
    fb_low = first_finite(fb_low, low, current_temp)
    fb_high = first_finite(fb_high, high, current_temp)
    coords = resolve_coordinates(current, summary)

    return 200, {
        "stationId": STATION_ID,
        "stationName": STATION_NAME,
        "stationConnected": connected(current),
        "observedAt": observation_time(current),
        "latitude": coords[0] if coords else None,
        "longitude": coords[1] if coords else None,
        "temperature": pick_temp(current),
        "humidity": pick_humidity(current),
        "windSpeed": pick_wind(current),
        "windDirection": first_finite(current.get("winddir")),
        "windGust": pick_gust(current),
        "pressure": pick_pressure(current),
        "rain": pick_daily_rain(summary, current),
        "uv": first_finite(current.get("uv")),
        "solarRadiation": pick_solar(current),
        "dewPoint": pick_dew(current),
        "feelsLike": pick_feels(current),
        "dayMin": fb_low,
        "dayMax": fb_high,
        "condition": condition(current),
        "source": "Weather Underground",
    }


def api_forecast(language="ar-SA"):
    require_key()
    current = None
    try:
        d = wu_get(current_url())
        current = (d.get("observations") or [None])[0]
    except Exception:
        pass
    coords = resolve_coordinates(current)
    if not coords:
        return 502, {"enabled": False, "error": "تعذر تحديد إحداثيات المحطة. أضف STATION_LATITUDE وSTATION_LONGITUDE إلى .env."}
    lat, lon, source = coords
    query = urlencode({
        "geocode": f"{lat},{lon}",
        "units": "m",
        "language": language if language in ("ar-SA", "en-US") else "ar-SA",
        "format": "json",
        "apiKey": WU_API_KEY,
    })
    data = wu_get(f"https://api.weather.com/v3/wx/forecast/daily/5day?{query}")
    dayparts = ((data.get("daypart") or [{}])[0]).get("precipChance") or []
    days = []
    names = data.get("dayOfWeek") or []
    for i, name in enumerate(names[:5]):
        precip = None
        for idx in (i * 2, i * 2 + 1, i):
            if idx < len(dayparts) and finite(dayparts[idx]) is not None:
                precip = finite(dayparts[idx]); break
        days.append({
            "day": name,
            "max": first_finite((data.get("calendarDayTemperatureMax") or [None] * 5)[i] if i < len(data.get("calendarDayTemperatureMax") or []) else None,
                                (data.get("temperatureMax") or [None] * 5)[i] if i < len(data.get("temperatureMax") or []) else None),
            "min": first_finite((data.get("calendarDayTemperatureMin") or [None] * 5)[i] if i < len(data.get("calendarDayTemperatureMin") or []) else None,
                                (data.get("temperatureMin") or [None] * 5)[i] if i < len(data.get("temperatureMin") or []) else None),
            "phrase": (data.get("narrative") or [""] * 5)[i] if i < len(data.get("narrative") or []) else "",
            "validTime": (data.get("validTimeLocal") or [None] * 5)[i] if i < len(data.get("validTimeLocal") or []) else None,
            "precipChance": precip,
        })
    return 200, {"enabled": True, "source": "WU", "stationName": STATION_NAME, "coordinateSource": source, "days": days}


def api_history_today():
    require_key()
    now = datetime.now(RIYADH_TZ)
    today = now.strftime("%Y-%m-%d")
    date_key = now.strftime("%Y%m%d")

    try:
        data = load_day_hourly(date_key)
    except Exception as exc:
        raise RuntimeError(f"تعذر جلب سجل ساعات اليوم: {exc}") from exc

    points = []
    for row in history_rows(data):
        stamp = str(row.get("obsTimeLocal") or row.get("obsTimeUtc") or "")
        if not stamp.startswith(today):
            continue
        dt = parse_datetime(stamp)
        if dt and dt.astimezone(RIYADH_TZ) > now + timedelta(minutes=2):
            continue
        points.append({
            "observedAt": row.get("obsTimeLocal") or row.get("obsTimeUtc"),
            "temperature": pick_history_temp(row),
            "humidity": pick_history_humidity(row),
            "windSpeed": pick_history_wind(row),
            "windGust": pick_history_gust(row),
            "pressure": pick_history_pressure(row),
            "rain": pick_history_rain(row),
            "dewPoint": first_finite(hmetric(row, "dewptAvg", "dewpt", "dewPoint"), pick_dew(row)),
        })

    points.sort(key=lambda p: parse_datetime(p["observedAt"]) or datetime.min.replace(tzinfo=timezone.utc))

    # أضف أحدث قراءة الفعلية للمحطة، كي يمتد الخط حتى اللحظة الحالية.
    try:
        current_data = wu_get(current_url())
        row = (current_data.get("observations") or [None])[0]
        stamp = (row or {}).get("obsTimeLocal") or (row or {}).get("obsTimeUtc")
        if row and str(stamp or "").startswith(today):
            current_dt = parse_datetime(stamp)
            last_dt = parse_datetime(points[-1]["observedAt"]) if points else None
            if current_dt and (not last_dt or (current_dt - last_dt).total_seconds() > 60):
                points.append({
                    "observedAt": stamp,
                    "temperature": pick_temp(row),
                    "humidity": pick_humidity(row),
                    "windSpeed": pick_wind(row),
                    "windGust": pick_gust(row),
                    "pressure": pick_pressure(row),
                    "rain": pick_rain_total(row),
                    "dewPoint": pick_dew(row),
                })
    except Exception:
        pass

    return 200, {
        "enabled": True,
        "stationName": STATION_NAME,
        "date": today,
        "from": f"{today}T00:00:00+03:00",
        "points": points,
        "source": "Weather Underground",
    }


def daily_history_point(row):
    stamp = str((row or {}).get("obsTimeLocal") or (row or {}).get("obsTimeUtc") or "")
    iso = stamp[:10]
    if len(iso) != 10:
        return None
    high = first_finite(hmetric(row, "tempHigh"), hmetric(row, "tempAvg"))
    low = first_finite(hmetric(row, "tempLow"), hmetric(row, "tempAvg"))
    rain = first_finite(hmetric(row, "precipTotal"), (row or {}).get("precipTotal"), 0)
    return {"date": iso, "tempHigh": high, "tempLow": low, "rain": max(0, rain or 0)}


def load_daily_period(start_date, end_date):
    data = wu_get(daily_range_url(start_date.strftime("%Y%m%d"), end_date.strftime("%Y%m%d")))
    points = []
    for row in history_rows(data):
        point = daily_history_point(row)
        if not point:
            continue
        try:
            day = datetime.strptime(point["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        if start_date.date() <= day <= end_date.date():
            points.append(point)
    points.sort(key=lambda p: p["date"])
    return points


def correct_current_day_daily(points, now):
    today = now.strftime("%Y-%m-%d")
    point = next((p for p in points if p.get("date") == today), None)
    if not point:
        return points
    high = finite(point.get("tempHigh"))
    low = finite(point.get("tempLow"))
    if high not in (None, 0) and low not in (None, 0):
        return points
    try:
        hourly = load_day_hourly(now.strftime("%Y%m%d"))
        fb_low, fb_high = minmax_from_hourly(hourly, today)
        if low in (None, 0) and fb_low is not None:
            point["tempLow"] = fb_low
        if high in (None, 0) and fb_high is not None:
            point["tempHigh"] = fb_high
    except Exception:
        pass
    return points


def rain_is_counted(year, month):
    return (int(year), int(month)) >= (RAIN_STATS_START_YEAR, RAIN_STATS_START_MONTH)


def api_history_month(year=None, month=None):
    require_key()
    now = datetime.now(RIYADH_TZ)
    year = int(year or now.year)
    month = int(month or now.month)
    if year < 2000 or year > now.year or month < 1 or month > 12:
        raise ValueError("الفترة الشهرية غير صالحة.")
    if year == now.year and month > now.month:
        raise ValueError("لا يمكن عرض شهر مستقبلي.")
    last_day = calendar.monthrange(year, month)[1]
    end_day = now.day if year == now.year and month == now.month else last_day
    start = datetime(year, month, 1, tzinfo=RIYADH_TZ)
    end = datetime(year, month, end_day, 23, 59, 59, tzinfo=RIYADH_TZ)
    points = load_daily_period(start, end)
    if year == now.year and month == now.month:
        correct_current_day_daily(points, now)
    if not rain_is_counted(year, month):
        for point in points:
            point["rain"] = 0
    for point in points:
        point["day"] = int(point["date"][8:10])
    return 200, {
        "enabled": True,
        "period": "month",
        "year": year,
        "month": month,
        "points": points,
        "source": "Weather Underground",
    }


def api_history_year(year=None):
    require_key()
    now = datetime.now(RIYADH_TZ)
    year = int(year or now.year)
    if year < 2000 or year > now.year:
        raise ValueError("السنة غير صالحة.")
    last_month = now.month if year == now.year else 12
    monthly = []
    for month in range(1, last_month + 1):
        last_day = calendar.monthrange(year, month)[1]
        end_day = now.day if year == now.year and month == now.month else last_day
        start = datetime(year, month, 1, tzinfo=RIYADH_TZ)
        end = datetime(year, month, end_day, 23, 59, 59, tzinfo=RIYADH_TZ)
        try:
            daily = load_daily_period(start, end)
        except Exception:
            continue
        if year == now.year and month == now.month:
            correct_current_day_daily(daily, now)
        highs = [finite(p.get("tempHigh")) for p in daily]
        lows = [finite(p.get("tempLow")) for p in daily]
        highs = [v for v in highs if v is not None]
        lows = [v for v in lows if v is not None]
        if not daily and not highs and not lows:
            continue
        monthly.append({
            "month": month,
            "tempHigh": max(highs) if highs else None,
            "tempLow": min(lows) if lows else None,
            "rain": sum(max(0, finite(p.get("rain")) or 0) for p in daily) if rain_is_counted(year, month) else 0,
            "days": len(daily),
        })
    return 200, {
        "enabled": True,
        "period": "year",
        "year": year,
        "points": monthly,
        "source": "Weather Underground",
    }


def prayer_get(url):
    req = Request(url, headers={"User-Agent": "AlMahatta-local/1.5"})
    with urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def format_prayer(value):
    text = str(value or "")
    return text[:5] if len(text) >= 5 and ":" in text[:5] else None


def next_prayer_key(timings):
    order = [("fajr", timings.get("Fajr")), ("sunrise", timings.get("Sunrise")), ("dhuhr", timings.get("Dhuhr")),
             ("asr", timings.get("Asr")), ("maghrib", timings.get("Maghrib")), ("isha", timings.get("Isha"))]
    now = datetime.now(RIYADH_TZ)
    current_minutes = now.hour * 60 + now.minute
    parsed = []
    for key, value in order:
        try:
            hh, mm = map(int, str(value).split()[0].split(":"))
            parsed.append((key, hh * 60 + mm))
        except Exception:
            pass
    for key, minutes in parsed:
        if minutes >= current_minutes:
            return key
    return parsed[0][0] if parsed else None


def api_prayer():
    current = None
    if WU_API_KEY:
        try:
            data = wu_get(current_url())
            current = (data.get("observations") or [None])[0]
        except Exception:
            pass
    coords = resolve_coordinates(current)
    if not coords:
        return 502, {"enabled": False, "error": "تعذر تحديد الإحداثيات لأوقات الصلاة. أضف STATION_LATITUDE وSTATION_LONGITUDE إلى .env."}
    lat, lon, source = coords
    now = datetime.now(RIYADH_TZ)
    date = now.strftime("%d-%m-%Y")
    query = urlencode({"latitude": lat, "longitude": lon, "method": 4, "school": 0})
    data = prayer_get(f"https://api.aladhan.com/v1/timings/{date}?{query}")
    payload = data.get("data") or {}
    timings = payload.get("timings") or {}
    hijri = (payload.get("date") or {}).get("hijri") or {}
    times = {
        "fajr": format_prayer(timings.get("Fajr")),
        "sunrise": format_prayer(timings.get("Sunrise")),
        "dhuhr": format_prayer(timings.get("Dhuhr")),
        "asr": format_prayer(timings.get("Asr")),
        "maghrib": format_prayer(timings.get("Maghrib")),
        "isha": format_prayer(timings.get("Isha")),
    }
    hijri_date = None
    if hijri:
        hijri_date = f"{hijri.get('day', '')} {(hijri.get('month') or {}).get('ar', '')} {hijri.get('year', '')}".strip()
    return 200, {
        "enabled": True,
        "date": (payload.get("date") or {}).get("readable") or date,
        "hijriDate": hijri_date,
        "times": times,
        "next": next_prayer_key(timings),
        "source": "AlAdhan · أم القرى",
        "method": 4,
        "coordinateSource": source,
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "AlMahattaLocal/1.8-dev"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path == "/favicon.ico":
            self.path = "/favicon.svg"
        return super().do_HEAD()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # Some browsers still ask for /favicon.ico even when an SVG favicon is declared.
        if path == "/favicon.ico":
            self.path = "/favicon.svg"
            return super().do_GET()

        if path.startswith("/api/"):
            try:
                if path == "/api/weather":
                    status, body = api_weather()
                elif path == "/api/forecast":
                    requested = (query.get("lang") or ["ar-SA"])[0]
                    status, body = api_forecast("en-US" if requested.lower().startswith("en") else "ar-SA")
                elif path in ("/api/history", "/api/history/today"):
                    status, body = api_history_today()
                elif path == "/api/history/month":
                    year = (query.get("year") or [None])[0]
                    month = (query.get("month") or [None])[0]
                    status, body = api_history_month(year, month)
                elif path == "/api/history/year":
                    year = (query.get("year") or [None])[0]
                    status, body = api_history_year(year)
                elif path == "/api/prayer":
                    status, body = api_prayer()
                elif path == "/api/health":
                    status, body = 200, {
                        "ok": True,
                        "service": "AlMahatta Local API",
                        "version": "1.8.0-dev",
                        "stationId": STATION_ID,
                        "hasApiKey": bool(WU_API_KEY),
                    }
                else:
                    status, body = 404, {"error": "Not found."}
            except ValueError as exc:
                status, body = 500, {"error": str(exc)}
            except Exception as exc:
                print("API error:", repr(exc))
                status, body = 502, {"error": "تعذر جلب البيانات من المصدر.", "detail": str(exc)}
            return self.send_json(status, body)

        if path == "/":
            self.path = "/index.html"
        return super().do_GET()


def main():
    port = PORT
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    url = f"http://127.0.0.1:{port}/"
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        print(f"تعذر تشغيل الخادم على المنفذ {port}: {exc}")
        print("جرّب: python server.py 8001")
        raise SystemExit(1)

    print("=" * 58)
    print("AlMahatta local server v1.7 history dev")
    print(f"Open: {url}")
    print(f"Station: {STATION_ID}")
    print(f"WU key: {'configured' if WU_API_KEY else 'NOT configured'}")
    print("Stop: Ctrl+C")
    print("=" * 58)

    if "--no-open" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
