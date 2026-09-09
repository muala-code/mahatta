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
  let radarFrames = [];
  let radarHost = "";
  let radarFrameIndex = -1;
  let radarTimer = null;
  let radarPlaying = false;
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

  function radarTileUrl(frame) {
    if (!radarHost || !frame || !frame.path) return "";
    return `${radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  }

  function radarClock(unixSeconds) {
    const value = Number(unixSeconds);
    if (!Number.isFinite(value)) return "--";
    try {
      const locale = isAr() ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
      return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Riyadh"
      }).format(new Date(value * 1000));
    } catch {
      return new Date(value * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }
  }

  function ensureRadarControls() {
    const shell = $("#weatherMap");
    if (!shell || $("#radarPlaybackControls")) return;

    const controls = document.createElement("div");
    controls.id = "radarPlaybackControls";
    controls.className = "radar-playback-controls";
    controls.hidden = true;
    controls.innerHTML = `
      <button type="button" data-radar-action="center" class="radar-tool-button radar-center-button" aria-label="Center station" title="Center station">&#8982;</button>
      <button type="button" data-radar-action="prev" class="radar-tool-button" aria-label="Previous frame" title="Previous frame">&#8249;</button>
      <button type="button" data-radar-action="play" class="radar-tool-button radar-play-button" aria-label="Play radar" title="Play radar">&#9654;</button>
      <button type="button" data-radar-action="next" class="radar-tool-button" aria-label="Next frame" title="Next frame">&#8250;</button>
      <span id="radarControlTime" class="radar-control-time" aria-live="polite">--</span>
    `;
    shell.appendChild(controls);

    controls.addEventListener("click", event => {
      const button = event.target.closest ? event.target.closest("[data-radar-action]") : null;
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();

      const action = button.dataset.radarAction;
      if (action === "center") {
        recenterStation();
      } else if (action === "prev") {
        stopRadarAnimation();
        stepRadar(-1);
      } else if (action === "next") {
        stopRadarAnimation();
        stepRadar(1);
      } else if (action === "play") {
        toggleRadarAnimation();
      }
    });

    updateRadarControls();
  }

  function showRadarControls(show) {
    ensureRadarControls();
    const controls = $("#radarPlaybackControls");
    if (controls) controls.hidden = !show;
  }

  function updateRadarControls() {
    const controls = $("#radarPlaybackControls");
    if (!controls) return;

    const hasFrames = radarFrames.length > 0;
    const canStep = radarFrames.length > 1;
    const play = controls.querySelector('[data-radar-action="play"]');
    const prev = controls.querySelector('[data-radar-action="prev"]');
    const next = controls.querySelector('[data-radar-action="next"]');
    const center = controls.querySelector('[data-radar-action="center"]');
    const time = $("#radarControlTime");

    if (prev) prev.disabled = !canStep;
    if (next) next.disabled = !canStep;

    if (play) {
      play.disabled = !canStep;
      play.textContent = radarPlaying ? "\u23F8" : "\u25B6";
      const label = isAr()
        ? (radarPlaying ? "\u0625\u064A\u0642\u0627\u0641 \u062D\u0631\u0643\u0629 \u0627\u0644\u0631\u0627\u062F\u0627\u0631 \u0645\u0624\u0642\u062A\u0627" : "\u062A\u0634\u063A\u064A\u0644 \u062D\u0631\u0643\u0629 \u0627\u0644\u0631\u0627\u062F\u0627\u0631")
        : (radarPlaying ? "Pause radar animation" : "Play radar animation");
      play.setAttribute("aria-label", label);
      play.title = label;
    }

    if (center) {
      const label = isAr()
        ? "\u0627\u0644\u0639\u0648\u062F\u0629 \u0625\u0644\u0649 \u0645\u0648\u0642\u0639 \u0627\u0644\u0645\u062D\u0637\u0629"
        : "Center on station";
      center.setAttribute("aria-label", label);
      center.title = label;
    }

    if (time) {
      time.textContent = hasFrames && radarFrame
        ? `${radarClock(radarFrame)}  ${radarFrameIndex + 1}/${radarFrames.length}`
        : "--";
      time.title = isAr()
        ? "\u0648\u0642\u062A \u0625\u0637\u0627\u0631 \u0627\u0644\u0631\u0627\u062F\u0627\u0631"
        : "Radar frame time";
    }
  }

  function renderRadarFrame(index) {
    if (!map || !radarFrames.length || !radarHost) return;

    const numericIndex = Number(index);
    const safeIndex = Math.max(
      0,
      Math.min(radarFrames.length - 1, Number.isFinite(numericIndex) ? numericIndex : 0)
    );
    const frame = radarFrames[safeIndex];
    const tileUrl = radarTileUrl(frame);
    if (!tileUrl) return;

    if (!radarLayer) {
      radarLayer = L.tileLayer(tileUrl, {
        tileSize: 256,
        opacity: .74,
        maxNativeZoom: 7,
        maxZoom: 18,
        attribution: "Radar (c) RainViewer"
      }).addTo(map);
    } else {
      radarLayer.setUrl(tileUrl, false);
    }

    radarFrameIndex = safeIndex;
    radarFrame = Number(frame.time);
    updateRadarControls();
  }

  function stopRadarAnimation() {
    if (radarTimer) {
      clearInterval(radarTimer);
      radarTimer = null;
    }
    radarPlaying = false;
    updateRadarControls();
  }

  function startRadarAnimation() {
    if (radarFrames.length < 2) return;

    stopRadarAnimation();

    if (radarFrameIndex >= radarFrames.length - 1) {
      renderRadarFrame(0);
    }

    radarPlaying = true;
    updateRadarControls();

    radarTimer = setInterval(() => {
      if (activeLayer !== "radar" || radarFrames.length < 2) {
        stopRadarAnimation();
        return;
      }
      const nextIndex = radarFrameIndex >= radarFrames.length - 1
        ? 0
        : radarFrameIndex + 1;
      renderRadarFrame(nextIndex);
    }, 900);
  }

  function toggleRadarAnimation() {
    if (radarPlaying) stopRadarAnimation();
    else startRadarAnimation();
  }

  function stepRadar(delta) {
    if (!radarFrames.length) return;
    const nextIndex = Math.max(
      0,
      Math.min(radarFrames.length - 1, radarFrameIndex + Number(delta || 0))
    );
    renderRadarFrame(nextIndex);
  }

  function recenterStation() {
    if (!map) return;
    map.panTo([LAT, LON], { animate: true, duration: 0.4 });
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

    ensureRadarControls();
    showRadarControls(true);
    stopRadarAnimation();
    removeRadarOverlay();
    message(t("loadingRadar"));

    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      radarHost = typeof data?.host === "string" ? data.host : "";
      radarFrames = Array.isArray(data?.radar?.past)
        ? data.radar.past.filter(frame => frame && frame.path && Number.isFinite(Number(frame.time)))
        : [];

      if (!radarHost || !radarFrames.length) {
        throw new Error("No radar frames");
      }

      renderRadarFrame(radarFrames.length - 1);
      message("");
    } catch (err) {
      radarFrames = [];
      radarHost = "";
      radarFrameIndex = -1;
      radarFrame = null;
      updateRadarControls();
      console.warn("RainViewer radar unavailable:", err);
      message(t("radarError"), true);
    }

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

    $$('[data-radar-layer]').forEach(button => {
      const active = button.dataset.radarLayer === activeLayer;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    positionFullscreenButtonForLayer(activeLayer);
    updateLabels(activeLayer);

    if (activeLayer === "radar") {
      showRadarControls(true);
      loadRainViewer();
    } else {
      stopRadarAnimation();
      showRadarControls(false);
      loadWindy(activeLayer);
    }
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
