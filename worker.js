/*
 * Station Mobile API — Cloudflare Worker
 * Slimmed for the separate mobile-first station site.
 *
 * Sensitive value:
 *   WU_API_KEY -> add as a Cloudflare Secret.
 *
 * Plain variables:
 *   WU_STATION_ID
 *   STATION_OFFLINE_AFTER_MINUTES
 *   STATION_LATITUDE
 *   STATION_LONGITUDE
 */

let WU_API_KEY = '';
let STATION_ID = 'IMEDIN86';
let STATION_OFFLINE_AFTER_MINUTES = 15;
let STATION_LATITUDE = '';
let STATION_LONGITUDE = '';
const RAIN_STATS_START_YEAR = 2026;
const RAIN_STATS_START_MONTH = 7;

function configure(env) {
  WU_API_KEY = String(env.WU_API_KEY || '');
  STATION_ID = String(env.WU_STATION_ID || 'IMEDIN86');
  STATION_OFFLINE_AFTER_MINUTES = Number(env.STATION_OFFLINE_AFTER_MINUTES || 15);
  STATION_LATITUDE = String(env.STATION_LATITUDE || '');
  STATION_LONGITUDE = String(env.STATION_LONGITUDE || '');
}

const finite = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function firstFinite(...values) {
  for (const v of values) {
    const n = finite(v);
    if (n !== null) return n;
  }
  return null;
}

function resolveStationCoordinates(...sources) {
  for (const source of sources) {
    const latitude = firstFinite(source?.lat, source?.latitude);
    const longitude = firstFinite(source?.lon, source?.longitude);

    if (latitude !== null && longitude !== null) {
      return { latitude, longitude, source: 'wu' };
    }
  }

  const latitude = firstFinite(STATION_LATITUDE);
  const longitude = firstFinite(STATION_LONGITUDE);

  if (latitude !== null && longitude !== null) {
    return { latitude, longitude, source: 'env' };
  }

  return null;
}

function pickTemp(o) {
  return firstFinite(
    o?.metric?.temp,
    o?.imperial?.temp
  );
}

function pickHumidity(o) {
  return firstFinite(o?.humidity);
}

function pickWindSpeed(o) {
  return firstFinite(
    o?.metric?.windSpeed,
    o?.imperial?.windSpeed
  );
}

function pickWindGust(o) {
  return firstFinite(
    o?.metric?.windGust,
    o?.imperial?.windGust
  );
}

function pickPressure(o) {
  return firstFinite(
    o?.metric?.pressure,
    o?.imperial?.pressure
  );
}

function pickRain(o) {
  return firstFinite(
    o?.metric?.precipRate,
    o?.imperial?.precipRate,
    o?.precipRate,
    o?.metric?.precipTotal,
    o?.imperial?.precipTotal,
    o?.precipTotal
  );
}

function pickDailyRain(summary, o) {
  return firstFinite(
    summary?.metric?.precipTotal,
    summary?.imperial?.precipTotal,
    summary?.precipTotal,
    o?.metric?.precipTotal,
    o?.imperial?.precipTotal,
    o?.precipTotal
  );
}

function pickRainTotal(o) {
  return firstFinite(
    o?.metric?.precipTotal,
    o?.imperial?.precipTotal,
    o?.precipTotal,
    o?.metric?.precipRate,
    o?.imperial?.precipRate,
    o?.precipRate
  );
}

function pickSolar(o) {
  return firstFinite(
    o?.solarRadiation,
    o?.metric?.solarRadiation,
    o?.imperial?.solarRadiation
  );
}

/*
 * معادلة المحسوسة للمحطة
 *
 * عند الحرارة المرتفعة:
 * تستخدم Heat Index اعتمادًا على الحرارة والرطوبة.
 *
 * عند الحرارة المنخفضة:
 * تستخدم Wind Chill اعتمادًا على الحرارة وسرعة الرياح.
 *
 * في الظروف الأخرى:
 * تعاد الحرارة الحالية.
 */
function calculateFeelsLike(tempC, humidity, windKmh) {
  if (!Number.isFinite(tempC)) return null;

  // Heat Index
  if (
    tempC >= 27 &&
    Number.isFinite(humidity) &&
    humidity > 0 &&
    humidity <= 100
  ) {
    const tF = tempC * 9 / 5 + 32;
    const rh = humidity;

    const hiF =
      -42.379 +
      2.04901523 * tF +
      10.14333127 * rh -
      0.22475541 * tF * rh -
      0.00683783 * tF * tF -
      0.05481717 * rh * rh +
      0.00122874 * tF * tF * rh +
      0.00085282 * tF * rh * rh -
      0.00000199 * tF * tF * rh * rh;

    return (hiF - 32) * 5 / 9;
  }

  // Wind Chill
  if (
    tempC <= 10 &&
    Number.isFinite(windKmh) &&
    windKmh >= 4.8
  ) {
    return (
      13.12 +
      0.6215 * tempC -
      11.37 * Math.pow(windKmh, 0.16) +
      0.3965 *
        tempC *
        Math.pow(windKmh, 0.16)
    );
  }

  return tempC;
}

/*
 * المحسوسة:
 *
 * 1) نحاول أخذ القيمة الفعلية من WU إذا كانت موجودة.
 * 2) إذا لم تكن موجودة، نحسبها بالمعادلة المحلية المعتمدة.
 */
function pickFeels(o) {
  const wuFeels = firstFinite(
    o?.metric?.feelsLike,
    o?.metric?.feelslike,
    o?.imperial?.feelsLike,
    o?.imperial?.feelslike,
    o?.feelsLike,
    o?.feelslike
  );

  if (wuFeels !== null) {
    return wuFeels;
  }

  return calculateFeelsLike(
    pickTemp(o),
    pickHumidity(o),
    pickWindSpeed(o)
  );
}

function pickDew(o) {
  return firstFinite(
    o?.metric?.dewpt,
    o?.metric?.dewPoint,
    o?.imperial?.dewpt,
    o?.imperial?.dewPoint
  );
}

function observationDate(o) {
  const raw = o?.obsTimeUtc || o?.obsTimeLocal;

  if (!raw) return null;

  const d = new Date(raw);

  return Number.isNaN(d.getTime()) ? null : d;
}

function connected(o) {
  const d = observationDate(o);

  if (!d) return false;

  const age =
    (Date.now() - d.getTime()) / 60000;

  return (
    age >= -5 &&
    age <= STATION_OFFLINE_AFTER_MINUTES
  );
}

function condition(o) {
  const now = new Date();
  const hour = riyadhParts(now).hour;

  const temp = pickTemp(o);
  const rain = pickRain(o);
  const wind = pickWindSpeed(o);
  const gust = pickWindGust(o);

  if (rain !== null && rain > 0) {
    return {
      label: 'مطر',
      icon: '🌧️'
    };
  }

  if (
    (gust !== null && gust >= 35) ||
    (wind !== null && wind >= 30)
  ) {
    return {
      label: 'رياح قوية',
      icon: '💨'
    };
  }

  if (hour < 6 || hour >= 18) {
    return {
      label: 'صافي ليلاً',
      icon: '🌙'
    };
  }

  if (temp !== null && temp >= 40) {
    return {
      label: 'حار جدًا',
      icon: '☀️'
    };
  }

  return {
    label: 'مشمس',
    icon: '☀️'
  };
}

function dayIso(o) {
  return String(
    o?.obsTimeLocal ||
    o?.obsTimeUtc ||
    ''
  ).slice(0, 10);
}

function dateKey(s) {
  const m = String(s || '').match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  return m
    ? `${m[1]}${m[2]}${m[3]}`
    : null;
}

function dayMinMax(hourly, iso) {
  const lows = [];
  const highs = [];

  for (const row of historyRows(hourly)) {
    const stamp = String(row?.obsTimeLocal || row?.obsTimeUtc || '');
    if (!stamp.startsWith(iso)) continue;

    const avg = pickHistoryTemp(row);
    const low = firstFinite(historyMetric(row, 'tempLow'), avg);
    const high = firstFinite(historyMetric(row, 'tempHigh'), avg);
    if (low !== null) lows.push(low);
    if (high !== null) highs.push(high);
  }

  return lows.length && highs.length
    ? { min: Math.min(...lows), max: Math.max(...highs) }
    : { min: null, max: null };
}


async function getJson(url) {
  const r = await fetch(url);
  const text = await r.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!r.ok) {
    throw Object.assign(
      new Error(`WU HTTP ${r.status}`),
      { status: r.status }
    );
  }

  return data;
}

const currentUrl = () =>
  `https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(
    STATION_ID
  )}&format=json&units=m&numericPrecision=decimal&apiKey=${encodeURIComponent(
    WU_API_KEY
  )}`;

const dailyRangeUrl = (start, end) =>
  `https://api.weather.com/v2/pws/history/daily?stationId=${encodeURIComponent(
    STATION_ID
  )}&format=json&units=m&startDate=${encodeURIComponent(
    start
  )}&endDate=${encodeURIComponent(
    end
  )}&numericPrecision=decimal&apiKey=${encodeURIComponent(
    WU_API_KEY
  )}`;

const dailyUrl = d => dailyRangeUrl(d, d);

const hourlyUrl = () =>
  `https://api.weather.com/v2/pws/observations/hourly/7day?stationId=${encodeURIComponent(
    STATION_ID
  )}&format=json&units=m&numericPrecision=decimal&apiKey=${encodeURIComponent(
    WU_API_KEY
  )}`;


const historyHourlyUrl = d =>
  `https://api.weather.com/v2/pws/history/hourly?stationId=${encodeURIComponent(
    STATION_ID
  )}&format=json&units=m&date=${encodeURIComponent(
    d
  )}&numericPrecision=decimal&apiKey=${encodeURIComponent(
    WU_API_KEY
  )}`;

function historyRows(data) {
  if (Array.isArray(data?.observations)) return data.observations;
  if (Array.isArray(data?.summaries)) return data.summaries;
  return [];
}

function historyMetric(row, ...keys) {
  for (const key of keys) {
    const value = finite(row?.metric?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickHistoryTemp(row) {
  return firstFinite(
    historyMetric(row, 'tempAvg', 'temp'),
    historyMetric(row, 'tempHigh', 'tempLow')
  );
}

function pickHistoryHumidity(row) {
  return firstFinite(
    row?.humidityAvg,
    row?.humidity,
    historyMetric(row, 'humidityAvg', 'humidity')
  );
}

function pickHistoryWind(row) {
  return historyMetric(row, 'windspeedAvg', 'windSpeedAvg', 'windSpeed', 'windspeedHigh');
}

function pickHistoryGust(row) {
  return historyMetric(row, 'windgustHigh', 'windGustHigh', 'windGust', 'windgustAvg');
}

function pickHistoryPressure(row) {
  return historyMetric(row, 'pressureAvg', 'pressure', 'pressureMax', 'pressureMin');
}

function pickHistoryRain(row) {
  return firstFinite(
    historyMetric(row, 'precipTotal', 'precipRate'),
    row?.precipTotal,
    row?.precipRate
  );
}

async function loadDayHourly(dateKey) {
  // For the current day, use the recent 7-day hourly summaries first.
  // The historical endpoint can be incomplete while the day is still in progress.
  try {
    return await getJson(hourlyUrl());
  } catch {
    return getJson(historyHourlyUrl(dateKey));
  }
}

function latestObservation(data) {
  const rows = Array.isArray(data?.observations) ? data.observations : [];
  let latest = null;
  let latestTime = -Infinity;
  for (const row of rows) {
    const d = observationDate(row);
    if (!d) continue;
    const t = d.getTime();
    if (t > latestTime) {
      latest = row;
      latestTime = t;
    }
  }
  return latest;
}

async function apiWeather() {
  if (!WU_API_KEY) {
    return {
      status: 500,
      body: {
        error: 'WU_API_KEY غير مضبوط.'
      }
    };
  }

  let o = null;
  let hourly = null;

  try {
    const cur = await getJson(currentUrl());
    o = cur?.observations?.[0] || null;
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e;
  }

  // إذا انتهت صلاحية القراءة الحالية في WU، نحاول استرجاع أحدث قراءة
  // من سجل الأيام الأخيرة حتى نعرف وقت آخر اتصال للمحطة.
  if (!o) {
    try {
      hourly = await getJson(hourlyUrl());
      o = latestObservation(hourly);
    } catch {}
  }

  if (!o) {
    return {
      status: 502,
      body: {
        stationConnected: false,
        observedAt: null,
        error: 'لم تصل قراءة حديثة من المحطة.'
      }
    };
  }

  let summary = null;

  const iso = dayIso(o);
  const dk = dateKey(
    o.obsTimeLocal || o.obsTimeUtc
  );

  if (dk) {
    try {
      const d = await getJson(dailyUrl(dk));

      const list = Array.isArray(d?.observations)
        ? d.observations
        : Array.isArray(d?.summaries)
          ? d.summaries
          : [];

      summary =
        list.find(x =>
          String(
            x?.obsTimeLocal ||
            x?.obsTimeUtc ||
            ''
          ).startsWith(iso)
        ) ||
        list[0] ||
        null;
    } catch {}

    const dailyLow = firstFinite(summary?.metric?.tempLow);
    const dailyHigh = firstFinite(summary?.metric?.tempHigh);
    const currentTemp = pickTemp(o);
    const suspiciousDaily =
      dailyLow === null ||
      dailyHigh === null ||
      (currentTemp !== null && currentTemp > 10 && (dailyLow === 0 || dailyHigh === 0));

    if (suspiciousDaily) {
      try {
        hourly = await loadDayHourly(dk);
      } catch {}
    }
  }

  const fb = dayMinMax(hourly, iso);
  const dailyLow = firstFinite(summary?.metric?.tempLow);
  const dailyHigh = firstFinite(summary?.metric?.tempHigh);

  return {
    status: 200,
    body: {
      stationId: STATION_ID,
      stationName: 'أبيار الماشي · المدينة المنورة',

      stationConnected: connected(o),

      observedAt:
        o.obsTimeUtc ||
        o.obsTimeLocal ||
        null,

      latitude: resolveStationCoordinates(o, summary)?.latitude ?? null,

      longitude: resolveStationCoordinates(o, summary)?.longitude ?? null,

      temperature: pickTemp(o),

      humidity: pickHumidity(o),

      windSpeed: pickWindSpeed(o),

      windDirection: firstFinite(
        o?.winddir
      ),

      windGust: pickWindGust(o),

      pressure: pickPressure(o),

      rain: pickDailyRain(summary, o),

      uv: firstFinite(o?.uv),

      solarRadiation: pickSolar(o),

      dewPoint: pickDew(o),

      // المحسوسة بعد الإصلاح
      feelsLike: pickFeels(o),

      dayMin: firstFinite(fb.min, dailyLow, pickTemp(o)),

      dayMax: firstFinite(fb.max, dailyHigh, pickTemp(o)),

      condition: condition(o),

      source: 'Weather Underground'
    }
  };
}

async function apiForecast(language = 'ar-SA') {
  if (!WU_API_KEY) {
    return {
      status: 500,
      body: {
        enabled: false,
        error: 'WU_API_KEY غير مضبوط.'
      }
    };
  }

  let o = null;

  try {
    const cur = await getJson(currentUrl());
    o = cur?.observations?.[0] || null;
  } catch (error) {
    if (error.status === 401 || error.status === 403) throw error;
  }

  // نستخدم إحداثيات WU عند توفرها، ثم متغيرات البيئة كخيار احتياطي.
  const coordinates = resolveStationCoordinates(o);

  if (!coordinates) {
    return {
      status: 502,
      body: {
        enabled: false,
        error: 'لم نستطع تحديد إحداثيات المحطة.'
      }
    };
  }

  const lat = coordinates.latitude;
  const lon = coordinates.longitude;

  // المحطة تعرض توقعات خمسة أيام فقط.

  const u =
    `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${encodeURIComponent(
      `${lat},${lon}`
    )}&units=m&language=ar-SA&format=json&apiKey=${encodeURIComponent(
      WU_API_KEY
    )}`;

  let d;

  try {
    d = await getJson(u);
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      return {
        status: 200,
        body: {
          enabled: false,
          message:
            'مفتاح WU الحالي لا يملك صلاحية توقعات 5 أيام.'
        }
      };
    }

    throw e;
  }

  const days = (d.dayOfWeek || [])
    .map((day, i) => ({
      day,

      max: firstFinite(
        d.calendarDayTemperatureMax?.[i],
        d.temperatureMax?.[i]
      ),

      min: firstFinite(
        d.calendarDayTemperatureMin?.[i],
        d.temperatureMin?.[i]
      ),

      phrase: d.narrative?.[i] || '',

      validTime:
        d.validTimeLocal?.[i] || null,

      precipChance: firstFinite(
        d.daypart?.[0]?.precipChance?.[i * 2],
        d.daypart?.[0]?.precipChance?.[i * 2 + 1],
        d.precipChance?.[i]
      )
    }))
    .filter(
      x =>
        x.validTime ||
        x.max !== null ||
        x.min !== null ||
        x.precipChance !== null ||
        String(x.phrase || '').trim()
    )
    .slice(0, 5);

  return {
    status: 200,
    body: {
      enabled: true,
      source: 'WU',
      stationName: 'أبيار الماشي · المدينة المنورة',
      coordinateSource: coordinates.source,
      days
    }
  };
}


function formatPrayerTime(value) {
  if (!value) return null;

  const match = String(value).match(/^(\d{1,2}:\d{2})/);
  return match ? match[1] : null;
}

function riyadhParts(date = new Date()) {
  const values = {};
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).formatToParts(date);

  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function nextPrayer(timings) {
  if (!timings) return null;

  const order = [
    ['fajr', timings.Fajr],
    ['sunrise', timings.Sunrise],
    ['dhuhr', timings.Dhuhr],
    ['asr', timings.Asr],
    ['maghrib', timings.Maghrib],
    ['isha', timings.Isha]
  ];

  const now = riyadhParts();
  const minutesNow = now.hour * 60 + now.minute;
  const parsed = order
    .map(([key, value]) => {
      const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      return { key, minutes: Number(m[1]) * 60 + Number(m[2]) };
    })
    .filter(Boolean);

  const upcoming = parsed.find(item => item.minutes >= minutesNow);
  return upcoming?.key || parsed[0]?.key || null;
}

const MOON_RAD = Math.PI / 180;
const MOON_DAY_MS = 86400000;
const MOON_J1970 = 2440588;
const MOON_J2000 = 2451545;

function moonToJulian(date) {
  return date.valueOf() / MOON_DAY_MS - 0.5 + MOON_J1970;
}

function moonToDays(date) {
  return moonToJulian(date) - MOON_J2000;
}

function moonRightAscension(l, b) {
  const e = MOON_RAD * 23.4397;
  return Math.atan2(
    Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e),
    Math.cos(l)
  );
}

function moonDeclination(l, b) {
  const e = MOON_RAD * 23.4397;
  return Math.asin(
    Math.sin(b) * Math.cos(e) +
    Math.cos(b) * Math.sin(e) * Math.sin(l)
  );
}

function moonCoords(days) {
  const L = MOON_RAD * (218.316 + 13.176396 * days);
  const M = MOON_RAD * (134.963 + 13.064993 * days);
  const F = MOON_RAD * (93.272 + 13.229350 * days);
  const l = L + MOON_RAD * 6.289 * Math.sin(M);
  const b = MOON_RAD * 5.128 * Math.sin(F);
  return {
    ra: moonRightAscension(l, b),
    dec: moonDeclination(l, b)
  };
}

function moonAltitude(date, latitude, longitude) {
  const lw = MOON_RAD * -longitude;
  const phi = MOON_RAD * latitude;
  const days = moonToDays(date);
  const coords = moonCoords(days);
  const sidereal = MOON_RAD * (280.16 + 360.9856235 * days) - lw;
  const H = sidereal - coords.ra;
  let h = Math.asin(
    Math.sin(phi) * Math.sin(coords.dec) +
    Math.cos(phi) * Math.cos(coords.dec) * Math.cos(H)
  );

  const refractionAltitude = h < 0 ? 0 : h;
  h += 0.0002967 / Math.tan(
    refractionAltitude + 0.00312536 / (refractionAltitude + 0.08901179)
  );
  return h;
}

function hoursLater(date, hours) {
  return new Date(date.valueOf() + hours * MOON_DAY_MS / 24);
}

function moonTimesForRiyadhDay(date, latitude, longitude) {
  const p = riyadhParts(date);
  const pad = value => String(value).padStart(2, '0');
  const start = new Date(`${p.year}-${pad(p.month)}-${pad(p.day)}T00:00:00+03:00`);
  const hc = 0.133 * MOON_RAD;
  let h0 = moonAltitude(start, latitude, longitude) - hc;
  let rise = null;
  let set = null;

  for (let i = 1; i <= 23; i += 2) {
    const h1 = moonAltitude(hoursLater(start, i), latitude, longitude) - hc;
    const h2 = moonAltitude(hoursLater(start, i + 1), latitude, longitude) - hc;
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;

    if (Math.abs(a) > 1e-12) {
      const xe = -b / (2 * a);
      const ye = (a * xe + b) * xe + h1;
      const disc = b * b - 4 * a * h1;

      if (disc >= 0) {
        const dx = Math.sqrt(disc) / (Math.abs(a) * 2);
        let x1 = xe - dx;
        const x2 = xe + dx;
        let roots = 0;

        if (Math.abs(x1) <= 1) roots++;
        if (Math.abs(x2) <= 1) roots++;
        if (x1 < -1) x1 = x2;

        if (roots === 1) {
          if (h0 < 0) rise = i + x1;
          else set = i + x1;
        } else if (roots === 2) {
          rise = i + (ye < 0 ? x2 : x1);
          set = i + (ye < 0 ? x1 : x2);
        }
      }
    }

    if (rise !== null && set !== null) break;
    h0 = h2;
  }

  return {
    rise: rise === null ? null : hoursLater(start, rise),
    set: set === null ? null : hoursLater(start, set)
  };
}

function nextMoonTimes(date, latitude, longitude) {
  let rise = null;
  let set = null;

  for (let offset = 0; offset <= 2 && (rise === null || set === null); offset++) {
    const day = new Date(date.valueOf() + offset * MOON_DAY_MS);
    const times = moonTimesForRiyadhDay(day, latitude, longitude);

    if (rise === null && times.rise && times.rise >= date) rise = times.rise;
    if (set === null && times.set && times.set >= date) set = times.set;
  }

  return { rise, set };
}

function formatRiyadhClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).format(date);
}


async function apiHistoryToday() {
  if (!WU_API_KEY) {
    return {
      status: 500,
      body: { enabled: false, error: 'WU_API_KEY غير مضبوط.' }
    };
  }

  const now = riyadhParts();
  const iso = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
  const dk = `${now.year}${String(now.month).padStart(2, '0')}${String(now.day).padStart(2, '0')}`;

  let data;
  try {
    data = await loadDayHourly(dk);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return {
        status: 200,
        body: {
          enabled: false,
          message: 'مفتاح WU الحالي لا يملك صلاحية سجل الساعات.'
        }
      };
    }
    throw error;
  }

  const points = historyRows(data)
    .filter(row => String(row?.obsTimeLocal || row?.obsTimeUtc || '').startsWith(iso))
    .map(row => ({
      observedAt: row?.obsTimeLocal || row?.obsTimeUtc || null,
      temperature: pickHistoryTemp(row),
      humidity: pickHistoryHumidity(row),
      windSpeed: pickHistoryWind(row),
      windGust: pickHistoryGust(row),
      pressure: pickHistoryPressure(row),
      rain: pickHistoryRain(row),
      dewPoint: firstFinite(historyMetric(row, 'dewptAvg', 'dewpt', 'dewPoint'), pickDew(row))
    }))
    .filter(row => row.observedAt)
    .sort(
      (a, b) =>
        new Date(a.observedAt).getTime() -
        new Date(b.observedAt).getTime()
    );

  try {
    const current = await getJson(currentUrl());
    const row = current?.observations?.[0] || null;
    const observedAt = row?.obsTimeLocal || row?.obsTimeUtc || null;
    if (row && String(observedAt || '').startsWith(iso)) {
      const last = points[points.length - 1];
      const currentMs = new Date(observedAt).getTime();
      const lastMs = last ? new Date(last.observedAt).getTime() : 0;
      if (Number.isFinite(currentMs) && currentMs > lastMs + 60000) {
        points.push({
          observedAt,
          temperature: pickTemp(row),
          humidity: pickHumidity(row),
          windSpeed: pickWindSpeed(row),
          windGust: pickWindGust(row),
          pressure: pickPressure(row),
          rain: pickRainTotal(row),
          dewPoint: pickDew(row)
        });
      }
    }
  } catch {}

  return {
    status: 200,
    body: {
      enabled: true,
      stationName: 'أبيار الماشي · المدينة المنورة',
      date: iso,
      from: `${iso}T00:00:00+03:00`,
      points,
      source: 'Weather Underground'
    }
  };
}


function historicalDewPoint(tempC, humidity) {
  const t = finite(tempC);
  const rh = finite(humidity);
  if (t === null || rh === null || rh <= 0 || rh > 100) return null;
  const a = 17.62;
  const b = 243.12;
  const gamma = Math.log(rh / 100) + (a * t) / (b + t);
  const dew = (b * gamma) / (a - gamma);
  return Number.isFinite(dew) ? dew : null;
}

function dailyHistoryPoint(row) {
  const stamp = String(row?.obsTimeLocal || row?.obsTimeUtc || '');
  const date = stamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const high = firstFinite(historyMetric(row, 'tempHigh'), historyMetric(row, 'tempAvg'));
  const low = firstFinite(historyMetric(row, 'tempLow'), historyMetric(row, 'tempAvg'));
  const tempAvg = firstFinite(
    historyMetric(row, 'tempAvg', 'temp'),
    high !== null && low !== null ? (high + low) / 2 : null
  );
  const humidityAvg = pickHistoryHumidity(row);
  const dewPoint = firstFinite(
    historyMetric(row, 'dewptAvg', 'dewPointAvg', 'dewpt', 'dewPoint'),
    row?.dewptAvg,
    row?.dewPointAvg,
    historicalDewPoint(tempAvg, humidityAvg)
  );
  const rain = Math.max(0, firstFinite(historyMetric(row, 'precipTotal'), row?.precipTotal, 0) || 0);
  return { date, tempHigh: high, tempLow: low, tempAvg, dewPoint, rain };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateKeyParts(year, month, day) {
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

async function loadDailyPeriod(year, month, endDay) {
  const start = dateKeyParts(year, month, 1);
  const end = dateKeyParts(year, month, endDay);
  const data = await getJson(dailyRangeUrl(start, end));
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return historyRows(data)
    .map(dailyHistoryPoint)
    .filter(Boolean)
    .filter(point => point.date.startsWith(prefix) && Number(point.date.slice(8, 10)) <= endDay)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function dayAverageTempDew(hourly, iso) {
  const temps = [];
  const dews = [];
  for (const row of historyRows(hourly)) {
    const stamp = String(row?.obsTimeLocal || row?.obsTimeUtc || '');
    if (!stamp.startsWith(iso)) continue;
    const temp = pickHistoryTemp(row);
    const dew = firstFinite(
      historyMetric(row, 'dewptAvg', 'dewpt', 'dewPoint'),
      pickDew(row),
      historicalDewPoint(temp, pickHistoryHumidity(row))
    );
    if (temp !== null) temps.push(temp);
    if (dew !== null) dews.push(dew);
  }
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return { tempAvg: average(temps), dewPoint: average(dews) };
}

async function correctCurrentDayDaily(points, now) {
  const iso = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
  const point = points.find(p => p.date === iso);
  if (!point) return points;
  const high = finite(point.tempHigh);
  const low = finite(point.tempLow);
  try {
    const hourly = await loadDayHourly(dateKeyParts(now.year, now.month, now.day));
    const fb = dayMinMax(hourly, iso);
    const avg = dayAverageTempDew(hourly, iso);
    if ((low === null || low === 0) && fb.min !== null) point.tempLow = fb.min;
    if ((high === null || high === 0) && fb.max !== null) point.tempHigh = fb.max;
    if (avg.tempAvg !== null) point.tempAvg = avg.tempAvg;
    if (avg.dewPoint !== null) point.dewPoint = avg.dewPoint;
  } catch {}
  return points;
}

function rainIsCounted(year, month) {
  return Number(year) > RAIN_STATS_START_YEAR ||
    (Number(year) === RAIN_STATS_START_YEAR && Number(month) >= RAIN_STATS_START_MONTH);
}

async function apiHistoryMonth(yearParam = null, monthParam = null) {
  if (!WU_API_KEY) return { status: 500, body: { enabled: false, error: 'WU_API_KEY غير مضبوط.' } };
  const now = riyadhParts();
  const year = Number(yearParam || now.year);
  const month = Number(monthParam || now.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || year > now.year || month < 1 || month > 12 || (year === now.year && month > now.month)) {
    return { status: 400, body: { enabled: false, error: 'الفترة الشهرية غير صالحة.' } };
  }
  const endDay = year === now.year && month === now.month ? now.day : daysInMonth(year, month);
  let points;
  try {
    points = await loadDailyPeriod(year, month, endDay);
    if (year === now.year && month === now.month) await correctCurrentDayDaily(points, now);
    if (!rainIsCounted(year, month)) points = points.map(point => ({ ...point, rain: 0 }));
  } catch (error) {
    if (error.status === 401 || error.status === 403) return { status: 200, body: { enabled: false, message: 'مفتاح WU الحالي لا يملك صلاحية السجل اليومي.' } };
    throw error;
  }
  points = points.map(point => ({ ...point, day: Number(point.date.slice(8, 10)) }));
  return { status: 200, body: { enabled: true, period: 'month', year, month, points, source: 'Weather Underground' } };
}

async function apiHistoryYear(yearParam = null) {
  if (!WU_API_KEY) return { status: 500, body: { enabled: false, error: 'WU_API_KEY غير مضبوط.' } };
  const now = riyadhParts();
  const year = Number(yearParam || now.year);
  if (!Number.isInteger(year) || year < 2000 || year > now.year) return { status: 400, body: { enabled: false, error: 'السنة غير صالحة.' } };
  const lastMonth = year === now.year ? now.month : 12;
  const points = [];
  for (let month = 1; month <= lastMonth; month++) {
    const endDay = year === now.year && month === now.month ? now.day : daysInMonth(year, month);
    let daily;
    try {
      daily = await loadDailyPeriod(year, month, endDay);
      if (year === now.year && month === now.month) await correctCurrentDayDaily(daily, now);
    }
    catch (error) {
      if (error.status === 401 || error.status === 403) return { status: 200, body: { enabled: false, message: 'مفتاح WU الحالي لا يملك صلاحية السجل اليومي.' } };
      continue;
    }
    const highs = daily.map(p => finite(p.tempHigh)).filter(v => v !== null);
    const lows = daily.map(p => finite(p.tempLow)).filter(v => v !== null);
    if (!daily.length && !highs.length && !lows.length) continue;
    points.push({
      month,
      tempHigh: highs.length ? Math.max(...highs) : null,
      tempLow: lows.length ? Math.min(...lows) : null,
      rain: rainIsCounted(year, month)
        ? daily.reduce((sum, p) => sum + Math.max(0, finite(p.rain) || 0), 0)
        : 0,
      days: daily.length
    });
  }
  return { status: 200, body: { enabled: true, period: 'year', year, points, source: 'Weather Underground' } };
}


async function apiPrayer() {
  let o = null;

  try {
    const cur = await getJson(currentUrl());
    o = cur?.observations?.[0] || null;
  } catch (error) {
    if (error.status === 401 || error.status === 403) throw error;
  }

  // الصلاة والقمر لا يتوقفان مع المحطة: WU أولًا، ثم الإحداثيات المحفوظة في البيئة.
  const coordinates = resolveStationCoordinates(o);

  if (!coordinates) {
    return {
      status: 502,
      body: {
        enabled: false,
        error: 'لم نستطع تحديد إحداثيات المحطة لأوقات الصلاة.'
      }
    };
  }

  const latitude = coordinates.latitude;
  const longitude = coordinates.longitude;

  const now = new Date();
  const local = riyadhParts(now);
  const dd = String(local.day).padStart(2, '0');
  const mm = String(local.month).padStart(2, '0');
  const yyyy = local.year;
  const date = `${dd}-${mm}-${yyyy}`;

  // طريقة أم القرى: Umm Al-Qura University, Makkah — Method 4.
  const url =
    `https://api.aladhan.com/v1/timings/${date}` +
    `?latitude=${encodeURIComponent(latitude)}` +
    `&longitude=${encodeURIComponent(longitude)}` +
    `&method=4` +
    `&school=0`;

  let data;

  try {
    data = await getJson(url);
  } catch (error) {
    console.warn('AlAdhan prayer times unavailable:', error.message);

    return {
      status: 200,
      body: {
        enabled: false,
        message: 'تعذر جلب أوقات الصلاة من المصدر حاليًا.'
      }
    };
  }

  const timings = data?.data?.timings;

  if (!timings) {
    return {
      status: 200,
      body: {
        enabled: false,
        message: 'لم تصل أوقات الصلاة من المصدر.'
      }
    };
  }

  const names = [
    ['fajr', 'الفجر', 'Fajr'],
    ['sunrise', 'الشروق', 'Sunrise'],
    ['dhuhr', 'الظهر', 'Dhuhr'],
    ['asr', 'العصر', 'Asr'],
    ['maghrib', 'المغرب', 'Maghrib'],
    ['isha', 'العشاء', 'Isha']
  ];

  const times = {};

  for (const [key, , sourceKey] of names) {
    times[key] = formatPrayerTime(timings[sourceKey]);
  }

  const hijri = data?.data?.date?.hijri;

  return {
    status: 200,
    body: {
      enabled: true,
      date: data?.data?.date?.readable || date,
      hijriDate: hijri
        ? `${hijri.day} ${hijri.month?.ar || ''} ${hijri.year}`
        : null,
      times,
      next: nextPrayer(timings),
      moon: (() => {
        const moon = nextMoonTimes(now, latitude, longitude);
        return {
          rise: formatRiyadhClock(moon.rise),
          set: formatRiyadhClock(moon.set)
        };
      })(),
      source: 'AlAdhan · أم القرى',
      method: 4,
      latitude,
      longitude,
      coordinateSource: coordinates.source
    }
  };
}


const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff'
};

function jsonResponse(body, status = 200, maxAge = 0, cacheState = 'MISS') {
  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store');
  headers.set('X-Station-Cache', cacheState);
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(response, cacheState = null) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  if (cacheState) headers.set('X-Station-Cache', cacheState);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function cachedJson(request, ctx, ttlSeconds, producer) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, 'HIT');

  const result = await producer();
  const cacheable =
    result.status === 200 &&
    result.body?.error === undefined &&
    result.body?.enabled !== false;

  const response = jsonResponse(
    result.body,
    result.status,
    cacheable ? ttlSeconds : 0,
    'MISS'
  );

  if (cacheable && ttlSeconds > 0) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    configure(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'Method not allowed.' }, 405);
    }

    const url = new URL(request.url);

    try {

      if (url.pathname === '/api/weather') {
        // القراءة الحالية: نحو دقيقة واحدة.
        return cachedJson(request, ctx, 55, apiWeather);
      }

      if (url.pathname === '/api/forecast') {
        // توقعات خمسة أيام لا تحتاج تحديثًا متكررًا.
        const language = String(url.searchParams.get('lang') || 'ar-SA').toLowerCase().startsWith('en') ? 'en-US' : 'ar-SA';
        return cachedJson(request, ctx, 1800, () => apiForecast(language));
      }

      if (url.pathname === '/api/history/month') {
        const year = url.searchParams.get('year');
        const month = url.searchParams.get('month');
        return cachedJson(request, ctx, 900, () => apiHistoryMonth(year, month));
      }

      if (url.pathname === '/api/history/year') {
        const year = url.searchParams.get('year');
        return cachedJson(request, ctx, 3600, () => apiHistoryYear(year));
      }

      if (url.pathname === '/api/prayer') {
        // نبقيها قصيرة لأن حقل next يتغير أثناء اليوم.
        return cachedJson(request, ctx, 60, apiPrayer);
      }

      if (url.pathname === '/api/history' || url.pathname === '/api/history/today') {
        // حركة اليوم من سجل الساعات، مع أحدث قراءة عند توفرها.
        return cachedJson(request, ctx, 300, apiHistoryToday);
      }

      if (url.pathname === '/api/health' || url.pathname === '/') {
        return jsonResponse({
          ok: true,
          service: 'Station Mobile API',
          version: 'mahatta-worker-1.9.0',
          stationId: STATION_ID,
          hasApiKey: Boolean(WU_API_KEY)
        });
      }

      return jsonResponse({ error: 'Not found.' }, 404);
    } catch (error) {
      console.error(error);
      return jsonResponse({
        error: 'تعذر تنفيذ الطلب.'
      }, 502);
    }
  }
};
