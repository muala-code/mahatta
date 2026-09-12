/* ===== v1.9-phase1.js (consolidated for v1.9.0) ===== */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const AR_SOURCES = {
    current: "قراءات المحطة حسب موقع Weather Underground (WU).",
    forecast: "التوقعات حسب منصة Weather Underground (WU).",
    history: "البيانات التاريخية مستمدة من قراءات المحطة المسجلة عبر Weather Underground (WU).",
    prayer: "أوقات الصلاة حسب موقع AlAdhan، وفق طريقة أم القرى."
  };
  const EN_SOURCES = {
    current: "Station observations are provided by Weather Underground (WU).",
    forecast: "Forecast data is provided by Weather Underground (WU).",
    history: "Historical data is derived from station observations recorded through Weather Underground (WU).",
    prayer: "Prayer times are provided by AlAdhan using the Umm Al-Qura method."
  };

  const isArabic = () => document.documentElement.lang !== "en";
  const sourceText = key => (isArabic() ? AR_SOURCES : EN_SOURCES)[key] || "";

  function ensureInfoDialog() {
    let dialog = $("#sourceInfoDialog");
    if (dialog) return dialog;
    dialog = document.createElement("div");
    dialog.id = "sourceInfoDialog";
    dialog.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = `
      <div class="source-info-backdrop" data-info-close></div>
      <div class="source-info-card" role="document">
        <button class="source-info-close" type="button" data-info-close aria-label="إغلاق">×</button>
        <strong class="source-info-title"></strong>
        <p class="source-info-text"></p>
      </div>`;
    document.body.appendChild(dialog);

    const style = document.createElement("style");
    style.textContent = `
      #sourceInfoDialog{position:fixed;inset:0;z-index:90}
      #sourceInfoDialog[hidden]{display:none!important}
      .source-info-backdrop{position:absolute;inset:0;background:rgba(17,25,21,.28);backdrop-filter:blur(2px)}
      .source-info-card{position:absolute;inset-inline:16px;top:50%;transform:translateY(-50%);max-width:360px;margin:auto;padding:18px 44px 17px 18px;border:1px solid var(--line);border-radius:16px;background:var(--surface);color:var(--text);box-shadow:0 18px 50px rgba(15,25,20,.22)}
      html[dir="rtl"] .source-info-card{padding:18px 18px 17px 44px}
      .source-info-title{display:block;margin-bottom:7px;font-size:15px}
      .source-info-text{margin:0;color:var(--muted);font-size:13px;line-height:1.75}
      .source-info-close{position:absolute;top:9px;inset-inline-end:9px;width:30px;height:30px;border:0;border-radius:9px;background:var(--surface-soft);color:var(--text);font-size:21px;line-height:1;cursor:pointer}
    `;
    document.head.appendChild(style);
    dialog.addEventListener("click", event => {
      if (event.target.closest("[data-info-close]")) closeInfo();
    });
    return dialog;
  }

  function openInfo(key) {
    const dialog = ensureInfoDialog();
    $(".source-info-title", dialog).textContent = isArabic() ? "مصدر البيانات" : "Data source";
    $(".source-info-text", dialog).textContent = sourceText(key);
    $(".source-info-close", dialog).setAttribute("aria-label", isArabic() ? "إغلاق" : "Close");
    dialog.hidden = false;
  }

  function closeInfo() {
    const dialog = $("#sourceInfoDialog");
    if (dialog) dialog.hidden = true;
  }

  function makeInfoButton(key) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "info-button";
    button.dataset.sourceInfo = key;
    button.textContent = "i";
    button.setAttribute("aria-label", isArabic() ? "مصدر البيانات" : "Data source");
    button.addEventListener("click", event => {
      event.stopPropagation();
      openInfo(key);
    });
    return button;
  }

  function addInfoButtons() {
    const currentLabel = $("#panel-current .line-label");
    if (currentLabel && !$("[data-source-info='current']", currentLabel.parentElement)) {
      const wrap = document.createElement("span");
      wrap.className = "line-title-with-info";
      currentLabel.parentNode.insertBefore(wrap, currentLabel);
      wrap.append(currentLabel, makeInfoButton("current"));
    }

    [["forecast", "#panel-forecast .section-head h1"], ["history", "#panel-history .section-head h1"], ["prayer", "#panel-prayer .section-head h1"]]
      .forEach(([key, selector]) => {
        const heading = $(selector);
        if (!heading || $("[data-source-info]", heading.parentElement)) return;
        const wrap = document.createElement("div");
        wrap.className = "section-title-with-info";
        heading.parentNode.insertBefore(wrap, heading);
        wrap.append(heading, makeInfoButton(key));
      });
  }

  function closeMenu() {
    const menu = $("#menuPanel");
    const button = $("#menuButton");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    button?.setAttribute("aria-expanded", "false");
  }

  function setupMenuBehaviour() {
    document.addEventListener("click", event => {
      if (event.target.closest(".setting-option[data-setting]")) queueMicrotask(closeMenu);
    });
    document.addEventListener("change", event => {
      if (event.target.matches("#showRainChart, #showPressureChart")) queueMicrotask(closeMenu);
    });
  }

  function weekdayRiyadh() {
    try {
      return new Intl.DateTimeFormat(isArabic() ? "ar-SA" : "en-US", {
        weekday: "long", timeZone: "Asia/Riyadh"
      }).format(new Date());
    } catch {
      return "";
    }
  }

  function normalizePrayerHeader() {
    const panel = $("#panel-prayer");
    const heading = $("#prayerDate", panel);
    const hijri = $("#hijriDate", panel);
    const headFirst = $(".section-head > div", panel);
    const source = $(".section-source", panel);
    if (!heading || !hijri || !headFirst) return;

    const wantedTitle = isArabic() ? "أوقات الصلاة" : "Prayer times";
    if (heading.textContent !== wantedTitle) heading.textContent = wantedTitle;

    if (hijri.parentElement !== headFirst) headFirst.appendChild(hijri);
    const raw = (hijri.textContent || "")
      .replace(/^\s*(التاريخ الهجري|Hijri date)\s*[:：]\s*/i, "")
      .replace(/^\s*(الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+/i, "")
      .trim();
    if (raw) {
      const day = weekdayRiyadh();
      const suffix = isArabic() && !/هـ\s*$/.test(raw) ? "هـ" : "";
      const wanted = `${day} ${raw}${suffix}`.trim();
      if (hijri.textContent !== wanted) hijri.textContent = wanted;
    }
    if (source) {
      source.removeAttribute("data-i18n");
      const wantedSource = isArabic() ? "حسب تقويم أم القرى" : "Umm Al-Qura calendar";
      if (source.textContent !== wantedSource) source.textContent = wantedSource;
    }
  }

  function setupPrayerHeaderObserver() {
    const target = $("#panel-prayer");
    if (!target) return;
    normalizePrayerHeader();
    let busy = false;
    new MutationObserver(() => {
      if (busy) return;
      busy = true;
      queueMicrotask(() => { normalizePrayerHeader(); busy = false; });
    }).observe(target, { childList: true, subtree: true, characterData: true });
  }

  function numericText(text) {
    const normalized = String(text || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/,/g, ".");
    const m = normalized.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function timeMinutes(text) {
    const m = String(text || "").match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function clock(minutes) {
    if (!Number.isFinite(minutes)) return "";
    const n = Math.max(0, Math.round(minutes));
    return `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  }

  function axisModel(svg) {
    const vb = svg.viewBox?.baseVal;
    const height = vb?.height || 126;
    const texts = $$("text.chart-axis-text", svg).map(el => ({
      el, x: Number(el.getAttribute("x")), y: Number(el.getAttribute("y")), text: el.textContent.trim()
    })).filter(x => Number.isFinite(x.x) && Number.isFinite(x.y));

    const yLabels = texts.filter(x => x.y < height - 12 && numericText(x.text) !== null);
    const xLabels = texts.filter(x => x.y >= height - 12);
    let valueAtY = null;
    if (yLabels.length >= 2) {
      const a = yLabels[0], b = yLabels[yLabels.length - 1];
      const av = numericText(a.text), bv = numericText(b.text);
      if (av !== null && bv !== null && a.y !== b.y) {
        valueAtY = y => av + (y - a.y) * (bv - av) / (b.y - a.y);
      }
    }
    let timeAtX = null;
    const timeLabels = xLabels.map(x => ({ ...x, minute: timeMinutes(x.text) })).filter(x => x.minute !== null);
    if (timeLabels.length >= 2) {
      const a = timeLabels[0], b = timeLabels[timeLabels.length - 1];
      if (a.x !== b.x) timeAtX = x => a.minute + (x - a.x) * (b.minute - a.minute) / (b.x - a.x);
    }
    const unitText = yLabels.find(x => /°|%|مم|mm|hPa|كم|km|mph|inHg/i.test(x.text))?.text.replace(/[-+]?\d+(?:[.,]\d+)?/g, "").trim() || "";
    return { valueAtY, timeAtX, unitText, height, xLabels };
  }

  function tipLabel(model, x, y, fallbackLabel = "") {
    const value = model.valueAtY ? model.valueAtY(y) : null;
    const time = model.timeAtX ? clock(model.timeAtX(x)) : "";
    const valueText = Number.isFinite(value) ? `${Math.round(value * 10) / 10}${model.unitText}` : "";
    return [time || fallbackLabel, valueText].filter(Boolean).join(" · ");
  }

  function parsePathPoints(path) {
    const d = path.getAttribute("d") || "";
    const nums = [...d.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)];
    return nums.map(m => ({ x: Number(m[1]), y: Number(m[2]) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  function enrichNormalChart(svg) {
    if (svg.dataset.phase1Enriched === "1") return;
    svg.dataset.phase1Enriched = "1";
    const model = axisModel(svg);

    $$("path.chart-line", svg).forEach(path => {
      parsePathPoints(path).forEach(point => {
        const c = document.createElementNS(SVG_NS, "circle");
        c.setAttribute("class", "chart-touch-point");
        c.setAttribute("cx", point.x);
        c.setAttribute("cy", point.y);
        c.setAttribute("r", "6");
        c.dataset.chartTip = tipLabel(model, point.x, point.y);
        svg.appendChild(c);
      });
    });

    $$("circle.chart-dot", svg).forEach(dot => {
      const x = Number(dot.getAttribute("cx")), y = Number(dot.getAttribute("cy"));
      dot.dataset.chartTip = tipLabel(model, x, y);
    });

    $$("rect.chart-bar", svg).forEach(rect => {
      const x = Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2;
      const y = Number(rect.getAttribute("y"));
      rect.dataset.chartTip = tipLabel(model, x, y);
    });
  }

  function annualValueFromTitle(rect) {
    const title = $("title", rect)?.textContent || "";
    const parts = title.split(/[:：]/);
    return (parts.length > 1 ? parts.slice(1).join(":") : title).trim();
  }

  function enrichAnnualChart(svg) {
    if (svg.dataset.phase1Enriched === "1") return;
    $$(".year-value-label", svg).forEach(el => el.remove());
    $$("rect.year-rain-bar, rect.year-high-bar, rect.year-low-bar", svg).forEach(rect => {
      const value = annualValueFromTitle(rect);
      if (!value) return;
      rect.removeAttribute("tabindex");
      rect.removeAttribute("data-chart-tip");
      delete rect.dataset.chartTip;
      const x = Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2;
      const y = Math.max(8, Number(rect.getAttribute("y")) - 4);
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "year-value-label");
      label.setAttribute("x", x.toFixed(1));
      label.setAttribute("y", y.toFixed(1));
      label.setAttribute("text-anchor", "middle");
      label.textContent = value;
      svg.appendChild(label);
    });
    svg.dataset.phase1Enriched = "1";
  }

  function enrichCharts() {
    $$(".chart-wrap svg").forEach(svg => {
      if (svg.closest("#yearSummaryChart")) enrichAnnualChart(svg);
      else enrichNormalChart(svg);
    });
  }

  function ensureTooltip() {
    let tip = $("#chartTooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "chartTooltip";
      tip.className = "chart-tooltip";
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showTip(target, event) {
    const text = target?.dataset?.chartTip;
    if (!text) return;
    const tip = ensureTooltip();
    tip.textContent = text;
    const point = event.touches?.[0] || event.changedTouches?.[0] || event;
    const clientX = Number.isFinite(point.clientX) ? point.clientX : innerWidth / 2;
    const clientY = Number.isFinite(point.clientY) ? point.clientY : innerHeight / 2;
    tip.style.left = `${Math.min(innerWidth - 12, Math.max(12, clientX))}px`;
    tip.style.top = `${Math.max(12, clientY - 46)}px`;
    tip.style.transform = "translate(-50%, 0)";
    tip.classList.add("is-visible");
  }

  function hideTip() {
    $("#chartTooltip")?.classList.remove("is-visible");
  }

  function setupChartInteractions() {
    if (document.documentElement.dataset.phase1ChartInteractionsBound === "1") return;
    document.documentElement.dataset.phase1ChartInteractionsBound = "1";

    document.addEventListener("pointerdown", event => {
      const target = event.target.closest?.("[data-chart-tip]");
      if (target) showTip(target, event);
      else if (!event.target.closest?.(".chart-wrap")) hideTip();
    }, { passive: true });
  }

  function normalizeLatestReading() {
    const el = $("#observedAt");
    if (!el || !isArabic()) return;
    const text = el.textContent || "";
    if (/^\s*آخر قراءة/.test(text)) el.textContent = text.replace(/^\s*آخر قراءة/, "أحدث قراءة");
  }

  function refreshUi() {
    $(".menu-note")?.remove();
    normalizeLatestReading();
    addInfoButtons();
    normalizePrayerHeader();
    enrichCharts();
    setupChartInteractions();
    $$(".info-button").forEach(button => button.setAttribute("aria-label", isArabic() ? "مصدر البيانات" : "Data source"));
  }

  document.addEventListener("DOMContentLoaded", () => {
    ensureInfoDialog();
    ensureTooltip();
    setupMenuBehaviour();
    setupPrayerHeaderObserver();
    refreshUi();

    const historyPanel = $("#panel-history");
    if (historyPanel) {
      let scheduled = false;
      new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          enrichCharts();
        });
      }).observe(historyPanel, { childList: true, subtree: true });
    }

    new MutationObserver(refreshUi).observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });
  });
})();

/* ===== v1.9-phase1-1.js (consolidated for v1.9.0) ===== */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = "mahattaTextSizeV2";
  const VALID_TEXT_SIZES = new Set(["small", "medium", "large"]);
  const LAT = "24.234096";
  const LON = "39.551125";

  const copy = {
    ar: {
      textSize: "حجم النص", small: "صغير", medium: "وسط", large: "كبير",
      radarTab: "الرادار", eyebrow: "مشهد الطقس", title: "الرادار",
      radar: "الرادار", clouds: "السحب", wind: "الرياح",
      caption: "الخريطة مركزة على موقع المحطة.",
      frameTitleRadar: "رادار الطقس حول المحطة",
      frameTitleClouds: "السحب حول المحطة",
      source: "رادار المطر حسب RainViewer. السحب والرياح حسب Windy. تعرض المحطة هذه البيانات من مصادر خارجية ولا تصدرها بنفسها."
    },
    en: {
      textSize: "Text size", small: "Small", medium: "Medium", large: "Large",
      radarTab: "Radar", eyebrow: "Weather view", title: "Radar",
      radar: "Radar", clouds: "Clouds", wind: "Wind",
      caption: "The map is centered on the station location.",
      frameTitleRadar: "Weather radar around the station",
      frameTitleClouds: "Clouds around the station",
      source: "Rain radar is provided by RainViewer. Clouds and wind are provided by Windy. The station displays external data and does not issue it itself."
    }
  };

  const lang = () => document.documentElement.lang === "en" ? "en" : "ar";
  const text = key => copy[lang()][key] || key;

  function savedTextSize() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return VALID_TEXT_SIZES.has(value) ? value : "small";
    } catch {
      return "medium";
    }
  }

  function applyTextSize(value, persist = true) {
    const next = VALID_TEXT_SIZES.has(value) ? value : "small";
    document.documentElement.dataset.textSize = next;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
    $$('[data-text-size-option]').forEach(button => {
      const active = button.dataset.textSizeOption === next;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function insertTextSizeMenu() {
    if ($("#textSizeMenuSection")) return;
    const extra = $(".extra-chart-options")?.closest(".menu-section");
    if (!extra) return;

    const section = document.createElement("div");
    section.className = "menu-section";
    section.id = "textSizeMenuSection";
    section.innerHTML = `
      <div class="menu-title" data-text-size-label>${text("textSize")}</div>
      <div class="setting-list text-size-options" role="group" aria-label="${text("textSize")}">
        <button class="setting-option" type="button" data-text-size-option="small"><span>${text("small")}</span><span class="choice-box" aria-hidden="true">✓</span></button>
        <button class="setting-option" type="button" data-text-size-option="medium"><span>${text("medium")}</span><span class="choice-box" aria-hidden="true">✓</span></button>
        <button class="setting-option" type="button" data-text-size-option="large"><span>${text("large")}</span><span class="choice-box" aria-hidden="true">✓</span></button>
      </div>`;
    extra.parentNode.insertBefore(section, extra);

    section.addEventListener("click", event => {
      const button = event.target.closest("[data-text-size-option]");
      if (!button) return;
      applyTextSize(button.dataset.textSizeOption, true);
      const menu = $("#menuPanel"), trigger = $("#menuButton");
      if (menu) menu.hidden = true;
      trigger?.setAttribute("aria-expanded", "false");
    });
    applyTextSize(savedTextSize(), false);
  }

  function syncTextSizeMenuLanguage() {
    const section = $("#textSizeMenuSection");
    if (!section) return;
    $("[data-text-size-label]", section).textContent = text("textSize");
    const labels = { small: text("small"), medium: text("medium"), large: text("large") };
    $$('[data-text-size-option]', section).forEach(button => {
      const span = $("span", button);
      if (span) span.textContent = labels[button.dataset.textSizeOption];
    });
    $(".text-size-options", section)?.setAttribute("aria-label", text("textSize"));
  }

  /* Replace the Phase-1 modal source dialog with a small anchored note.
     Capture click before the old target listener so the modal never opens. */
  let noteAnchor = null;
  let hideTimer = 0;

  function ensureNote() {
    let note = $("#sourceHoverNote");
    if (note) return note;
    note = document.createElement("div");
    note.id = "sourceHoverNote";
    note.className = "source-hover-note";
    note.setAttribute("role", "tooltip");
    note.hidden = true;
    document.body.appendChild(note);
    note.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    note.addEventListener("mouseleave", () => scheduleHideNote(50));
    return note;
  }

  function sourceFor(button) {
    if (button?.dataset?.sourceInfo === "radar") return text("source");
    const key = button?.dataset?.sourceInfo;
    const ar = {
      current: "قراءات المحطة حسب موقع Weather Underground (WU).",
      forecast: "التوقعات حسب منصة Weather Underground (WU).",
      history: "البيانات التاريخية مستمدة من قراءات المحطة المسجلة عبر Weather Underground (WU).",
      prayer: "أوقات الصلاة حسب موقع AlAdhan، وفق طريقة أم القرى."
    };
    const en = {
      current: "Station observations are provided by Weather Underground (WU).",
      forecast: "Forecast data is provided by Weather Underground (WU).",
      history: "Historical data is derived from station observations recorded through Weather Underground (WU).",
      prayer: "Prayer times are provided by AlAdhan using the Umm Al-Qura method."
    };
    return (lang() === "ar" ? ar : en)[key] || "";
  }

  function placeNote(button) {
    const note = ensureNote();
    const rect = button.getBoundingClientRect();
    const margin = 8;
    note.hidden = false;
    note.classList.remove("is-above");
    note.style.left = "12px";
    note.style.top = "12px";
    const nr = note.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = lang() === "ar" ? rect.right - nr.width : rect.left;
    left = Math.min(innerWidth - nr.width - margin, Math.max(margin, left));
    if (top + nr.height > innerHeight - margin) {
      top = rect.top - nr.height - 8;
      note.classList.add("is-above");
    }
    note.style.left = `${Math.round(left)}px`;
    note.style.top = `${Math.round(Math.max(margin, top))}px`;
  }

  function showNote(button) {
    clearTimeout(hideTimer);
    const note = ensureNote();
    const value = sourceFor(button);
    if (!value) return;
    noteAnchor = button;
    note.textContent = value;
    note.dir = lang() === "ar" ? "rtl" : "ltr";
    placeNote(button);
    button.setAttribute("aria-describedby", "sourceHoverNote");
  }

  function hideNote() {
    clearTimeout(hideTimer);
    const note = $("#sourceHoverNote");
    if (note) note.hidden = true;
    noteAnchor?.removeAttribute("aria-describedby");
    noteAnchor = null;
  }

  function scheduleHideNote(delay = 90) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideNote, delay);
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.(".info-button[data-source-info]");
    if (!button) {
      if (!event.target.closest?.("#sourceHoverNote")) hideNote();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (noteAnchor === button && !$("#sourceHoverNote")?.hidden) hideNote();
    else showNote(button);
  }, true);

  function bindInfoHover() {
    $$(".info-button[data-source-info]").forEach(button => {
      if (button.dataset.phase11HoverBound) return;
      button.dataset.phase11HoverBound = "1";
      button.addEventListener("mouseenter", () => {
        if (matchMedia("(hover: hover) and (pointer: fine)").matches) showNote(button);
      });
      button.addEventListener("mouseleave", () => {
        if (matchMedia("(hover: hover) and (pointer: fine)").matches) scheduleHideNote(70);
      });
    });
  }

  /* Annual values are permanent labels; remove Phase-1 click/focus interaction. */
  function sanitizeAnnualChart() {
    const root = $("#yearSummaryChart");
    if (!root) return;
    $$("rect.year-rain-bar, rect.year-high-bar, rect.year-low-bar", root).forEach(rect => {
      rect.removeAttribute("tabindex");
      rect.removeAttribute("data-chart-tip");
      delete rect.dataset.chartTip;
    });
  }

  function windyUrl(layer) {
    const isClouds = layer === "clouds";
    const overlay = isClouds ? "clouds" : "radar";
    const product = isClouds ? "satellite" : "radar";
    return `https://embed.windy.com/embed2.html?lat=${LAT}&lon=${LON}&detailLat=${LAT}&detailLon=${LON}&zoom=7&level=surface&overlay=${overlay}&product=${product}&menu=&message=false&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&metricRain=mm&radarRange=-1`;
  }

  function setRadarLayer(layer, force = false) {
    const next = layer === "clouds" ? "clouds" : "radar";
    const frame = $("#radarFrame");
    if (!frame) return;
    $$("[data-radar-layer]").forEach(button => {
      const active = button.dataset.radarLayer === next;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    frame.title = next === "clouds" ? text("frameTitleClouds") : text("frameTitleRadar");
    const url = windyUrl(next);
    if (force || frame.src !== url) frame.src = url;
    frame.dataset.radarLayer = next;
  }

  function syncRadarLanguage() {
    const tab = $('.tab[data-tab="radar"]');
    const radarLabel = $('.tab[data-tab="radar"] .tab-label');
    if (radarLabel) radarLabel.textContent = text("radarTab");
    else if (tab) tab.textContent = text("radarTab");
    $$('[data-radar-text]').forEach(el => {
      const key = el.dataset.radarText;
      if (copy[lang()][key]) el.textContent = text(key);
    });
    const radarButton = $('[data-radar-layer="radar"]');
    const cloudButton = $('[data-radar-layer="clouds"]');
    const windButton = $('[data-radar-layer="wind"]');
    if (radarButton) radarButton.textContent = text("radar");
    if (cloudButton) cloudButton.textContent = text("clouds");
    if (windButton) windButton.textContent = text("wind");
    $(".radar-layer-switch")?.setAttribute("aria-label", lang() === "ar" ? "طبقة الخريطة" : "Map layer");
    const frame = $("#radarFrame");
    if (frame) frame.title = frame.dataset.radarLayer === "clouds" ? text("frameTitleClouds") : text("frameTitleRadar");
    const radarInfo = $('.info-button[data-source-info="radar"]');
    radarInfo?.setAttribute("aria-label", lang() === "ar" ? "مصدر بيانات الرادار" : "Radar data source");
    syncTextSizeMenuLanguage();
    if (noteAnchor) showNote(noteAnchor);
  }

  function initRadar() {
    $$("[data-radar-layer]").forEach(button => {
      if (button.dataset.radarBound) return;
      button.dataset.radarBound = "1";
      button.addEventListener("click", () => setRadarLayer(button.dataset.radarLayer));
    });
    const frame = $("#radarFrame");
    if (frame && !frame.dataset.radarLayer) frame.dataset.radarLayer = "radar";
    syncRadarLanguage();
  }

  document.addEventListener("mahatta:radar-open", () => {
    const frame = $("#radarFrame");
    if (frame && !frame.src) setRadarLayer(frame.dataset.radarLayer || "radar");
  });

  function refresh() {
    insertTextSizeMenu();
    bindInfoHover();
    sanitizeAnnualChart();
    initRadar();
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTextSize(savedTextSize(), false);
    ensureNote();
    refresh();

    const annualRoot = $("#yearSummaryChart");
    if (annualRoot) {
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          sanitizeAnnualChart();
        });
      }).observe(annualRoot, { childList: true, subtree: true });
    }

    new MutationObserver(() => {
      syncRadarLanguage();
      bindInfoHover();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });

    window.addEventListener("resize", () => {
      if (noteAnchor) placeNote(noteAnchor);
    }, { passive: true });
  });
})();


// ===== v1.9.4e tab tooltips =====
(() => {
  const tabs = [...document.querySelectorAll('.tab[data-tab]')];
  if (!tabs.length) return;

  const syncTabTooltip = (tab) => {
    const label = tab.querySelector('.tab-label');
    const text = (label?.textContent || tab.dataset.tooltip || '').trim();
    if (!text) return;
    tab.dataset.tooltip = text;
    tab.setAttribute('aria-label', text);
    tab.setAttribute('title', text);
  };

  const closeTip = (tab, delay = 0) => {
    window.setTimeout(() => tab.classList.remove('tooltip-open'), delay);
  };

  tabs.forEach((tab) => {
    syncTabTooltip(tab);
    const label = tab.querySelector('.tab-label');
    if (label) new MutationObserver(() => syncTabTooltip(tab)).observe(label, { childList: true, subtree: true, characterData: true });

    let timer = 0;
    const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = 0; } };

    tab.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      cancelTimer();
      delete tab.dataset.tooltipHeld;
      timer = window.setTimeout(() => {
        timer = 0;
        tab.dataset.tooltipHeld = '1';
        tab.classList.add('tooltip-open');
      }, 520);
    }, { passive: true });

    tab.addEventListener('pointerup', () => {
      cancelTimer();
      if (tab.dataset.tooltipHeld === '1') closeTip(tab, 900);
    }, { passive: true });
    tab.addEventListener('pointercancel', () => { cancelTimer(); closeTip(tab); }, { passive: true });
    tab.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'mouse') cancelTimer();
    }, { passive: true });
  });

  document.addEventListener('click', (event) => {
    const tab = event.target.closest?.('.tab[data-tooltip-held="1"]');
    if (!tab) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    delete tab.dataset.tooltipHeld;
  }, true);
})();
