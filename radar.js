(() => {
  "use strict";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const LAT = 24.234096;
  const LON = 39.551125;

  let map = null;
  let streetLayer = null;
  let radarLayer = null;
  let activeLayer = "radar";
  let radarFrame = null;
  let radarFrameKey = "";
  let radarLoadedAt = 0;
  let radarLoadPromise = null;
  const RADAR_REFRESH_MS = 10 * 60 * 1000;

  const isAr = () => document.documentElement.lang !== "en";

  const copy = {
    ar: {
      radar: "الرادار",
      clouds: "السحب",
      wind: "الرياح",
      sourceRadar: "رادار المطر: RainViewer · الخريطة: OpenStreetMap",
      sourceClouds: "السحب: Windy",
      sourceWind: "الرياح: Windy",
      captionRadar: "الخريطة مركزة على موقع المحطة.",
      captionClouds: "الخريطة مركزة على موقع المحطة.",
      captionWind: "الخريطة مركزة على موقع المحطة.",
      loadingRadar: "جارٍ تحميل الرادار…",
      loadingClouds: "جارٍ تحميل السحب…",
      loadingWind: "جارٍ تحميل الرياح…",
      radarError: "تعذر تحميل طبقة الرادار حاليًا.",
      radarLimited: "رادار المطر متوقف مؤقتًا من المصدر؛ أعد المحاولة بعد قليل.",
      windyError: "تعذر تحميل خريطة Windy حاليًا.",
      mapError: "تعذر تحميل مكتبة الخريطة.",
      latestRadar: "آخر صورة رادار",
      fullscreen: "ملء الشاشة",
      exitFullscreen: "الخروج من ملء الشاشة",
      windyCloudTitle: "السحب حول محطة أبيار الماشي",
      windyWindTitle: "الرياح حول محطة أبيار الماشي"
    },
    en: {
      radar: "Radar",
      clouds: "Clouds",
      wind: "Wind",
      sourceRadar: "Rain radar: RainViewer · map: OpenStreetMap",
      sourceClouds: "Clouds: Windy",
      sourceWind: "Wind: Windy",
      captionRadar: "The map is centered on the station location.",
      captionClouds: "The map is centered on the station location.",
      captionWind: "The map is centered on the station location.",
      loadingRadar: "Loading radar…",
      loadingClouds: "Loading clouds…",
      loadingWind: "Loading wind…",
      radarError: "Radar layer is currently unavailable.",
      radarLimited: "Rain radar is temporarily throttled by the source; try again shortly.",
      windyError: "Windy map is currently unavailable.",
      mapError: "Map library could not be loaded.",
      latestRadar: "Latest radar frame",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit fullscreen",
      windyCloudTitle: "Clouds around the Abyar Al-Mashi station",
      windyWindTitle: "Wind around the Abyar Al-Mashi station"
    }
  };

  const t = key => copy[isAr() ? "ar" : "en"][key] || key;

  function message(text, isError = false) {
    const el = $("#radarMapMessage");
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle("is-error", isError);
  }

  function formatTime(unix, labelKey) {
    if (!Number.isFinite(Number(unix))) return "";
    try {
      const d = new Date(Number(unix) * 1000);
      const value = new Intl.DateTimeFormat(isAr() ? "ar-SA" : "en-GB", {
        timeZone: "Asia/Riyadh",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      }).format(d);
      return `${t(labelKey)}: ${value}`;
    } catch {
      return "";
    }
  }

  function ensureMap() {
    const root = $("#weatherLeafletMap");
    if (!root || map) return Boolean(map);
    if (!window.L) {
      message(t("mapError"), true);
      return false;
    }

    map = L.map(root, {
      center: [LAT, LON],
      zoom: 7,
      minZoom: 3,
      maxZoom: 18,
      zoomControl: true,
      attributionControl: true,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false
    });

    streetLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "© OpenStreetMap"
    }).addTo(map);

    L.marker([LAT, LON], {
      icon: L.divIcon({
        className: "",
        html: '<span class="station-map-marker" aria-hidden="true"></span>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      }),
      keyboard: false,
      title: isAr() ? "موقع المحطة" : "Station location",
      zIndexOffset: 1000
    }).addTo(map);

    return true;
  }

  function removeRadarOverlay() {
    if (map && radarLayer && map.hasLayer(radarLayer)) map.removeLayer(radarLayer);
    radarLayer = null;
  }

  function windyFrame() {
    return $("#radarWindyFrame");
  }

  function unloadWindy() {
    const frame = windyFrame();
    if (!frame) return;
    frame.onload = null;
    frame.onerror = null;
    frame.hidden = true;
    frame.removeAttribute("data-radar-layer");
    if (frame.getAttribute("src")) frame.setAttribute("src", "about:blank");
  }

  function showNativeMap() {
    const root = $("#weatherLeafletMap");
    if (root) root.hidden = false;
    unloadWindy();
  }

  function windyUrl(layer) {
    const clouds = layer === "clouds";
    const overlay = clouds ? "clouds" : "wind";
    const product = clouds ? "satellite" : "ecmwf";
    return `https://embed.windy.com/embed2.html?lat=${LAT}&lon=${LON}&detailLat=${LAT}&detailLon=${LON}&zoom=7&level=surface&overlay=${overlay}&product=${product}&menu=&message=false&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&metricRain=mm&radarRange=-1`;
  }

  async function loadRainViewer() {
    showNativeMap();
    if (!ensureMap()) return;

    const now = Date.now();
    const cachedAndFresh = radarLayer && radarFrameKey && (now - radarLoadedAt) < RADAR_REFRESH_MS;
    if (cachedAndFresh) {
      if (!map.hasLayer(radarLayer)) radarLayer.addTo(map);
      message("");
      const time = $("#radarFrameTime");
      if (time && radarFrame) time.textContent = formatTime(radarFrame, "latestRadar");
      requestAnimationFrame(() => map.invalidateSize(false));
      return;
    }

    if (radarLoadPromise) {
      await radarLoadPromise;
      requestAnimationFrame(() => map.invalidateSize(false));
      return;
    }

    if (!radarLayer) message(t("loadingRadar"));

    radarLoadPromise = (async () => {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const frames = Array.isArray(data?.radar?.past) ? data.radar.past : [];
        const frame = frames[frames.length - 1];
        if (!frame?.path || !data?.host) throw new Error("No radar frame");

        const nextKey = `${data.host}${frame.path}`;
        const tileUrl = `${nextKey}/256/{z}/{x}/{y}/2/1_1.png`;

        if (!radarLayer || radarFrameKey !== nextKey) {
          if (radarLayer && map.hasLayer(radarLayer)) map.removeLayer(radarLayer);

          let tileErrors = 0;
          let throttled = false;
          const nextLayer = L.tileLayer(tileUrl, {
            tileSize: 256,
            opacity: .74,
            maxNativeZoom: 7,
            maxZoom: 18,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 0,
            attribution: "Radar © RainViewer"
          });

          // A 429 is emitted by RainViewer itself. Leaflet cannot prevent a server
          // from throttling, but stopping the layer after a few failed tiles avoids
          // hundreds of repeated requests and keeps the rest of the site quiet.
          nextLayer.on("tileerror", () => {
            if (throttled) return;
            tileErrors += 1;
            if (tileErrors >= 4) {
              throttled = true;
              if (map && map.hasLayer(nextLayer)) map.removeLayer(nextLayer);
              if (radarLayer === nextLayer) {
                radarLayer = null;
                radarFrameKey = "";
                radarLoadedAt = 0;
              }
              message(t("radarLimited"), true);
            }
          });

          radarLayer = nextLayer.addTo(map);
          radarFrameKey = nextKey;
        } else if (!map.hasLayer(radarLayer)) {
          radarLayer.addTo(map);
        }

        radarLoadedAt = Date.now();
        radarFrame = frame.time;
        const time = $("#radarFrameTime");
        if (time) time.textContent = formatTime(frame.time, "latestRadar");

        // Only center the map on its first successful radar load. Returning to
        // the radar should preserve the user's pan/zoom instead of causing churn.
        if (!map.__mahattaRadarCentered) {
          map.setView([LAT, LON], 7, { animate: false });
          map.__mahattaRadarCentered = true;
        }
        message("");
      } catch (err) {
        console.warn("RainViewer radar unavailable:", err);
        message(t("radarError"), true);
      } finally {
        radarLoadPromise = null;
      }
    })();

    await radarLoadPromise;
    requestAnimationFrame(() => map.invalidateSize(false));
  }

  function loadWindy(layer) {
    const frame = windyFrame();
    const root = $("#weatherLeafletMap");
    if (!frame) return;

    if (root) root.hidden = true;
    frame.hidden = false;

    const isClouds = layer === "clouds";
    const loadingKey = isClouds ? "loadingClouds" : "loadingWind";
    const titleKey = isClouds ? "windyCloudTitle" : "windyWindTitle";
    const url = windyUrl(layer);
    const alreadyLoaded = frame.dataset.radarLayer === layer && frame.getAttribute("src") === url;

    frame.title = t(titleKey);
    const time = $("#radarFrameTime");
    if (time) time.textContent = "";

    if (alreadyLoaded) {
      message("");
      return;
    }

    message(t(loadingKey));
    frame.dataset.radarLayer = layer;
    frame.onload = () => {
      if (frame.dataset.radarLayer === layer) message("");
    };
    frame.onerror = () => {
      if (frame.dataset.radarLayer === layer) message(t("windyError"), true);
    };
    frame.setAttribute("src", url);
  }

  function updateLabels(layer) {
    const labels = { radar: t("radar"), clouds: t("clouds"), wind: t("wind") };
    $$('[data-radar-layer]').forEach(button => {
      if (labels[button.dataset.radarLayer]) button.textContent = labels[button.dataset.radarLayer];
    });

    const caption = $("[data-radar-text='caption']");
    const source = $("#radarLayerSource");
    if (layer === "clouds") {
      if (caption) caption.textContent = t("captionClouds");
      if (source) source.textContent = t("sourceClouds");
    } else if (layer === "wind") {
      if (caption) caption.textContent = t("captionWind");
      if (source) source.textContent = t("sourceWind");
    } else {
      if (caption) caption.textContent = t("captionRadar");
      if (source) source.textContent = t("sourceRadar");
      if (radarFrame) {
        const time = $("#radarFrameTime");
        if (time) time.textContent = formatTime(radarFrame, "latestRadar");
      }
    }
  }

  function showLayer(layer) {
    activeLayer = ["radar", "clouds", "wind"].includes(layer) ? layer : "radar";
    const shell = $("#weatherMap");
    if (shell) shell.classList.toggle("is-windy-layer", activeLayer !== "radar");
    positionFullscreenButtonForLayer(activeLayer);
    $$('[data-radar-layer]').forEach(button => {
      const active = button.dataset.radarLayer === activeLayer;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    positionFullscreenButtonForLayer(activeLayer);
    });
    updateLabels(activeLayer);
    if (activeLayer === "radar") loadRainViewer();
    else loadWindy(activeLayer);
  }


  function positionFullscreenButtonForLayer(layer = activeLayer) {
    const button = $("#radarFullscreenButton");
    const shell = $("#weatherMap");
    if (!button || !shell) return;

    const windy = layer !== "radar";
    const full = fullscreenElement() === shell || isPseudoFullscreen(shell);
    const offset = full ? "max(12px, env(safe-area-inset-left))" : "10px";
    const rightOffset = full ? "max(12px, env(safe-area-inset-right))" : "10px";

    // Use physical left/right with inline !important so RTL logical inset rules
    // and older cached styles cannot put the control back over Windy's +/-.
    button.style.setProperty("inset-inline-start", "auto", "important");
    button.style.setProperty("inset-inline-end", "auto", "important");
    if (windy) {
      button.style.setProperty("left", offset, "important");
      button.style.setProperty("right", "auto", "important");
    } else {
      button.style.setProperty("left", "auto", "important");
      button.style.setProperty("right", rightOffset, "important");
    }
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function isPseudoFullscreen(shell = $("#weatherMap")) {
    return Boolean(shell?.classList.contains("is-pseudo-fullscreen"));
  }

  function setPseudoFullscreen(shell, active) {
    if (!shell) return;
    shell.classList.toggle("is-pseudo-fullscreen", active);
    document.body.classList.toggle("radar-pseudo-fullscreen", active);
    updateFullscreenButton();
    if (map && activeLayer === "radar") {
      setTimeout(() => map.invalidateSize(false), 80);
    }
  }

  function updateFullscreenButton() {
    const button = $("#radarFullscreenButton");
    const shell = $("#weatherMap");
    if (!button || !shell) return;
    // Keep the control visible on Radar too. If the browser does not support
    // element fullscreen (notably some mobile Safari contexts), CSS fallback
    // provides an app-like full-viewport map instead.
    button.hidden = false;
    const active = fullscreenElement() === shell || isPseudoFullscreen(shell);
    button.textContent = active ? "×" : "⛶";
    button.setAttribute("aria-label", t(active ? "exitFullscreen" : "fullscreen"));
    button.title = t(active ? "exitFullscreen" : "fullscreen");
    button.setAttribute("aria-pressed", String(active));
  }

  async function toggleFullscreen() {
    const shell = $("#weatherMap");
    if (!shell) return;

    if (isPseudoFullscreen(shell)) {
      setPseudoFullscreen(shell, false);
      return;
    }

    try {
      if (fullscreenElement()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
        return;
      }

      const request = shell.requestFullscreen || shell.webkitRequestFullscreen;
      if (request) {
        await request.call(shell);
      } else {
        setPseudoFullscreen(shell, true);
      }
    } catch (err) {
      // A rejected native fullscreen request must not make the control useless.
      setPseudoFullscreen(shell, true);
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-radar-layer]");
    if (button) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showLayer(button.dataset.radarLayer);
      return;
    }
    if (event.target.closest?.("#radarFullscreenButton")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleFullscreen();
    }
  }, true);

  document.addEventListener("mahatta:radar-open", event => {
    event.stopImmediatePropagation();
    showLayer(activeLayer);
  }, true);

  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButton();
    if (map && activeLayer === "radar") setTimeout(() => map.invalidateSize(false), 80);
  });
  document.addEventListener("webkitfullscreenchange", () => {
    updateFullscreenButton();
    if (map && activeLayer === "radar") setTimeout(() => map.invalidateSize(false), 80);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      const shell = $("#weatherMap");
      if (isPseudoFullscreen(shell)) setPseudoFullscreen(shell, false);
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    updateFullscreenButton();
    updateLabels(activeLayer);

    const panel = $("#panel-radar");
    if (panel) {
      new MutationObserver(() => {
        if (panel.hidden) unloadWindy();
      }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    }

    if ($('.tab.active[data-tab="radar"]')) showLayer(activeLayer);
    new MutationObserver(() => updateLabels(activeLayer)).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang", "dir"]
    });
  });

  window.addEventListener("resize", () => {
    if (map && activeLayer === "radar") requestAnimationFrame(() => map.invalidateSize(false));
  }, { passive: true });
})();
