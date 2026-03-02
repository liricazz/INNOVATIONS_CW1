const RUSSIA_CENTER = [61.524, 105.3188];
const RUSSIA_ZOOM = 4;
const MAX_LIST_ITEMS = 250;

const dom = {
  searchInput: document.getElementById("searchInput"),
  industryFilter: document.getElementById("industryFilter"),
  resetBtn: document.getElementById("resetBtn"),
  resultsList: document.getElementById("resultsList"),
  visibleCount: document.getElementById("visibleCount"),
  totalCount: document.getElementById("totalCount"),
  namedCount: document.getElementById("namedCount"),
  websiteCount: document.getElementById("websiteCount"),
  dataMeta: document.getElementById("dataMeta"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
};

const map = L.map("map", {
  zoomControl: false,
  minZoom: 3,
});
L.control.zoom({ position: "topright" }).addTo(map);
map.setView(RUSSIA_CENTER, RUSSIA_ZOOM);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; CARTO',
}).addTo(map);

const clusterLayer = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 48,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
});
map.addLayer(clusterLayer);

const markerIcon = L.divIcon({
  className: "factory-pin",
  html: "<span></span>",
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

let allFactories = [];
let filteredFactories = [];
const markerById = new Map();

const industryNameMap = {
  works: "Промышленный комплекс",
  factory: "Завод",
  manufacture: "Производство",
  industrial: "Промышленная площадка",
};

initialize();

async function initialize() {
  try {
    const response = await fetch("./data/factories.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const raw = await response.json();
    allFactories = raw
      .map((item) => createRecord(item))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));

    if (!allFactories.length) {
      throw new Error("Файл данных загружен, но список пуст.");
    }

    updateHeaderStats();
    populateIndustryFilter();
    buildMarkers();
    applyFilters();

    dom.dataMeta.textContent = `Источник: OpenStreetMap (обновлено ${new Date().toLocaleDateString("ru-RU")})`;
    hideLoading();
  } catch (error) {
    dom.loadingText.textContent = `Ошибка загрузки данных: ${error.message}`;
    dom.dataMeta.textContent =
      "Проверьте запуск через локальный сервер и наличие файла data/factories.json.";
  }
}

function createRecord(item) {
  const name = textOrFallback(item.name, "Без названия");
  const city = textOrFallback(item.city, "Город не указан");
  const industryRaw = textOrFallback(item.industry, "не указан");
  const industryLabel = industryNameMap[industryRaw.toLowerCase()] || industryRaw;

  return {
    id: item.id,
    name,
    city,
    lat: Number(item.lat),
    lon: Number(item.lon),
    operator: cleanText(item.operator),
    product: cleanText(item.product),
    startDate: cleanText(item.start_date),
    description: cleanText(item.description),
    website: cleanText(item.website),
    wikipedia: cleanText(item.wikipedia),
    industry: industryRaw,
    industryLabel,
    searchIndex: normalize([
      name,
      city,
      industryRaw,
      industryLabel,
      item.description,
      item.operator,
      item.product,
    ].join(" ")),
  };
}

function updateHeaderStats() {
  const total = allFactories.length;
  const named = allFactories.filter((f) => f.name !== "Без названия").length;
  const websites = allFactories.filter((f) => Boolean(f.website)).length;

  dom.totalCount.textContent = formatCount(total);
  dom.namedCount.textContent = formatCount(named);
  dom.websiteCount.textContent = formatCount(websites);
}

function populateIndustryFilter() {
  const unique = [...new Set(allFactories.map((f) => f.industryLabel))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));

  for (const industry of unique) {
    const option = document.createElement("option");
    option.value = industry;
    option.textContent = industry;
    dom.industryFilter.append(option);
  }
}

function buildMarkers() {
  for (const factory of allFactories) {
    const marker = L.marker([factory.lat, factory.lon], {
      icon: markerIcon,
      title: factory.name,
      keyboard: true,
    });
    marker.bindPopup(renderPopup(factory), { maxWidth: 360 });
    markerById.set(factory.id, marker);
    factory.marker = marker;
  }
}

function wireUI() {
  const debounced = debounce(applyFilters, 180);
  dom.searchInput.addEventListener("input", debounced);
  dom.industryFilter.addEventListener("change", applyFilters);
  dom.resetBtn.addEventListener("click", () => {
    dom.searchInput.value = "";
    dom.industryFilter.value = "";
    applyFilters();
  });
}

wireUI();

function applyFilters() {
  const searchTerm = normalize(dom.searchInput.value);
  const chosenIndustry = dom.industryFilter.value;

  filteredFactories = allFactories.filter((factory) => {
    const matchesIndustry = !chosenIndustry || factory.industryLabel === chosenIndustry;
    const matchesSearch = !searchTerm || factory.searchIndex.includes(searchTerm);
    return matchesIndustry && matchesSearch;
  });

  clusterLayer.clearLayers();
  clusterLayer.addLayers(filteredFactories.map((factory) => factory.marker));

  dom.visibleCount.textContent = `${formatCount(filteredFactories.length)} на карте`;
  renderList();
}

function renderList() {
  dom.resultsList.innerHTML = "";

  if (!filteredFactories.length) {
    const empty = document.createElement("li");
    empty.className = "result-note";
    empty.textContent = "По фильтрам ничего не найдено.";
    dom.resultsList.append(empty);
    return;
  }

  for (const factory of filteredFactories.slice(0, MAX_LIST_ITEMS)) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "result-item";
    btn.innerHTML = `
      <span class="result-title">${escapeHtml(factory.name)}</span>
      <span class="result-meta">${escapeHtml(factory.city)} · ${escapeHtml(factory.industryLabel)}</span>
    `;
    btn.addEventListener("click", () => focusFactory(factory.id));
    li.append(btn);
    dom.resultsList.append(li);
  }

  if (filteredFactories.length > MAX_LIST_ITEMS) {
    const note = document.createElement("li");
    note.className = "result-note";
    note.textContent = `Показаны первые ${formatCount(MAX_LIST_ITEMS)} записей из ${formatCount(filteredFactories.length)}.`;
    dom.resultsList.append(note);
  }
}

function focusFactory(factoryId) {
  const target = allFactories.find((factory) => factory.id === factoryId);
  const marker = markerById.get(factoryId);
  if (!target || !marker) {
    return;
  }

  map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 11), {
    animate: true,
    duration: 0.5,
  });
  marker.openPopup();
}

function renderPopup(factory) {
  const website = normalizeWebsite(factory.website);
  const wikipedia = normalizeWikipedia(factory.wikipedia);

  return `
    <article>
      <h3 class="popup-title">${escapeHtml(factory.name)}</h3>
      <ul class="popup-list">
        <li><b>Город:</b> ${escapeHtml(factory.city)}</li>
        <li><b>Тип:</b> ${escapeHtml(factory.industryLabel)}</li>
        <li><b>Оператор:</b> ${escapeHtml(valueOrDash(factory.operator))}</li>
        <li><b>Продукция:</b> ${escapeHtml(valueOrDash(factory.product))}</li>
        <li><b>Основание:</b> ${escapeHtml(valueOrDash(factory.startDate))}</li>
        <li><b>Описание:</b> ${escapeHtml(valueOrDash(factory.description))}</li>
        <li><b>Сайт:</b> ${website ? `<a class="popup-link" href="${website}" target="_blank" rel="noopener noreferrer">перейти</a>` : "нет данных"}</li>
        <li><b>Wikipedia:</b> ${wikipedia ? `<a class="popup-link" href="${wikipedia}" target="_blank" rel="noopener noreferrer">открыть</a>` : "нет данных"}</li>
      </ul>
    </article>
  `;
}

function hideLoading() {
  dom.loadingOverlay.classList.add("hidden");
}

function normalize(text) {
  return cleanText(text).toLowerCase();
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function textOrFallback(value, fallback) {
  const text = cleanText(value);
  return text || fallback;
}

function valueOrDash(value) {
  return cleanText(value) || "нет данных";
}

function normalizeWebsite(raw) {
  const value = cleanText(raw);
  if (!value) {
    return "";
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `https://${value}`;
}

function normalizeWikipedia(raw) {
  const value = cleanText(raw);
  if (!value) {
    return "";
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  const [lang, ...titleParts] = value.split(":");
  if (titleParts.length === 0) {
    return "";
  }
  const title = encodeURIComponent(titleParts.join(":").replace(/ /g, "_"));
  return `https://${lang}.wikipedia.org/wiki/${title}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCount(value) {
  return Number(value).toLocaleString("ru-RU");
}

function debounce(fn, delayMs) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}
