"use strict";

const STORAGE_KEY = "gloomEnemies";
const LIBRARY_URL = "data/monsters.json";
const QUICK_DAMAGE = [1, 2, 3, 5, 10];
const STATUS_ICON_BASE = "assets/icons/";
const STATUS_ICONS = Object.freeze({
  Flying: `${STATUS_ICON_BASE}flying.svg`,
  Jump: `${STATUS_ICON_BASE}jump.svg`,
  Poison: `${STATUS_ICON_BASE}poison.svg`,
  Wound: `${STATUS_ICON_BASE}wound.svg`,
  Stun: `${STATUS_ICON_BASE}stun.svg`,
  Disarm: `${STATUS_ICON_BASE}disarm.svg`,
  Immobilize: `${STATUS_ICON_BASE}immobilize.svg`,
  Muddle: `${STATUS_ICON_BASE}muddle.svg`,
  Curse: `${STATUS_ICON_BASE}curse.svg`,
  Retaliate: `${STATUS_ICON_BASE}retaliate.svg`,
  Push: `${STATUS_ICON_BASE}push.svg`,
  Pull: `${STATUS_ICON_BASE}pull.svg`,
  Pierce: `${STATUS_ICON_BASE}pierce.svg`,
  Target: `${STATUS_ICON_BASE}target.svg`,
  Range: `${STATUS_ICON_BASE}range.svg`
});
const GROUP_STAT_ICONS = Object.freeze({
  Move: `${STATUS_ICON_BASE}move.svg`,
  Attack: `${STATUS_ICON_BASE}attack2.svg`,
  Range: `${STATUS_ICON_BASE}range.svg`
});

const state = {
  enemies: loadEnemies(),
  monsterLibrary: [],
  monsterByName: new Map(),
  nodes: new Map(),
  pendingDamage: new Map(),
  pendingDamageUndo: new Map(),
  pendingDamageTimers: new Map(),
  swipeDelete: null,
  selectedEnemyId: null,
  deleteUndo: null
};

normalizeEnemyOrdinals(state.enemies);
saveEnemies();

const elements = {
  accordion: document.getElementById("enemyFormAccordion"),
  form: document.getElementById("enemyForm"),
  name: document.getElementById("nameInput"),
  suggestions: document.getElementById("monsterSuggestions"),
  level: document.getElementById("levelInput"),
  health: document.getElementById("healthInput"),
  shield: document.getElementById("shieldInput"),
  quantity: document.getElementById("quantityInput"),
  list: document.getElementById("enemyList"),
  template: document.getElementById("enemyTemplate"),
  fullscreen: document.getElementById("fullscreenButton"),
  snackbar: document.getElementById("undoSnackbar"),
  snackbarMessage: document.getElementById("undoSnackbarMessage"),
  snackbarUndo: document.getElementById("undoSnackbarUndo")
};

const viewportState = {
  focusTimer: null
};

renderList();
loadMonsterLibrary();
syncEnemyFormAccordionState();

elements.form.addEventListener("submit", event => {
  event.preventDefault();
  addEnemies();
});

elements.accordion.addEventListener("toggle", syncEnemyFormAccordionState);
elements.accordion.querySelector(".enemy-form-toggle")?.addEventListener("click", event => {
  event.preventDefault();
  toggleEnemyFormAccordion();
});

elements.name.addEventListener("input", () => {
  renderMonsterSuggestions();
  fillStatsFromSelection();
});

elements.name.addEventListener("change", fillStatsFromSelection);

elements.name.addEventListener("keydown", handleSearchKeydown);
elements.suggestions.addEventListener("click", event => {
  const button = event.target.closest(".monster-suggestion");
  if (!button) return;
  selectMonster(button.dataset.monsterName);
});
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".monster-search")) closeMonsterSuggestions();
});

elements.level.addEventListener("change", () => {
  fillStatsFromSelection();
  renderList();
});
elements.fullscreen.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", syncViewportInsets);
window.addEventListener("resize", syncViewportInsets);
window.addEventListener("focusin", handleViewportFocusIn);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewportInsets);
  window.visualViewport.addEventListener("scroll", syncViewportInsets);
}
elements.snackbarUndo.addEventListener("pointerup", event => {
  event.preventDefault();
  event.stopPropagation();
  undoDeleteEnemy();
});
elements.snackbarUndo.addEventListener("click", undoDeleteEnemy);

function syncEnemyFormAccordionState() {
  const isOpen = Boolean(elements.accordion?.open);
  if (!isOpen) closeMonsterSuggestions();
}

function closeEnemyFormPanel() {
  collapseEnemyFormAccordion();
}

function collapseEnemyFormAccordion() {
  if (!elements.accordion) return;
  if (!elements.accordion.open) return;

  elements.accordion.classList.add("is-collapsing");
  const panel = elements.accordion.querySelector(".enemy-form-panel");
  const finishCollapse = event => {
    if (event.target !== panel || event.propertyName !== "max-height") return;
    panel.removeEventListener("transitionend", finishCollapse);
    elements.accordion.open = false;
    elements.accordion.classList.remove("is-collapsing");
    syncEnemyFormAccordionState();
  };

  panel?.addEventListener("transitionend", finishCollapse);
}

function toggleEnemyFormAccordion() {
  if (!elements.accordion) return;

  if (elements.accordion.open) {
    collapseEnemyFormAccordion();
    return;
  }

  elements.accordion.open = true;
  requestAnimationFrame(() => {
    elements.accordion.classList.remove("is-collapsing");
    syncEnemyFormAccordionState();
  });
}

function syncViewportInsets() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const keyboardInset = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0;

  const safeOffset = keyboardInset > 0 ? Math.min(keyboardInset + 24, 360) : 0;
  root.style.setProperty("--keyboard-offset", `${safeOffset}px`);

  if (safeOffset === 0 && viewportState.focusTimer) {
    clearTimeout(viewportState.focusTimer);
    viewportState.focusTimer = null;
  }
}

function handleViewportFocusIn(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.matches("input, select, textarea")) return;

  if (viewportState.focusTimer) clearTimeout(viewportState.focusTimer);
  viewportState.focusTimer = window.setTimeout(() => {
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    syncViewportInsets();
  }, 60);
}

elements.list.addEventListener("click", event => {
  const button = event.target.closest("button");
  const enemyNode = event.target.closest(".enemy");
  const enemy = enemyNode ? findEnemy(enemyNode.dataset.id) : null;

  if (button && button.classList.contains("enemy-group-toggle")) {
    const groupNode = button.closest(".enemy-group");
    if (!groupNode) return;
    toggleEnemyGroupCollapse(groupNode.dataset.groupKey);
    return;
  }

  if (enemyNode && enemy && state.swipeDelete?.suppressClickId === enemy.id) {
    state.swipeDelete.suppressClickId = null;
    return;
  }

  if (button && button.closest(".enemy")) {
    if (!enemy) return;

    if (button.classList.contains("enemy-ordinal-toggle")) {
      setEnemyElite(enemy, !enemy.elite);
      updateEnemy(enemy);
      saveEnemies();
      return;
    }

    if (button.classList.contains("heal-button")) {
      heal(enemy.id, 1);
      return;
    }

    if (button.dataset.damage) {
      addPendingDamage(enemy.id, Number(button.dataset.damage));
      return;
    }

    if (button.classList.contains("damage-build-indicator")) {
      handleDamageActionButton(enemy.id);
      return;
    }

    return;
  }

  if (enemyNode && !event.target.closest("input, select, textarea, label")) {
    toggleEnemyDetails(enemyNode.dataset.id);
  }
});

elements.list.addEventListener("keydown", event => {
  const enemyNode = event.target.closest(".enemy");
  if (!enemyNode || event.target.closest("button, input, select, textarea, label")) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleEnemyDetails(enemyNode.dataset.id);
});

elements.list.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  if (event.target.closest("button, input, select, textarea, label")) return;

  const enemyNode = event.target.closest(".enemy");
  if (!enemyNode) return;

  state.swipeDelete = {
    enemyId: enemyNode.dataset.id,
    node: enemyNode,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    suppressClickId: null
  };

  if (enemyNode.setPointerCapture) {
    try {
      enemyNode.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures on browsers that reject it for some targets.
    }
  }
});

elements.list.addEventListener("pointermove", event => {
  const swipe = state.swipeDelete;
  if (!swipe || swipe.pointerId !== event.pointerId) return;

  const dx = event.clientX - swipe.startX;
  const dy = event.clientY - swipe.startY;
  const node = swipe.node;
  const width = Math.max(1, node.getBoundingClientRect().width);
  const threshold = Math.max(88, width * 0.28);

  if (!swipe.active) {
    if (dx <= 10 || Math.abs(dx) <= Math.abs(dy)) return;
    swipe.active = true;
    node.classList.add("swipe-delete-active");
  }

  const translateX = Math.min(Math.max(0, dx), width * 0.45);
  node.style.transform = `translate3d(${translateX}px, 0, 0)`;
  node.dataset.swipeThreshold = String(threshold);
});

elements.list.addEventListener("pointerup", event => {
  const swipe = state.swipeDelete;
  if (swipe && swipe.pointerId === event.pointerId) {
    const node = swipe.node;
    const dx = event.clientX - swipe.startX;
    const threshold = Number(node.dataset.swipeThreshold || Math.max(88, node.getBoundingClientRect().width * 0.28));
    const shouldDelete = swipe.active && dx >= threshold;

    node.classList.remove("swipe-delete-active");
    node.style.transform = "";
    delete node.dataset.swipeThreshold;

    if (shouldDelete) {
      swipe.suppressClickId = swipe.enemyId;
      state.swipeDelete = swipe;
      deleteEnemy(swipe.enemyId);
    } else if (swipe.active) {
      swipe.suppressClickId = swipe.enemyId;
      state.swipeDelete = swipe;
    }

    if (node.releasePointerCapture) {
      try {
        node.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures for detached nodes.
      }
    }

    if (!shouldDelete && !swipe.active) {
      state.swipeDelete = null;
    }
  }
});

elements.list.addEventListener("pointercancel", event => {
  const swipe = state.swipeDelete;
  if (swipe && swipe.pointerId === event.pointerId) {
    const node = swipe.node;
    node.classList.remove("swipe-delete-active");
    node.style.transform = "";
    delete node.dataset.swipeThreshold;
    if (node.releasePointerCapture) {
      try {
        node.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures for detached nodes.
      }
    }
    state.swipeDelete = null;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}

async function loadMonsterLibrary() {
  try {
    const response = await fetch(LIBRARY_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    state.monsterLibrary = Array.isArray(data.monsters) ? data.monsters : [];
    state.monsterByName = new Map(state.monsterLibrary.map(monster => [normalizeName(monster.name), monster]));
    renderMonsterSuggestions();
    fillStatsFromSelection();
  } catch (error) {
    console.warn("No se pudo cargar la biblioteca de monstruos.", error);
  }
}

function renderMonsterSuggestions() {
  const query = normalizeName(elements.name.value);
  if (!query || state.monsterLibrary.length === 0) {
    closeMonsterSuggestions();
    return;
  }

  const matches = state.monsterLibrary
    .filter(monster => normalizeName(monster.name).includes(query))
    .slice(0, 8);

  if (matches.length === 0) {
    closeMonsterSuggestions();
    return;
  }

  elements.suggestions.replaceChildren(...matches.map((monster, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "monster-suggestion";
    button.dataset.monsterName = monster.name;
    button.id = `monster-suggestion-${index}`;
    button.setAttribute("role", "option");
    button.textContent = monster.name;
    return button;
  }));

  elements.suggestions.classList.add("open");
  elements.name.setAttribute("aria-expanded", "true");
  elements.name.removeAttribute("aria-activedescendant");
}

function closeMonsterSuggestions() {
  elements.suggestions.classList.remove("open");
  elements.name.setAttribute("aria-expanded", "false");
  elements.name.removeAttribute("aria-activedescendant");
}

function selectMonster(monsterName) {
  elements.name.value = monsterName;
  closeMonsterSuggestions();
  fillStatsFromSelection();
}

function handleSearchKeydown(event) {
  if (event.key === "Escape") {
    closeMonsterSuggestions();
    return;
  }

  if (event.key !== "Enter") return;

  const firstSuggestion = elements.suggestions.querySelector(".monster-suggestion");
  const exactMatch = getSelectedMonster();
  if (!exactMatch && firstSuggestion) {
    event.preventDefault();
    selectMonster(firstSuggestion.dataset.monsterName);
  }
}

function fillStatsFromSelection() {
  const monster = getSelectedMonster();
  const stats = monster ? getMonsterStats(monster, false) : null;
  if (!stats || !Number.isFinite(Number(stats.health))) return;

  elements.health.value = stats.health;
  elements.shield.value = stats.shield || 0;
}

function getSelectedMonster() {
  return state.monsterByName.get(normalizeName(elements.name.value));
}

function getMonsterStats(monster, elite = false) {
  const level = elements.level.value;
  const rank = elite ? "elite" : "normal";
  return monster?.levels?.[level]?.[rank] || null;
}

function loadEnemies() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEnemy);
  } catch {
    return [];
  }
}

function normalizeEnemy(enemy, index) {
  const max = toInt(enemy.max, toInt(enemy.vida, 1));
  const storedGroupOrdinal = toInt(enemy.groupOrdinal, NaN);
  return {
    id: enemy.id || `enemy-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    nombre: String(enemy.nombre || "Enemigo"),
    groupName: String(enemy.groupName || stripEnemySuffix(enemy.nombre) || enemy.nombre || "Enemigo"),
    vida: clamp(toInt(enemy.vida, max), 0, max),
    max,
    escudo: Math.max(0, toInt(enemy.escudo, 0)),
    elite: Boolean(enemy.elite),
    ordinal: Number.isFinite(storedGroupOrdinal) ? Math.max(1, storedGroupOrdinal) : Math.max(1, toInt(enemy.ordinal, index + 1)),
    groupOrdinal: Number.isFinite(storedGroupOrdinal) ? Math.max(1, storedGroupOrdinal) : null,
    groupCollapsed: Boolean(enemy.groupCollapsed),
    level: enemy.level ?? null,
    monsterId: enemy.monsterId || null,
    libraryStats: enemy.libraryStats && typeof enemy.libraryStats === "object" ? enemy.libraryStats : null
  };
}

function saveEnemies() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.enemies));
}

function getEnemyIndex(enemyId) {
  return state.enemies.findIndex(enemy => enemy.id === enemyId);
}

function clearSelectedEnemyIfNeeded(enemyId) {
  if (state.selectedEnemyId === enemyId) state.selectedEnemyId = null;
}

function commitEnemyChange(enemy) {
  if (!enemy) return;
  updateEnemy(enemy);
  saveEnemies();
}

function ensureEnemyNodeStructure(node) {
  const top = node.querySelector(".enemy-top");
  if (top && !top.querySelector(".enemy-top-left")) {
    const ordinal = top.querySelector(".enemy-ordinal");
    const health = top.querySelector(".health-stat");
    const shield = top.querySelector(".shield-stat");

    const left = document.createElement("div");
    left.className = "enemy-top-left";
    if (ordinal) left.appendChild(ordinal);
    if (health) left.appendChild(health);

    const right = document.createElement("div");
    right.className = "enemy-top-right";
    if (shield) right.appendChild(shield);

    top.insertBefore(left, top.firstChild);
    top.appendChild(right);
  }

  const quickActions = node.querySelector(".quick-actions");
  if (quickActions && !quickActions.querySelector(".damage-build-indicator")) {
    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.className = "damage-build-indicator";
    indicator.hidden = true;
    indicator.setAttribute("aria-label", "Resolver golpe acumulado");
    quickActions.insertBefore(indicator, quickActions.querySelector(".heal-button"));
  }
}

function updateDamageBuildIndicator(enemyId) {
  const node = state.nodes.get(enemyId);
  if (!node) return;

  const indicator = node.querySelector(".damage-build-indicator");
  if (!indicator) return;

  const buildDamage = Math.max(0, toInt(state.pendingDamage.get(enemyId) || 0, 0));
  const undoState = state.pendingDamageUndo.get(enemyId) || null;

  if (buildDamage > 0) {
    indicator.hidden = false;
    indicator.dataset.mode = "build";
    indicator.classList.remove("is-undo");
    indicator.setAttribute("aria-label", `Resolver golpe acumulado: ${buildDamage}`);
    indicator.replaceChildren(createDamageIndicatorIcon("bane2.svg"), createDamageIndicatorValue(String(buildDamage)));
    return;
  }

  if (undoState) {
    indicator.hidden = false;
    indicator.dataset.mode = "undo";
    indicator.classList.add("is-undo");
    indicator.setAttribute("aria-label", "Deshacer daño");
    indicator.replaceChildren(createDamageIndicatorIcon("jump2.svg"));
    return;
  }

  indicator.hidden = false;
  indicator.dataset.mode = "";
  indicator.classList.remove("is-undo");
  indicator.setAttribute("aria-label", "Resolver golpe acumulado");
  indicator.replaceChildren(createDamageIndicatorIcon("bane2.svg"), createDamageIndicatorValue("0"));
}

function createDamageIndicatorIcon(filename) {
  const icon = document.createElement("img");
  icon.className = "damage-build-indicator-icon";
  icon.src = `${STATUS_ICON_BASE}${filename}`;
  icon.alt = "";
  icon.decoding = "async";
  icon.loading = "lazy";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function createDamageIndicatorValue(value) {
  const span = document.createElement("span");
  span.className = "damage-build-indicator-value";
  span.textContent = value;
  return span;
}

function schedulePendingDamageTimer(enemyId, delay, callback) {
  clearPendingDamageTimer(enemyId);
  const timer = window.setTimeout(() => {
    if (state.pendingDamageTimers.get(enemyId) !== timer) return;
    state.pendingDamageTimers.delete(enemyId);
    callback();
  }, delay);
  state.pendingDamageTimers.set(enemyId, timer);
}

function clearPendingDamageTimer(enemyId) {
  const timer = state.pendingDamageTimers.get(enemyId);
  if (timer) {
    clearTimeout(timer);
    state.pendingDamageTimers.delete(enemyId);
  }
}

function clearPendingDamage(enemyId) {
  clearPendingDamageTimer(enemyId);
  state.pendingDamage.delete(enemyId);
  state.pendingDamageUndo.delete(enemyId);
  updateDamageBuildIndicator(enemyId);
}

function addEnemies() {
  const baseName = elements.name.value.trim();
  const health = toInt(elements.health.value, NaN);
  const shield = Math.max(0, toInt(elements.shield.value, 0));
  const quantity = clamp(toInt(elements.quantity.value, 1), 1, 99);
  const selectedMonster = getSelectedMonster();
  const selectedStats = selectedMonster ? getMonsterStats(selectedMonster, false) : null;
  const selectedEliteStats = selectedMonster ? getMonsterStats(selectedMonster, true) : null;

  if (!baseName || !Number.isFinite(health) || health <= 0) return;

  const nextNumbers = getNextEnemyNumbers(baseName, quantity);
  const newEnemies = nextNumbers.map(number => ({
    id: `enemy-${Date.now()}-${number}-${Math.random().toString(36).slice(2)}`,
    nombre: quantity > 1 || hasNumberedEnemy(baseName) ? `${baseName} ${number}` : baseName,
    groupName: baseName,
    vida: health,
    max: health,
    escudo: shield,
    elite: false,
    ordinal: number,
    groupOrdinal: number,
    groupCollapsed: false,
    level: elements.level.value,
    monsterId: selectedMonster?.id || null,
    libraryStats: selectedStats || selectedEliteStats ? {
      normal: selectedStats ? { ...selectedStats } : null,
      elite: selectedEliteStats ? { ...selectedEliteStats } : null
    } : null
  }));

  state.enemies.push(...newEnemies);
  elements.quantity.value = "1";
  closeMonsterSuggestions();
  closeEnemyFormPanel();
  renderList();
  saveEnemies();
}

function getNextEnemyNumbers(baseName, quantity) {
  const used = new Set();
  const escapedName = escapeRegExp(baseName);
  const numberedName = new RegExp(`^${escapedName}\\s+(\\d+)$`, "i");

  state.enemies.forEach(enemy => {
    if (normalizeName(getEnemyGroupName(enemy)) !== normalizeName(baseName)) return;
    const match = String(enemy.nombre).match(numberedName);
    if (match) {
      used.add(Number(match[1]));
      return;
    }
    const number = toInt(enemy.groupOrdinal ?? enemy.ordinal, NaN);
    if (Number.isFinite(number)) used.add(number);
  });

  const numbers = [];
  let candidate = 1;
  while (numbers.length < quantity) {
    if (!used.has(candidate)) numbers.push(candidate);
    candidate += 1;
  }
  return numbers;
}

function hasNumberedEnemy(baseName) {
  const numberedName = new RegExp(`^${escapeRegExp(baseName)}\\s+\\d+$`, "i");
  return state.enemies.some(enemy => numberedName.test(String(enemy.nombre)));
}

function addPendingDamage(enemyId, rawDamage) {
  const enemy = findEnemy(enemyId);
  if (!enemy) return;

  const nextDamage = Math.max(0, (state.pendingDamage.get(enemyId) || 0) + Math.max(0, rawDamage));
  state.pendingDamage.set(enemyId, nextDamage);
  if (state.pendingDamageUndo.has(enemyId)) {
    clearPendingDamageTimer(enemyId);
    state.pendingDamageUndo.delete(enemyId);
  }

  updateDamageBuildIndicator(enemyId);
  schedulePendingDamageTimer(enemyId, 2000, () => discardPendingDamage(enemyId));
}

function resolvePendingDamage(enemyId) {
  const enemy = findEnemy(enemyId);
  if (!enemy) return;

  const rawDamage = state.pendingDamage.get(enemyId) || 0;
  if (rawDamage <= 0) return;

  clearPendingDamageTimer(enemyId);
  const previousHealth = enemy.vida;
  const effectiveDamage = Math.max(0, rawDamage - enemy.escudo);
  enemy.vida = Math.max(0, enemy.vida - effectiveDamage);
  state.pendingDamage.delete(enemyId);
  state.pendingDamageUndo.set(enemyId, { previousHealth, damage: rawDamage });
  updateDamageBuildIndicator(enemyId);
  commitEnemyChange(enemy);
  schedulePendingDamageTimer(enemyId, 2000, () => discardResolvedDamage(enemyId));
}

function discardPendingDamage(enemyId) {
  if (!state.pendingDamage.has(enemyId)) return;
  clearPendingDamageTimer(enemyId);
  state.pendingDamage.delete(enemyId);
  updateDamageBuildIndicator(enemyId);
}

function discardResolvedDamage(enemyId) {
  if (!state.pendingDamageUndo.has(enemyId)) return;
  clearPendingDamageTimer(enemyId);
  state.pendingDamageUndo.delete(enemyId);
  updateDamageBuildIndicator(enemyId);
}

function handleDamageActionButton(enemyId) {
  if (state.pendingDamageUndo.has(enemyId)) {
    undoResolvedDamage(enemyId);
    return;
  }

  if (state.pendingDamage.has(enemyId)) {
    resolvePendingDamage(enemyId);
  }
}

function undoResolvedDamage(enemyId) {
  const enemy = findEnemy(enemyId);
  const pending = state.pendingDamageUndo.get(enemyId);
  if (!enemy || !pending) return;

  clearPendingDamageTimer(enemyId);
  enemy.vida = clamp(toInt(pending.previousHealth, enemy.vida), 0, enemy.max);
  state.pendingDamageUndo.delete(enemyId);
  updateDamageBuildIndicator(enemyId);
  commitEnemyChange(enemy);
}

function heal(enemyId, amount) {
  const enemy = findEnemy(enemyId);
  if (!enemy) return;

  enemy.vida = Math.min(enemy.max, enemy.vida + amount);
  commitEnemyChange(enemy);
}

function deleteEnemy(enemyId) {
  const index = getEnemyIndex(enemyId);
  const enemy = index >= 0 ? state.enemies[index] : null;
  if (!enemy) return;

  clearSelectedEnemyIfNeeded(enemyId);
  clearPendingDamage(enemyId);
  hideDeleteUndoSnackbar();
  const snapshot = cloneEnemy(enemy);
  state.enemies.splice(index, 1);
  renderList();
  saveEnemies();
  showDeleteUndoSnackbar(snapshot, index);
}

function renderList() {
  const seenIds = new Set();
  const groups = new Map();
  const groupOrder = [];

  state.enemies.forEach(enemy => {
    const groupKey = getEnemyGroupKey(enemy);
    let group = groups.get(groupKey);
    if (!group) {
      group = createEnemyGroupNode(getEnemyGroupTitle(enemy), groupKey, isGroupCollapsed(groupKey));
      group.count = 0;
      group.sourceEnemy = enemy;
      groups.set(groupKey, group);
      groupOrder.push(group.node);
    }
    group.count += 1;

    let node = state.nodes.get(enemy.id);
    if (!node) {
      node = createEnemyNode(enemy.id);
      state.nodes.set(enemy.id, node);
    }

    updateEnemy(enemy);
    if (!group.collapsed) group.rows.appendChild(node);
    seenIds.add(enemy.id);
  });

  for (const group of groups.values()) {
    group.header.querySelector(".enemy-group-indicator").textContent = group.collapsed ? "\u25ba" : "\u25bc";
    group.header.querySelector(".enemy-group-title-text").textContent = group.title;
    renderMonsterHeaderStats(group.statsNode, group.sourceEnemy);
    group.rows.hidden = group.collapsed;
  }

  elements.list.replaceChildren(...groupOrder);

  for (const [id, node] of state.nodes) {
    if (seenIds.has(id)) continue;
    node.remove();
    state.nodes.delete(id);
    clearPendingDamage(id);
  }
}

function createEnemyNode(enemyId) {
  const node = elements.template.content.firstElementChild.cloneNode(true);
  node.dataset.id = enemyId;
  node.querySelectorAll(".quick-actions button[data-damage]").forEach((button, index) => {
    button.dataset.damage = QUICK_DAMAGE[index];
  });
  ensureEnemyNodeStructure(node);
  return node;
}

function updateEnemy(enemy) {
  const node = state.nodes.get(enemy.id);
  if (!node) return;

  const eliteToggle = node.querySelector(".enemy-ordinal-toggle");
  const body = node.querySelector(".enemy-body");
  const healthClass = getHealthClass(enemy.vida, enemy.max);
  const attributesNode = node.querySelector(".monster-attributes");
  const isExpanded = state.selectedEnemyId === enemy.id;
  node.classList.toggle("dead", enemy.vida <= 0);
  node.classList.toggle("expanded", isExpanded);
  node.querySelector(".enemy-ordinal").textContent = getOrdinalLabel(enemy.ordinal);
  node.querySelector(".enemy-ordinal").classList.toggle("elite", enemy.elite);
  if (eliteToggle) {
    eliteToggle.setAttribute("aria-pressed", enemy.elite ? "true" : "false");
    eliteToggle.setAttribute("aria-label", enemy.elite ? "Marcar como normal" : "Marcar como ?lite");
    eliteToggle.title = enemy.elite ? "Marcar como normal" : "Marcar como ?lite";
  }
  node.querySelector(".health-value").textContent = String(Math.max(0, enemy.vida));
  node.querySelector(".health-value").className = "health-value " + healthClass;
  renderMonsterAttributes(attributesNode, enemy);
  node.querySelector(".shield-value").textContent = String(enemy.escudo);
  updateDamageBuildIndicator(enemy.id);
  syncEnemyBodyState(body, isExpanded);
  node.setAttribute("aria-expanded", isExpanded ? "true" : "false");
}

function toggleEnemyDetails(enemyId) {
  state.selectedEnemyId = state.selectedEnemyId === enemyId ? null : enemyId;
  for (const enemy of state.enemies) updateEnemy(enemy);
}

function syncEnemyBodyState(body, isExpanded) {
  if (!body) return;

  if (body._hideTimer) {
    window.clearTimeout(body._hideTimer);
    body._hideTimer = null;
  }

  if (isExpanded) {
    body.hidden = false;
    requestAnimationFrame(() => {
      if (!body.hidden) body.classList.add("is-open");
    });
    return;
  }

  const wasOpen = body.classList.contains("is-open") || !body.hidden;
  body.classList.remove("is-open");
  if (!wasOpen) {
    body.hidden = true;
    return;
  }

  body._hideTimer = window.setTimeout(() => {
    body.hidden = true;
    body._hideTimer = null;
  }, 220);
}

function getHealthClass(current, max) {
  if (current <= 0) return "health-dead";
  const percent = current / Math.max(1, max);
  if (percent > .6) return "health-high";
  if (percent > .3) return "health-mid";
  return "health-low";
}

function findEnemy(enemyId) {
  return state.enemies.find(enemy => enemy.id === enemyId);
}

function createEnemyGroupNode(title, groupKey, collapsed) {
  const node = document.createElement("article");
  node.className = "enemy-group";
  node.dataset.groupKey = groupKey;
  const header = document.createElement("button");
  header.type = "button";
  header.className = "enemy-group-title enemy-group-toggle";
  header.innerHTML = `
    <span class="enemy-group-indicator" aria-hidden="true"></span>
    <span class="enemy-group-title-text"></span>
    <span class="enemy-group-stats" aria-hidden="true"></span>
  `;
  header.querySelector(".enemy-group-indicator").textContent = collapsed ? "\u25ba" : "\u25bc";
  header.querySelector(".enemy-group-title-text").textContent = title;
  const statsNode = header.querySelector(".enemy-group-stats");

  const rows = document.createElement("div");
  rows.className = "enemy-group-list";

  node.append(header, rows);
  return { node, rows, header, statsNode, title, collapsed, sourceEnemy: null };
}

function renderMonsterHeaderStats(target, enemy) {
  if (!target) return;

  const normalStats = getMonsterStatsForCurrentLevel(enemy, false);
  const eliteStats = getMonsterStatsForCurrentLevel(enemy, true);
  if (!normalStats && !eliteStats) {
    target.replaceChildren();
    target.hidden = true;
    return;
  }
  const fragments = [];

  fragments.push(buildMonsterStatChip("Move", GROUP_STAT_ICONS.Move, normalStats?.move, eliteStats?.move));
  fragments.push(buildMonsterStatChip("Attack", GROUP_STAT_ICONS.Attack, normalStats?.attack, eliteStats?.attack));
  fragments.push(buildMonsterStatChip("Range", GROUP_STAT_ICONS.Range, normalStats?.range, eliteStats?.range));

  target.replaceChildren(...fragments);
  target.hidden = fragments.length === 0;
}

function buildMonsterStatChip(label, icon, normalValue, eliteValue) {
  const chip = document.createElement("span");
  chip.className = "enemy-group-stat";

  const values = document.createElement("span");
  values.className = "enemy-group-stat-values";

  const normal = document.createElement("span");
  normal.className = "enemy-group-stat-value enemy-group-stat-value--normal";
  normal.textContent = formatMonsterStatValue(normalValue);

  const separatorIcon = document.createElement("img");
  separatorIcon.className = "enemy-group-stat-icon";
  separatorIcon.src = icon;
  separatorIcon.alt = "";
  separatorIcon.decoding = "async";
  separatorIcon.loading = "lazy";
  separatorIcon.setAttribute("aria-hidden", "true");

  const elite = document.createElement("span");
  elite.className = "enemy-group-stat-value enemy-group-stat-value--elite";
  elite.textContent = formatMonsterStatValue(eliteValue);

  values.append(normal, separatorIcon, elite);
  chip.append(values);
  chip.title = label + " Normal " + formatMonsterStatValue(normalValue) + " / Elite " + formatMonsterStatValue(eliteValue);
  return chip;
}

function formatMonsterStatValue(value) {
  return value === null || value === undefined ? "–" : String(value);
}

function setEnemyElite(enemy, elite) {
  const stats = getMonsterStatsForEnemy(enemy, elite);
  const previousMax = Math.max(1, toInt(enemy.max, 1));
  const currentHealth = clamp(toInt(enemy.vida, previousMax), 0, previousMax);
  const damageTaken = Math.max(0, previousMax - currentHealth);

  enemy.elite = Boolean(elite);

  if (!stats) return;

  const nextMax = Math.max(1, toInt(stats.health, previousMax));
  enemy.max = nextMax;
  enemy.escudo = Math.max(0, toInt(stats.shield, 0));
  enemy.vida = clamp(nextMax - damageTaken, 0, nextMax);
}

function getMonsterStatsForEnemy(enemy, elite = enemy?.elite) {
  const storedStats = getStoredMonsterStats(enemy, elite);
  if (storedStats) return storedStats;

  const monster = getMonsterForEnemy(enemy);
  if (!monster) return null;

  const level = String(enemy.level ?? "0");
  const rank = elite ? "elite" : "normal";
  return monster?.levels?.[level]?.[rank] || null;
}

function getMonsterStatsForCurrentLevel(enemy, elite = false) {
  const monster = getMonsterForEnemy(enemy);
  if (monster) {
    const level = String(elements.level.value ?? "0");
    const rank = elite ? "elite" : "normal";
    const stats = monster?.levels?.[level]?.[rank];
    if (stats) return stats;
  }

  return getStoredMonsterStats(enemy, elite);
}

function getStoredMonsterStats(enemy, elite) {
  const stats = enemy?.libraryStats;
  if (!stats || typeof stats !== "object") return null;

  if ("normal" in stats || "elite" in stats) {
    const storedStats = elite ? stats.elite : stats.normal;
    return storedStats && typeof storedStats === "object" ? storedStats : null;
  }

  return Number.isFinite(Number(stats.health)) ? stats : null;
}

function renderMonsterAttributes(target, enemy) {
  if (!target) return;

  const stats = getMonsterStatsForEnemy(enemy, enemy.elite);
  const attributes = Array.isArray(stats?.attributes) ? stats.attributes : [];
  const fragments = [];

  for (const attribute of attributes) {
    for (const parsed of parseMonsterAttributes(attribute)) {
      const iconSrc = STATUS_ICONS[parsed.name];
      if (!iconSrc) continue;

      const span = document.createElement("span");
      span.className = "monster-attribute";

      const image = document.createElement("img");
      image.className = "monster-attribute-icon";
      image.src = iconSrc;
      image.alt = "";
      image.decoding = "async";
      image.loading = "lazy";
      image.setAttribute("aria-hidden", "true");
      span.appendChild(image);

      if (parsed.value) {
        const value = document.createElement("span");
        value.className = "monster-attribute-value";
        value.textContent = parsed.value;
        span.appendChild(value);
      }

      fragments.push(span);
    }
  }

  target.replaceChildren(...fragments);
  target.hidden = fragments.length === 0;
}

function parseMonsterAttributes(attribute) {
  const value = String(attribute || "").trim();
  if (!value) return [];

  return value
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const match = item.match(/^([A-Za-z]+)(?:\s+(\d+))?$/);
      if (match) return { name: match[1], value: match[2] || "" };

      const spaceIndex = item.indexOf(" ");
      if (spaceIndex < 0) return { name: item, value: "" };
      return { name: item.slice(0, spaceIndex), value: item.slice(spaceIndex + 1).trim() };
    });
}

function getMonsterForEnemy(enemy) {
  if (!enemy) return null;

  if (enemy.monsterId) {
    const byId = state.monsterLibrary.find(monster => monster.id === enemy.monsterId);
    if (byId) return byId;
  }

  const baseName = stripEnemySuffix(enemy.nombre);
  if (!baseName) return null;

  return state.monsterByName.get(normalizeName(baseName)) || null;
}

function normalizeName(name) {
  return String(name).trim().toLocaleLowerCase("es");
}

function getEnemyGroupName(enemy) {
  return String(enemy?.groupName || stripEnemySuffix(enemy?.nombre) || enemy?.nombre || "Enemigo").trim();
}

function getEnemyGroupKey(enemy) {
  return normalizeName(getEnemyGroupName(enemy));
}

function getEnemyGroupTitle(enemy) {
  return getEnemyGroupName(enemy);
}

function isGroupCollapsed(groupKey) {
  return state.enemies.some(enemy => getEnemyGroupKey(enemy) === groupKey && Boolean(enemy.groupCollapsed));
}

function setGroupCollapsed(groupKey, collapsed) {
  state.enemies.forEach(enemy => {
    if (getEnemyGroupKey(enemy) === groupKey) enemy.groupCollapsed = Boolean(collapsed);
  });
}

function toggleEnemyGroupCollapse(groupKey) {
  const nextCollapsed = !isGroupCollapsed(groupKey);
  setGroupCollapsed(groupKey, nextCollapsed);
  renderList();
  saveEnemies();
}

function getOrdinalLabel(ordinal) {
  return toCircledNumber(ordinal);
}

function normalizeEnemyOrdinals(enemies) {
  const nextByGroup = new Map();

  enemies.forEach(enemy => {
    const groupKey = getEnemyGroupKey(enemy);
    const current = nextByGroup.get(groupKey) || 0;
    const ordinal = Number.isFinite(toInt(enemy.groupOrdinal, NaN))
      ? Math.max(1, toInt(enemy.groupOrdinal, 1))
      : current + 1;
    enemy.groupOrdinal = ordinal;
    enemy.ordinal = ordinal;
    nextByGroup.set(groupKey, ordinal);
  });
}

function toCircledNumber(value) {
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
  const number = Math.max(1, toInt(value, 1));
  return circled[number - 1] || String(number);
}

function stripEnemySuffix(name) {
  return String(name).replace(/\s+\d+$/, "").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function showDeleteUndoSnackbar(enemySnapshot, index) {
  if (!enemySnapshot) return;

  state.deleteUndo = {
    enemy: enemySnapshot,
    index,
    timer: window.setTimeout(() => {
      if (state.deleteUndo?.enemy?.id !== enemySnapshot.id) return;
      hideDeleteUndoSnackbar();
    }, 3000)
  };
  renderDeleteUndoSnackbar(enemySnapshot);
}

function undoDeleteEnemy() {
  const pending = state.deleteUndo;
  if (!pending) return;

  clearTimeout(pending.timer);
  const index = clamp(pending.index, 0, state.enemies.length);
  state.enemies.splice(index, 0, cloneEnemy(pending.enemy));
  hideDeleteUndoSnackbar();
  renderList();
  saveEnemies();
}

function hideDeleteUndoSnackbar() {
  clearDeleteUndoTimer();
  state.deleteUndo = null;
  clearDeleteUndoSnackbar();
}

function cloneEnemy(enemy) {
  if (typeof structuredClone === "function") {
    return structuredClone(enemy);
  }
  return JSON.parse(JSON.stringify(enemy));
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
    syncViewportInsets();
  } catch {
    console.warn("No se pudo activar la pantalla completa.");
  }
}

function renderDeleteUndoSnackbar(enemySnapshot) {
  elements.snackbarMessage.textContent = `${enemySnapshot.nombre} eliminado`;
  elements.snackbarUndo.dataset.id = enemySnapshot.id;
  elements.snackbar.classList.add("visible");
}

function clearDeleteUndoTimer() {
  if (state.deleteUndo?.timer) {
    clearTimeout(state.deleteUndo.timer);
  }
}

function clearDeleteUndoSnackbar() {
  elements.snackbar.classList.remove("visible");
  elements.snackbarUndo.dataset.id = "";
  elements.snackbarMessage.textContent = "";
}



