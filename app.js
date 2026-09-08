(() => {
  "use strict";

  const API_BASE = String(window.STATION_API_BASE || "").replace(/\/$/, "");
  const $ = id => document.getElementById(id);
  const tabs = [...document.querySelectorAll(".tab")];
  const panels = [...document.querySelectorAll(".panel")];
  const STATIC_PREVIEW = location.protocol === "file:" && !API_BASE;

  const defaults = {
    units: "metric",
    theme: "light",
    language: "ar",
    showRainChart: false,
    showPressureChart: false
  };

  function readSettings() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem("almahattahSettings") || "{}") };
    } catch {
      return { ...defaults };
    }
  }

  const settings = readSettings();
  const loaded = { current: false, forecast: false, history: false, prayer: false };
  const cache = { current: null, forecast: null, history: null, prayer: null };
  const longHistoryLoaded = { month: false, year: false };
  const longHistoryCache = { month: null, year: null };
  let historyPeriod = "day";

  const translations = {
    ar: {
      brandTitle: "المحطة", brandSubtitle: "أبيار الماشي · المدينة المنورة",
      refresh: "تحديث الآن", units: "الوحدات", metric: "متري", imperial: "إنجليزي",
      appearance: "المظهر", light: "فاتح", dark: "داكن", language: "اللغة",
      extraCharts: "شارتات إضافية", rainChart: "المطر", pressureChart: "الضغط الجوي",
      menuNote: "الطقس من Weather Underground · أوقات الصلاة حسب أم القرى",
      currentTab: "الحالية", forecastTab: "التوقعات", historyTab: "التاريخ", prayerTab: "أوقات الصلاة",
      max: "العظمى", min: "الصغرى", feels: "المحسوسة", stationNow: "المحطة الآن",
      humidity: "الرطوبة", windSpeed: "سرعة الرياح", windGust: "هبّات الرياح", windDirection: "اتجاه الرياح",
      pressure: "الضغط", rainToday: "مطر اليوم", dewPoint: "نقطة الندى", solar: "الإشعاع الشمسي", uv: "مؤشر UV",
      nearForecast: "التوقعات القريبة", fiveDays: "خمسة أيام", loadingForecast: "جارٍ تحميل التوقعات…",
      todayMovement: "حركة اليوم", monthMovement: "الشهر الحالي", yearMovement: "السنة الحالية",
      historyDay: "يومي", historyMonth: "شهري", historyYear: "سنوي", yearSummaryChart: "الحرارة والمطر",
      loadingHistory: "جارٍ تحميل سجل اليوم…", loadingMonthHistory: "جارٍ تحميل سجل الشهر…", loadingYearHistory: "جارٍ تحميل سجل السنة…", temperatureChart: "الحرارة",
      windChart: "الرياح والهبات", windShort: "الرياح", gustShort: "الهبات", ummAlQura: "أم القرى",
      nextPrayer: "الصلاة القادمة", loadingPrayer: "جارٍ تحميل أوقات الصلاة…",
      waiting: "جارٍ الاتصال", online: "متصلة", offline: "غير متصلة", lastReading: "أحدث قراءة",
      fromMidnight: "من 00:00 حتى الآن", noData: "لا توجد بيانات يومية كافية حتى الآن.",
      today: "اليوم", tomorrow: "غدًا", rainChance: "فرصة المطر", hijri: "التاريخ الهجري",
      historyUnavailable: "تعذر تحميل حركة اليوم حاليًا.", longHistoryUnavailable: "تعذر تحميل بيانات هذه الفترة حاليًا.", periodNoData: "لا توجد بيانات كافية لهذه الفترة.", forecastUnavailable: "تعذر تحميل التوقعات حاليًا.",
      prayerUnavailable: "تعذر تحميل أوقات الصلاة حاليًا.", dataConnected: "تظهر البيانات عند ربط خدمة البيانات."
    },
    en: {
      brandTitle: "Station", brandSubtitle: "Abyar Al-Mashi · Madinah",
      refresh: "Refresh now", units: "Units", metric: "Metric", imperial: "Imperial",
      appearance: "Appearance", light: "Light", dark: "Dark", language: "Language",
      extraCharts: "Extra charts", rainChart: "Rain", pressureChart: "Pressure",
      menuNote: "Weather by Weather Underground · Prayer times by Umm Al-Qura",
      currentTab: "Current", forecastTab: "Forecast", historyTab: "History", prayerTab: "Prayer times",
      max: "High", min: "Low", feels: "Feels like", stationNow: "Station now",
      humidity: "Humidity", windSpeed: "Wind speed", windGust: "Wind gusts", windDirection: "Wind direction",
      pressure: "Pressure", rainToday: "Rain today", dewPoint: "Dew point", solar: "Solar radiation", uv: "UV index",
      nearForecast: "Near forecast", fiveDays: "Five days", loadingForecast: "Loading forecast…",
      todayMovement: "Today", monthMovement: "Current month", yearMovement: "Current year",
      historyDay: "Daily", historyMonth: "Monthly", historyYear: "Yearly", yearSummaryChart: "Temperature & rain",
      loadingHistory: "Loading today's history…", loadingMonthHistory: "Loading this month…", loadingYearHistory: "Loading this year…", temperatureChart: "Temperature",
      windChart: "Wind & gusts", windShort: "Wind", gustShort: "Gusts", ummAlQura: "Umm Al-Qura",
      nextPrayer: "Next prayer", loadingPrayer: "Loading prayer times…",
      waiting: "Connecting", online: "Online", offline: "Offline", lastReading: "Last reading",
      fromMidnight: "From 00:00 until now", noData: "Not enough data for today yet.",
      today: "Today", tomorrow: "Tomorrow", rainChance: "Rain chance", hijri: "Hijri date",
      historyUnavailable: "Unable to load today's history.", longHistoryUnavailable: "Unable to load this period.", periodNoData: "Not enough data for this period.", forecastUnavailable: "Unable to load forecast.",
      prayerUnavailable: "Unable to load prayer times.", dataConnected: "Data appears when the data service is connected."
    }
  };

  const prayerNames = {
    ar: { fajr: "الفجر", sunrise: "الشروق", dhuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء" },
    en: { fajr: "Fajr", sunrise: "Sunrise", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" }
  };

  function t(key) {
    return translations[settings.language]?.[key] || translations.ar[key] || key;
  }

  function saveSettings() {
    try { localStorage.setItem("almahattahSettings", JSON.stringify(settings)); } catch {}
  }

  function apiUrl(path) { return `${API_BASE}${path}`; }

  async function getJson(path) {
    const response = await fetch(apiUrl(path), { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.data = data;
      throw error;
    }
    return data;
  }

  // مهم: null و"" قيم مفقودة، وليستا الرقم صفر.
  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function number(value, digits = 1) {
    const n = finiteNumber(value);
    if (n === null) return "—";
    return new Intl.NumberFormat(settings.language === "en" ? "en-US" : "en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits
    }).format(n);
  }

  function convert(kind, value) {
    const n = finiteNumber(value);
    if (n === null) return null;
    if (settings.units === "metric") return n;
    if (kind === "temp") return n * 9 / 5 + 32;
    if (kind === "wind") return n * 0.621371;
    if (kind === "pressure") return n * 0.0295299830714;
    if (kind === "rain") return n / 25.4;
    return n;
  }

  function unit(kind) {
    const imperial = settings.units === "imperial";
    if (kind === "temp") return "°";
    if (kind === "wind") return imperial ? " mph" : (settings.language === "ar" ? " كم/س" : " km/h");
    if (kind === "pressure") return imperial ? " inHg" : " hPa";
    if (kind === "rain") return imperial ? " in" : (settings.language === "ar" ? " مم" : " mm");
    if (kind === "solar") return " W/m²";
    if (kind === "humidity") return "%";
    return "";
  }

  function valueWithUnit(value, kind = "", digits = 1) {
    const converted = kind ? convert(kind, value) : finiteNumber(value);
    if (converted === null) return "—";
    return `${number(converted, digits)}${kind ? unit(kind) : ""}`;
  }

  function timeInRiyadh(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      const match = String(value).match(/T(\d{2}:\d{2})/);
      return match?.[1] || "—";
    }
    return new Intl.DateTimeFormat(settings.language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
      timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date);
  }

  function dateArabic(value) {
    if (!value) return t("fromMidnight");
    const date = new Date(`${value}T12:00:00+03:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(settings.language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
      timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long"
    }).format(date);
  }

  function monthTitle(year, month) {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 15, 12));
    if (Number.isNaN(date.getTime())) return `${month}/${year}`;
    return new Intl.DateTimeFormat(settings.language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
      timeZone: "Asia/Riyadh", month: "long", year: "numeric"
    }).format(date);
  }

  function monthShort(month) {
    const date = new Date(Date.UTC(2026, Number(month) - 1, 15, 12));
    if (Number.isNaN(date.getTime())) return String(month);
    return new Intl.DateTimeFormat(settings.language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
      timeZone: "Asia/Riyadh", month: "short"
    }).format(date);
  }

  function windDirection(deg) {
    const n = finiteNumber(deg);
    if (n === null) return "—";
    const ar = ["شمال", "شمال شرقي", "شمال شرقي", "شرق شمالي", "شرق", "شرق جنوبي", "جنوب شرقي", "جنوب شرقي", "جنوب", "جنوب غربي", "جنوب غربي", "غرب جنوبي", "غرب", "غرب شمالي", "شمال غربي", "شمال غربي"];
    const en = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const index = Math.round((((n % 360) + 360) % 360) / 22.5) % 16;
    return (settings.language === "en" ? en : ar)[index];
  }

  function forecastIcon(phrase) {
    const text = String(phrase || "").toLowerCase();
    if (text.includes("رعد") || text.includes("عاصف") || text.includes("thunder") || text.includes("storm")) return "⛈️";
    if (text.includes("مطر") || text.includes("أمطار") || text.includes("rain") || text.includes("shower")) return "🌧️";
    if (text.includes("غبار") || text.includes("أتربة") || text.includes("عوالق") || text.includes("dust")) return "🌫️";
    if (text.includes("غائم") || text.includes("سحب") || text.includes("cloud")) return "☁️";
    if (text.includes("ليل") || text.includes("night")) return "🌙";
    if (text.includes("مشمس") || text.includes("صحو") || text.includes("sunny") || text.includes("clear")) return "☀️";
    return "🌤️";
  }

  function conditionText(label) {
    if (settings.language === "ar") return label || "—";
    const map = { "مطر": "Rain", "رياح قوية": "Strong winds", "صافي ليلاً": "Clear night", "حار جدًا": "Very hot", "مشمس": "Sunny" };
    return map[label] || label || "—";
  }

  function setStationState(connected) {
    const badge = $("stationBadge");
    badge.classList.remove("is-waiting", "is-online", "is-offline");
    badge.classList.add(connected ? "is-online" : "is-offline");
    $("stationStateText").textContent = connected ? t("online") : t("offline");
  }

  function renderCurrent(data) {
    if (!data) return;
    const currentTemp = finiteNumber(data.temperature);
    let dayMin = finiteNumber(data.dayMin);
    let dayMax = finiteNumber(data.dayMax);
    if (currentTemp !== null && currentTemp > 10 && (dayMin === 0 || dayMax === 0)) {
      dayMin = null; dayMax = null;
    }

    setStationState(data.stationConnected === true);
    $("stationName").textContent = settings.language === "en" ? "Abyar Al-Mashi · Madinah" : (data.stationName || "أبيار الماشي · المدينة");
    $("temperature").textContent = valueWithUnit(currentTemp, "temp");
    $("conditionIcon").textContent = data.condition?.icon || "☀️";
    $("conditionLabel").textContent = conditionText(data.condition?.label);
    $("dayMax").textContent = valueWithUnit(dayMax, "temp");
    $("dayMin").textContent = valueWithUnit(dayMin, "temp");
    $("feelsLike").textContent = valueWithUnit(data.feelsLike, "temp");
    $("humidity").textContent = valueWithUnit(data.humidity, "humidity", 0);
    $("windSpeed").textContent = valueWithUnit(data.windSpeed, "wind");
    $("windGust").textContent = valueWithUnit(data.windGust, "wind");
    $("windDirection").textContent = windDirection(data.windDirection);
    $("pressure").textContent = valueWithUnit(data.pressure, "pressure", settings.units === "imperial" ? 2 : 1);
    $("rain").textContent = valueWithUnit(data.rain, "rain", settings.units === "imperial" ? 2 : 1);
    $("dewPoint").textContent = valueWithUnit(data.dewPoint, "temp");
    $("solarRadiation").textContent = valueWithUnit(data.solarRadiation, "solar");
    $("uv").textContent = valueWithUnit(data.uv, "", 0);
    $("observedAt").textContent = `${t("lastReading")}: ${timeInRiyadh(data.observedAt)}`;
  }

  async function loadCurrent(force = false) {
    if (loaded.current && !force) { renderCurrent(cache.current); return; }
    if (STATIC_PREVIEW) {
      setStationState(false);
      $("observedAt").textContent = `${t("lastReading")}: —`;
      return;
    }
    try {
      const data = await getJson("/api/weather");
      let min = finiteNumber(data.dayMin), max = finiteNumber(data.dayMax);
      const cur = finiteNumber(data.temperature);
      const needFallback = min === null || max === null || (cur !== null && cur > 10 && (min === 0 || max === 0));
      if (needFallback) {
        try {
          const historyData = cache.history || await getJson("/api/history/today");
          cache.history = historyData;
          const temps = (historyData.points || []).map(p => finiteNumber(p.temperature)).filter(v => v !== null);
          if (temps.length) {
            if (min === null || (cur !== null && cur > 10 && min === 0)) data.dayMin = Math.min(...temps);
            if (max === null || (cur !== null && cur > 10 && max === 0)) data.dayMax = Math.max(...temps);
          }
        } catch {}
      }
      cache.current = data;
      loaded.current = true;
      renderCurrent(data);
    } catch (error) {
      console.error("Current weather error", error);
      setStationState(false);
      $("observedAt").textContent = `${t("lastReading")}: —`;
    }
  }

  function renderForecast(data) {
    const box = $("forecastList");
    if (!data?.enabled || !Array.isArray(data.days) || !data.days.length) {
      box.innerHTML = `<div class="loading-box">${data?.message || t("forecastUnavailable")}</div>`;
      return;
    }
    box.innerHTML = data.days.slice(0, 5).map((item, index) => {
      const dayName = index === 0 ? t("today") : index === 1 ? t("tomorrow") : (item.day || `${t("today")} ${index + 1}`);
      const precip = finiteNumber(item.precipChance);
      const rain = precip !== null ? `${t("rainChance")} ${number(precip, 0)}%` : "";
      const rainClass = precip !== null && precip > 10 ? " is-notable" : "";
      return `
        <div class="forecast-day">
          <div class="forecast-name">${dayName}</div>
          <div class="forecast-icon">${forecastIcon(item.phrase)}</div>
          <div class="forecast-text">
            <div class="forecast-phrase">${item.phrase || "—"}</div>
            <div class="forecast-rain${rainClass}">${rain}</div>
          </div>
          <div class="forecast-temps"><span>${valueWithUnit(item.max, "temp")}</span><span class="low">${valueWithUnit(item.min, "temp")}</span></div>
        </div>`;
    }).join("");
  }

  async function loadForecast(force = false) {
    if (loaded.forecast && !force) { renderForecast(cache.forecast); return; }
    const box = $("forecastList");
    if (STATIC_PREVIEW) { box.innerHTML = `<div class="loading-box">${t("dataConnected")}</div>`; return; }
    box.innerHTML = `<div class="loading-box">${t("loadingForecast")}</div>`;
    try {
      const lang = settings.language === "en" ? "en-US" : "ar-SA";
      const data = await getJson(`/api/forecast?lang=${encodeURIComponent(lang)}`);
      cache.forecast = data; loaded.forecast = true; renderForecast(data);
    } catch (error) {
      console.error("Forecast error", error);
      box.innerHTML = `<div class="loading-box">${t("forecastUnavailable")}</div>`;
    }
  }

  function minuteOfDay(value) {
    const match = String(value || "").match(/T(\d{2}):(\d{2})/);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
    const h = Number(parts.find(p => p.type === "hour")?.value);
    const m = Number(parts.find(p => p.type === "minute")?.value);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  }

  function nowMinutesRiyadh() {
    const text = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const m = text.match(/(\d{2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 1439;
  }

  function clockFromMinutes(minutes) {
    const safe = Math.max(0, Math.min(1439, Math.round(minutes)));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function chartModel(points, series, unitText, options = {}, minSeriesPoints = 2) {
    const timeline = points
      .filter(point => point && point.observedAt)
      .map(point => ({ point, minute: minuteOfDay(point.observedAt) }))
      .filter(entry => entry.minute !== null)
      .sort((a, b) => a.minute - b.minute);

    const plotted = series.map(item => ({
      ...item,
      values: timeline
        .map(entry => ({ minute: entry.minute, value: finiteNumber(entry.point[item.key]) }))
        .filter(entry => entry.value !== null)
    }));
    const drawable = plotted.filter(item => item.values.length >= minSeriesPoints);
    if (!timeline.length || !drawable.length) return null;

    const width = 360, height = 126;
    const pad = { top: 7, right: 8, bottom: 20, left: 42 };
    const allValues = drawable.flatMap(item => item.values.map(entry => entry.value));
    let min = Math.min(...allValues), max = Math.max(...allValues);
    if (options.floorZero) {
      // قيم مثل المطر لا يمكن أن تكون سالبة: الصفر هو خط الأساس دائمًا.
      min = 0;
      max = Math.max(0, max);
    }
    if (min === max) {
      if (options.floorZero) {
        max = Number.isFinite(options.zeroCeiling) ? options.zeroCeiling : 0.5;
      } else {
        const bump = Math.max(Math.abs(min) * 0.01, 1);
        min -= bump;
        max += bump;
      }
    } else {
      const spread = max - min;
      if (!options.floorZero) min -= spread * 0.05;
      max += spread * 0.05;
    }

    const lastMinute = Math.max(...timeline.map(x => x.minute));
    const domainEnd = Math.max(1, lastMinute, nowMinutesRiyadh());
    const x = minute => pad.left + (minute / domainEnd) * (width - pad.left - pad.right);
    const y = value => pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
    const axisDigits = Number.isInteger(options.axisDigits) ? options.axisDigits : 1;
    const levels = [max, (max + min) / 2, min];

    const grid = levels.map(value => {
      const yy = y(value).toFixed(1);
      return `<line class="chart-grid" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />
              <text class="chart-axis-text" x="${pad.left - 6}" y="${Number(yy) + 3}" text-anchor="end">${number(value, axisDigits)}${unitText}</text>`;
    }).join("");

    const labels = [0, domainEnd / 2, domainEnd].map((minute, i) =>
      `<text class="chart-axis-text" x="${x(minute).toFixed(1)}" y="${height - 4}" text-anchor="${i === 0 ? "start" : i === 2 ? "end" : "middle"}">${clockFromMinutes(minute)}</text>`
    ).join("");

    return { timeline, drawable, width, height, pad, x, y, grid, labels, min, max, domainEnd };
  }

  function svgLineChart(points, series, unitText, options = {}) {
    const model = chartModel(points, series, unitText, options, 2);
    if (!model) return `<div class="loading-box">${t("noData")}</div>`;
    const paths = model.drawable.map(item => {
      const d = item.values.map((entry, i) => `${i ? "L" : "M"}${model.x(entry.minute).toFixed(1)} ${model.y(entry.value).toFixed(1)}`).join(" ");
      return `<path class="chart-line ${item.className || ""}" d="${d}" />`;
    }).join("");
    return `<svg viewBox="0 0 ${model.width} ${model.height}" role="img" aria-hidden="true">${model.grid}${paths}${model.labels}</svg>`;
  }

  function svgScatterChart(points, series, unitText, options = {}) {
    const model = chartModel(points, series, unitText, options, 1);
    if (!model) return `<div class="loading-box">${t("noData")}</div>`;
    const dots = model.drawable.map(item => item.values.map(entry =>
      `<circle class="chart-dot ${item.className || ""}" cx="${model.x(entry.minute).toFixed(1)}" cy="${model.y(entry.value).toFixed(1)}" r="2.15" />`
    ).join("")).join("");
    return `<svg viewBox="0 0 ${model.width} ${model.height}" role="img" aria-hidden="true">${model.grid}${dots}${model.labels}</svg>`;
  }

  function svgRainBars(points, unitText, options = {}) {
    const ordered = points
      .filter(point => point && point.observedAt)
      .map(point => ({ point, minute: minuteOfDay(point.observedAt), total: finiteNumber(point.rain) }))
      .filter(entry => entry.minute !== null && entry.total !== null)
      .sort((a, b) => a.minute - b.minute);
    if (!ordered.length) return `<div class="loading-box">${t("noData")}</div>`;

    let previous = 0;
    const bars = ordered.map((entry, index) => {
      const increment = index === 0 ? Math.max(0, entry.total) : Math.max(0, entry.total - previous);
      previous = entry.total;
      return { observedAt: entry.point.observedAt, rainIncrement: increment };
    });
    const model = chartModel(
      bars,
      [{ key: "rainIncrement", className: "rain-bar" }],
      unitText,
      { ...options, floorZero: true, zeroCeiling: Number.isFinite(options.zeroCeiling) ? options.zeroCeiling : 0.5 },
      1
    );
    if (!model) return `<div class="loading-box">${t("noData")}</div>`;

    const values = model.drawable[0].values;
    const plotWidth = model.width - model.pad.left - model.pad.right;
    const barWidth = Math.max(2.5, Math.min(9, plotWidth / Math.max(values.length * 2.2, 1)));
    const zeroY = model.y(0);
    const rects = values.map(entry => {
      const yy = model.y(entry.value);
      if (entry.value <= 0) return "";
      const h = Math.max(0.8, zeroY - yy);
      return `<rect class="chart-bar rain-bar" x="${(model.x(entry.minute) - barWidth / 2).toFixed(1)}" y="${(zeroY - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="1" />`;
    }).join("");
    return `<svg viewBox="0 0 ${model.width} ${model.height}" role="img" aria-hidden="true">${model.grid}${rects}${model.labels}</svg>`;
  }

  function categoryChartModel(points, series, unitText, options = {}, minSeriesPoints = 2) {
    if (!Array.isArray(points) || !points.length) return null;
    const plotted = series.map(item => ({
      ...item,
      values: points.map((point, index) => ({ index, value: finiteNumber(point[item.key]) })).filter(entry => entry.value !== null)
    }));
    const drawable = plotted.filter(item => item.values.length >= minSeriesPoints);
    if (!drawable.length) return null;

    const width = 360, height = 126;
    const pad = { top: 7, right: 8, bottom: 20, left: 42 };
    const allValues = drawable.flatMap(item => item.values.map(entry => entry.value));
    let min = Math.min(...allValues), max = Math.max(...allValues);
    if (options.floorZero) { min = 0; max = Math.max(0, max); }
    if (min === max) {
      if (options.floorZero) max = Number.isFinite(options.zeroCeiling) ? options.zeroCeiling : 0.5;
      else { const bump = Math.max(Math.abs(min) * 0.01, 1); min -= bump; max += bump; }
    } else {
      const spread = max - min;
      if (!options.floorZero) min -= spread * 0.05;
      max += spread * 0.05;
    }

    const count = Math.max(points.length, 1);
    const x = index => pad.left + (count === 1 ? 0.5 : index / (count - 1)) * (width - pad.left - pad.right);
    const y = value => pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
    const axisDigits = Number.isInteger(options.axisDigits) ? options.axisDigits : 1;
    const levels = [max, (max + min) / 2, min];
    const grid = levels.map(value => {
      const yy = y(value).toFixed(1);
      return `<line class="chart-grid" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />
              <text class="chart-axis-text" x="${pad.left - 6}" y="${Number(yy) + 3}" text-anchor="end">${number(value, axisDigits)}${unitText}</text>`;
    }).join("");

    const wanted = count <= 6 ? [...Array(count).keys()] : [0, Math.round((count - 1) / 3), Math.round((count - 1) * 2 / 3), count - 1];
    const ticks = [...new Set(wanted)].filter(i => i >= 0 && i < count);
    const labels = ticks.map((index, i) => {
      const label = points[index]?.label ?? String(index + 1);
      return `<text class="chart-axis-text" x="${x(index).toFixed(1)}" y="${height - 4}" text-anchor="${i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}">${label}</text>`;
    }).join("");
    return { drawable, width, height, pad, x, y, grid, labels, min, max };
  }

  function svgCategoryLineChart(points, series, unitText, options = {}) {
    const model = categoryChartModel(points, series, unitText, options, 2);
    if (!model) return `<div class="loading-box">${t("periodNoData")}</div>`;
    const paths = model.drawable.map(item => {
      const d = item.values.map((entry, i) => `${i ? "L" : "M"}${model.x(entry.index).toFixed(1)} ${model.y(entry.value).toFixed(1)}`).join(" ");
      return `<path class="chart-line ${item.className || ""}" d="${d}" />`;
    }).join("");
    return `<svg viewBox="0 0 ${model.width} ${model.height}" role="img" aria-hidden="true">${model.grid}${paths}${model.labels}</svg>`;
  }

  function svgCategoryBars(points, key, unitText, options = {}) {
    const model = categoryChartModel(points, [{ key, className: "rain-bar" }], unitText, { ...options, floorZero: true }, 1);
    if (!model) return `<div class="loading-box">${t("periodNoData")}</div>`;
    const values = model.drawable[0].values;
    const plotWidth = model.width - model.pad.left - model.pad.right;
    const barWidth = Math.max(3, Math.min(12, plotWidth / Math.max(points.length * 1.7, 1)));
    const zeroY = model.y(0);
    const rects = values.map(entry => {
      if (entry.value <= 0) return "";
      const yy = model.y(entry.value);
      const h = Math.max(0.8, zeroY - yy);
      return `<rect class="chart-bar rain-bar" x="${(model.x(entry.index) - barWidth / 2).toFixed(1)}" y="${(zeroY - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="1" />`;
    }).join("");
    return `<svg viewBox="0 0 ${model.width} ${model.height}" role="img" aria-hidden="true">${model.grid}${rects}${model.labels}</svg>`;
  }

  function svgYearGroupedBars(points) {
    if (!Array.isArray(points) || !points.length) return `<div class="loading-box">${t("periodNoData")}</div>`;
    const rows = points.map((point, index) => ({
      index,
      label: point.label ?? String(index + 1),
      high: finiteNumber(point.tempHigh),
      low: finiteNumber(point.tempLow),
      rain: Math.max(0, finiteNumber(point.rain) || 0)
    })).filter(row => row.high !== null || row.low !== null || row.rain > 0);
    if (!rows.length) return `<div class="loading-box">${t("periodNoData")}</div>`;

    const width = 360, height = 150;
    const pad = { top: 13, right: 34, bottom: 24, left: 34 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const baseY = pad.top + plotH;
    const tempValues = rows.flatMap(row => [row.high, row.low]).filter(v => v !== null);
    const tempRawMax = Math.max(1, ...tempValues);
    const tempMax = Math.ceil(tempRawMax / 5) * 5;
    const rainRawMax = Math.max(0, ...rows.map(row => row.rain));
    const rainFallback = settings.units === "imperial" ? 0.1 : 2;
    const rainMax = rainRawMax > 0 ? rainRawMax * 1.12 : rainFallback;
    const tempY = value => baseY - (Math.max(0, value) / tempMax) * plotH;
    const rainY = value => baseY - (Math.max(0, value) / rainMax) * plotH;
    const groupW = plotW / Math.max(rows.length, 1);
    const barW = Math.max(3.2, Math.min(7, groupW * 0.19));
    const gap = Math.max(1.4, Math.min(3, groupW * 0.07));

    const grid = [0, .5, 1].map(ratio => {
      const yy = (baseY - ratio * plotH).toFixed(1);
      return `<line class="chart-grid" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />`;
    }).join("");

    const bars = rows.map((row, i) => {
      const center = pad.left + groupW * (i + .5);
      const parts = [];
      if (row.rain > 0) {
        const y = rainY(row.rain), h = Math.max(.8, baseY - y);
        parts.push(`<rect class="year-rain-bar" x="${(center - barW * 1.5 - gap).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1"><title>${t("rainChart")}: ${number(row.rain, settings.units === "imperial" ? 2 : 1)}${unit("rain")}</title></rect>`);
      }
      if (row.high !== null) {
        const y = tempY(row.high), h = Math.max(.8, baseY - y);
        parts.push(`<rect class="year-high-bar" x="${(center - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1"><title>${t("max")}: ${number(row.high)}${unit("temp")}</title></rect>`);
      }
      if (row.low !== null) {
        const y = tempY(row.low), h = Math.max(.8, baseY - y);
        parts.push(`<rect class="year-low-bar" x="${(center + barW / 2 + gap).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1"><title>${t("min")}: ${number(row.low)}${unit("temp")}</title></rect>`);
      }
      parts.push(`<text class="chart-axis-text" x="${center.toFixed(1)}" y="${height - 5}" text-anchor="middle">${row.label}</text>`);
      return parts.join("");
    }).join("");

    const rainDigits = settings.units === "imperial" ? 2 : 1;
    const axes = `
      <text class="chart-axis-text" x="${pad.left - 5}" y="${pad.top + 3}" text-anchor="end">${number(tempMax, 0)}${unit("temp")}</text>
      <text class="chart-axis-text" x="${pad.left - 5}" y="${baseY + 3}" text-anchor="end">0</text>
      <text class="chart-axis-text" x="${width - pad.right + 5}" y="${pad.top + 3}" text-anchor="start">${rainRawMax > 0 ? number(rainMax, rainDigits) : 0}${unit("rain")}</text>
      <text class="chart-axis-text" x="${width - pad.right + 5}" y="${baseY + 3}" text-anchor="start">0</text>`;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">${grid}${bars}${axes}</svg>`;
  }

  function rangeText(points, key, unitText) {
    const values = points.map(p => finiteNumber(p[key])).filter(v => v !== null);
    if (!values.length) return "—";
    return `${number(Math.min(...values))}${unitText} — ${number(Math.max(...values))}${unitText}`;
  }

  function combinedRangeText(points, keys, unitText) {
    const values = keys.flatMap(key => points.map(p => finiteNumber(p[key])).filter(v => v !== null));
    if (!values.length) return "—";
    return `${number(Math.min(...values))}${unitText} — ${number(Math.max(...values))}${unitText}`;
  }

  function displayHistoryPoints(points) {
    return points.map(p => ({
      ...p,
      temperature: convert("temp", p.temperature),
      windSpeed: convert("wind", p.windSpeed),
      windGust: convert("wind", p.windGust),
      pressure: convert("pressure", p.pressure),
      rain: convert("rain", p.rain),
      humidity: finiteNumber(p.humidity)
    }));
  }

  function applyExtraCharts() {
    $("rainChartCard").hidden = !settings.showRainChart;
    $("pressureChartCard").hidden = !settings.showPressureChart;
    $("showRainChart").checked = !!settings.showRainChart;
    $("showPressureChart").checked = !!settings.showPressureChart;
  }

  function setHistoryPeriodUI() {
    document.querySelectorAll(".history-period-button").forEach(button => {
      button.classList.toggle("active", button.dataset.historyPeriod === historyPeriod);
    });
  }

  function renderHistory(data) {
    const message = $("historyMessage"), charts = $("historyCharts");
    const monthCharts = $("historyMonthCharts"), yearCharts = $("historyYearCharts");
    monthCharts.hidden = true;
    yearCharts.hidden = true;
    $("historyScopeLabel").textContent = t("todayMovement");
    if (!data?.enabled || !Array.isArray(data.points) || data.points.length < 2) {
      message.hidden = false; charts.hidden = true; message.textContent = data?.message || t("noData"); return;
    }
    const points = displayHistoryPoints(data.points);
    $("historyDate").textContent = dateArabic(data.date);
    $("tempRange").textContent = rangeText(points, "temperature", unit("temp"));
    $("windRange").textContent = combinedRangeText(points, ["windSpeed", "windGust"], unit("wind"));
    $("humidityRange").textContent = rangeText(points, "humidity", "%");
    $("rainRange").textContent = rangeText(points, "rain", unit("rain"));
    $("pressureRange").textContent = rangeText(points, "pressure", unit("pressure"));

    $("tempChart").innerHTML = svgLineChart(points, [{ key: "temperature", className: "temp-line" }], unit("temp"));
    $("windChart").innerHTML = svgScatterChart(points, [{ key: "windSpeed", className: "wind-dot" }, { key: "windGust", className: "gust-dot" }], "", { floorZero: true });
    $("humidityChart").innerHTML = svgLineChart(points, [{ key: "humidity", className: "humidity-line" }], "%", { axisDigits: 0 });
    $("rainChart").innerHTML = svgRainBars(points, unit("rain"), {
      axisDigits: settings.units === "imperial" ? 2 : 1,
      zeroCeiling: settings.units === "imperial" ? 0.02 : 0.5
    });
    $("pressureChart").innerHTML = svgLineChart(points, [{ key: "pressure", className: "pressure-line" }], "", { axisDigits: settings.units === "imperial" ? 2 : 0 });
    applyExtraCharts();
    message.hidden = true; charts.hidden = false;
  }

  function riyadhCalendarParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const read = type => Number(parts.find(part => part.type === type)?.value);
    return { year: read("year"), month: read("month"), day: read("day") };
  }

  function reconcileCurrentMonthDay(points, data, period) {
    if (period !== "month" || !Array.isArray(points) || !cache.current) return points;
    const today = riyadhCalendarParts();
    if (Number(data?.year) !== today.year || Number(data?.month) !== today.month) return points;

    const row = points.find(point => Number(point?.day) === today.day);
    if (!row) return points;

    const currentLow = finiteNumber(cache.current.dayMin);
    const currentHigh = finiteNumber(cache.current.dayMax);
    if (currentLow !== null) row.tempLow = convert("temp", currentLow);
    if (currentHigh !== null) row.tempHigh = convert("temp", currentHigh);
    return points;
  }

  function displayLongHistoryPoints(data, period) {
    const rainAllowed = point => {
      const year = Number(data?.year);
      const month = period === "year" ? Number(point?.month) : Number(data?.month);
      return year > 2026 || (year === 2026 && month >= 7);
    };
    const points = (data.points || []).map(point => ({
      ...point,
      label: period === "year" ? monthShort(point.month) : String(point.day ?? ""),
      tempHigh: convert("temp", point.tempHigh),
      tempLow: convert("temp", point.tempLow),
      rain: rainAllowed(point) ? Math.max(0, convert("rain", point.rain) ?? 0) : 0
    }));
    return reconcileCurrentMonthDay(points, data, period);
  }

  function renderLongHistory(data, period) {
    const message = $("historyMessage"), dayCharts = $("historyCharts");
    const monthCharts = $("historyMonthCharts"), yearCharts = $("historyYearCharts");
    dayCharts.hidden = true;
    monthCharts.hidden = true;
    yearCharts.hidden = true;
    $("historyScopeLabel").textContent = t(period === "month" ? "monthMovement" : "yearMovement");
    if (!data?.enabled || !Array.isArray(data.points) || !data.points.length) {
      message.hidden = false;
      message.textContent = data?.message || t("periodNoData");
      return;
    }

    const points = displayLongHistoryPoints(data, period);
    $("historyDate").textContent = period === "month" ? monthTitle(data.year, data.month) : String(data.year || "");
    const totalRain = points.reduce((sum, point) => sum + (finiteNumber(point.rain) || 0), 0);
    const tempRange = combinedRangeText(points, ["tempLow", "tempHigh"], unit("temp"));

    if (period === "month") {
      $("monthRainRange").textContent = `${number(totalRain, settings.units === "imperial" ? 2 : 1)}${unit("rain")}`;
      $("monthTempRange").textContent = tempRange;
      $("monthRainChart").innerHTML = svgCategoryBars(points, "rain", unit("rain"), {
        axisDigits: settings.units === "imperial" ? 2 : 1,
        zeroCeiling: settings.units === "imperial" ? 0.02 : 0.5
      });
      $("monthTempChart").innerHTML = svgCategoryLineChart(points, [
        { key: "tempHigh", className: "temp-high-line" },
        { key: "tempLow", className: "temp-low-line" }
      ], unit("temp"));
      monthCharts.hidden = false;
    } else {
      $("yearSummaryRange").textContent = `${number(totalRain, settings.units === "imperial" ? 2 : 1)}${unit("rain")} · ${tempRange}`;
      $("yearSummaryChart").innerHTML = svgYearGroupedBars(points);
      yearCharts.hidden = false;
    }
    message.hidden = true;
  }

  async function loadHistory(force = false) {
    setHistoryPeriodUI();
    if (historyPeriod === "day") {
      if (loaded.history && !force && cache.history) { renderHistory(cache.history); return; }
      const message = $("historyMessage"), charts = $("historyCharts");
      message.hidden = false; charts.hidden = true; $("historyMonthCharts").hidden = true; $("historyYearCharts").hidden = true;
      if (STATIC_PREVIEW) { message.textContent = t("dataConnected"); return; }
      message.textContent = t("loadingHistory");
      try {
        const data = await getJson("/api/history/today");
        cache.history = data; loaded.history = true; renderHistory(data);
      } catch (error) {
        console.error("History error", error);
        message.textContent = t("historyUnavailable");
      }
      return;
    }

    if (longHistoryLoaded[historyPeriod] && !force && longHistoryCache[historyPeriod]) {
      renderLongHistory(longHistoryCache[historyPeriod], historyPeriod); return;
    }
    const message = $("historyMessage"), charts = $("historyCharts");
    message.hidden = false; charts.hidden = true; $("historyMonthCharts").hidden = true; $("historyYearCharts").hidden = true;
    if (STATIC_PREVIEW) { message.textContent = t("dataConnected"); return; }
    message.textContent = t(historyPeriod === "month" ? "loadingMonthHistory" : "loadingYearHistory");
    try {
      const data = await getJson(`/api/history/${historyPeriod}`);
      longHistoryCache[historyPeriod] = data; longHistoryLoaded[historyPeriod] = true;
      renderLongHistory(data, historyPeriod);
    } catch (error) {
      console.error("Long history error", error);
      message.textContent = t("longHistoryUnavailable");
    }
  }

  function renderPrayer(data) {
    const list = $("prayerList");
    if (!data?.enabled || !data.times) {
      list.innerHTML = `<div class="loading-box">${data?.message || t("prayerUnavailable")}</div>`; return;
    }
    const names = prayerNames[settings.language];
    const order = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
    list.innerHTML = order.map(key => `
      <div class="prayer-row ${data.next === key ? "is-next" : ""}">
        <span class="prayer-name">${names[key]}</span><strong class="prayer-time">${data.times[key] || "—"}</strong>
      </div>`).join("");
    $("prayerDate").textContent = settings.language === "en" ? "Abyar Al-Mashi" : (data.date || "أبيار الماشي");
    $("hijriDate").textContent = data.hijriDate ? `${t("hijri")}: ${data.hijriDate}` : "";
    $("nextPrayerName").textContent = names[data.next] || "—";
    $("nextPrayerTime").textContent = data.next ? (data.times[data.next] || "—") : "—";
  }

  async function loadPrayer(force = false) {
    if (loaded.prayer && !force && cache.prayer) { renderPrayer(cache.prayer); return; }
    const list = $("prayerList");
    if (STATIC_PREVIEW) { list.innerHTML = `<div class="loading-box">${t("dataConnected")}</div>`; return; }
    list.innerHTML = `<div class="loading-box">${t("loadingPrayer")}</div>`;
    try {
      const data = await getJson("/api/prayer");
      cache.prayer = data; loaded.prayer = true; renderPrayer(data);
    } catch (error) {
      console.error("Prayer error", error);
      list.innerHTML = `<div class="loading-box">${t("prayerUnavailable")}</div>`;
    }
  }

  const loaders = { current: loadCurrent, forecast: loadForecast, history: loadHistory, prayer: loadPrayer, radar: async () => { document.dispatchEvent(new CustomEvent("mahatta:radar-open")); }};

  function activateTab(name) {
    const target = loaders[name] ? name : "current";
    tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tab === target));
    panels.forEach(panel => {
      const active = panel.dataset.panel === target;
      panel.classList.toggle("active", active); panel.hidden = !active;
    });
    history.replaceState(null, "", `#${target}`);
    loaders[target]();
  }

  function applyTranslations() {
    document.documentElement.lang = settings.language;
    document.documentElement.dir = settings.language === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    $("menuButton").setAttribute("aria-label", settings.language === "ar" ? "القائمة" : "Menu");
    document.title = settings.language === "ar" ? "المحطة · أبيار الماشي" : "Station · Abyar Al-Mashi";
  }

  function renderSettingButtons() {
    document.querySelectorAll(".setting-option[data-setting]").forEach(button => {
      button.classList.toggle("active", String(settings[button.dataset.setting]) === button.dataset.value);
    });
    applyExtraCharts();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = settings.theme === "dark" ? "#1d2421" : "#f4f6f2";
  }

  function rerenderCached() {
    if (cache.current) renderCurrent(cache.current);
    if (cache.forecast) renderForecast(cache.forecast);
    if (historyPeriod === "day" && cache.history) renderHistory(cache.history);
    if (historyPeriod !== "day" && longHistoryCache[historyPeriod]) renderLongHistory(longHistoryCache[historyPeriod], historyPeriod);
    if (cache.prayer) renderPrayer(cache.prayer);
  }

  function applyAllSettings() {
    applyTheme(); applyTranslations(); renderSettingButtons(); rerenderCached();
  }

  document.querySelectorAll(".history-period-button").forEach(button => {
    button.addEventListener("click", () => {
      const next = button.dataset.historyPeriod;
      if (!next || next === historyPeriod) return;
      historyPeriod = next;
      loadHistory(false);
    });
  });

  tabs.forEach(tab => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));

  // سحب أفقي متعمد بين التبويبات. داخل الشارت يحتاج حركة واضحة، لكنه لا يُعطل بالكامل.
  const tabOrder = ["current", "forecast", "history", "radar", "prayer"];
  let touchStartX = 0, touchStartY = 0, touchStarted = false, touchStartedInChart = false;
  document.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) return;
    if (event.target.closest("button, a, input, textarea, select, .menu-panel, .weather-map, .map-shell")) {
      touchStarted = false;
      touchStartedInChart = false;
      return;
    }
    touchStartedInChart = !!event.target.closest(".chart-wrap");
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
    touchStarted = true;
  }, { passive: true });
  document.addEventListener("touchend", event => {
    if (!touchStarted || event.changedTouches.length !== 1) return;
    touchStarted = false;
    const wasChart = touchStartedInChart;
    touchStartedInChart = false;
    const dx = event.changedTouches[0].clientX - touchStartX;
    const dy = event.changedTouches[0].clientY - touchStartY;
    const minDistance = wasChart ? 85 : 75;
    const horizontalRatio = wasChart ? 1.35 : 1.4;
    if (Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * horizontalRatio) return;
    const active = document.querySelector(".tab.active")?.dataset.tab || "current";
    const index = tabOrder.indexOf(active);
    const nextIndex = dx < 0 ? index + 1 : index - 1;
    if (nextIndex >= 0 && nextIndex < tabOrder.length) activateTab(tabOrder[nextIndex]);
  }, { passive: true });

  $("menuButton").addEventListener("click", () => {
    const panel = $("menuPanel"), willOpen = panel.hidden;
    panel.hidden = !willOpen; $("menuButton").setAttribute("aria-expanded", String(willOpen));
  });

  $("refreshButton").addEventListener("click", async () => {
    $("menuPanel").hidden = true; $("menuButton").setAttribute("aria-expanded", "false");
    const active = document.querySelector(".tab.active")?.dataset.tab || "current";
    await loadCurrent(true); if (active !== "current") await loaders[active](true);
  });

  document.querySelectorAll(".setting-option[data-setting]").forEach(button => {
    button.addEventListener("click", async () => {
      const key = button.dataset.setting, value = button.dataset.value;
      if (!key || settings[key] === value) return;
      settings[key] = value; saveSettings(); applyAllSettings();
      if (key === "language") {
        loaded.forecast = false; cache.forecast = null;
        if (document.querySelector('.tab.active')?.dataset.tab === "forecast") await loadForecast(true);
      }
    });
  });

  $("showRainChart").addEventListener("change", event => {
    settings.showRainChart = event.target.checked; saveSettings(); applyExtraCharts();
  });
  $("showPressureChart").addEventListener("change", event => {
    settings.showPressureChart = event.target.checked; saveSettings(); applyExtraCharts();
  });

  document.addEventListener("click", event => {
    if (!$("menuPanel").hidden && !$("menuPanel").contains(event.target) && !$("menuButton").contains(event.target)) {
      $("menuPanel").hidden = true; $("menuButton").setAttribute("aria-expanded", "false");
    }
  });

  applyAllSettings();
  const initialTab = location.hash.replace("#", "");
  activateTab(loaders[initialTab] ? initialTab : "current");
  loadCurrent();

  setInterval(() => loadCurrent(true), 60_000);
  setInterval(() => {
    if (document.querySelector('.tab.active')?.dataset.tab === "history" && historyPeriod === "day") loadHistory(true);
  }, 5 * 60_000);
})();
