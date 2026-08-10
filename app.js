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
  monsterLibraryLoading: null,
  monsterByName: new Map(),
  scenarioCatalog: [],
  scenarioCatalogLoading: null,
  nodes: new Map(),
  pendingDamage: new Map(),
  pendingDamageUndo: new Map(),
  pendingDamageTimers: new Map(),
  swipeDelete: null,
  gesture: null,
  clickSuppression: null,
  clickSuppressionTimer: null,
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
  addScenarioButton: document.getElementById("addScenarioButton"),
  scenarioModal: document.getElementById("scenarioModal"),
  scenarioModalClose: document.getElementById("scenarioModalClose"),
  scenarioModalCancel: document.getElementById("scenarioModalCancel"),
  scenarioForm: document.getElementById("scenarioForm"),
  scenarioSelect: document.getElementById("scenarioSelect"),
  scenarioLevel: document.getElementById("scenarioLevelSelect"),
  scenarioPlayers: document.getElementById("scenarioPlayersSelect"),
  scenarioConfirm: document.getElementById("scenarioModalConfirm"),
  snackbar: document.getElementById("undoSnackbar"),
  snackbarMessage: document.getElementById("undoSnackbarMessage"),
  snackbarUndo: document.getElementById("undoSnackbarUndo")
};

const viewportState = {
  focusTimer: null
};

renderList();
loadMonsterLibrary();
loadScenarioCatalog();
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
elements.addScenarioButton.addEventListener("click", openScenarioModal);
elements.scenarioModalClose.addEventListener("click", closeScenarioModal);
elements.scenarioModalCancel.addEventListener("click", closeScenarioModal);
elements.scenarioModal.addEventListener("click", event => {
  if (event.target.closest("[data-scenario-modal-close]")) closeScenarioModal();
});
elements.scenarioForm.addEventListener("submit", event => {
  event.preventDefault();
  importSelectedScenario();
});
document.addEventListener("fullscreenchange", syncViewportInsets);
window.addEventListener("resize", syncViewportInsets);
window.addEventListener("focusin", handleViewportFocusIn);
window.addEventListener("keydown", handleGlobalKeydown);
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

  closeMonsterSuggestions();
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

function getListInteractionDescriptor(event) {
  const groupHeader = event.target.closest(".enemy-group-title");
  if (groupHeader) {
    const groupNode = groupHeader.closest(".enemy-group");
    if (!groupNode) return null;
    return {
      kind: "group",
      node: groupNode,
      id: groupNode.dataset.groupKey,
      groupKind: groupNode.dataset.groupKind || "type",
      swipeable: groupNode.dataset.groupKind === "room"
    };
  }

  const enemyNode = event.target.closest(".enemy");
  if (!enemyNode) return null;
  if (event.target.closest("button, input, select, textarea, label")) return null;

  return {
    kind: "enemy",
    node: enemyNode,
    id: enemyNode.dataset.id,
    swipeable: true
  };
}

function setClickSuppression(kind, id) {
  state.clickSuppression = { kind, id };
  if (state.clickSuppressionTimer) clearTimeout(state.clickSuppressionTimer);
  state.clickSuppressionTimer = window.setTimeout(() => {
    clearClickSuppression();
  }, 450);
}

function clearClickSuppression() {
  if (state.clickSuppressionTimer) {
    clearTimeout(state.clickSuppressionTimer);
    state.clickSuppressionTimer = null;
  }
  state.clickSuppression = null;
}

function startListGesture(event, descriptor) {
  if (state.gesture) return;

  const rect = descriptor.node.getBoundingClientRect();
  const gesture = {
    pointerId: event.pointerId,
    descriptor,
    node: descriptor.node,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    mode: "pending",
    pressTimer: null,
    threshold: Math.max(88, rect.width * 0.28),
    placeholder: null,
    parent: null,
    startRect: rect
  };

  state.gesture = gesture;

  if (descriptor.node.setPointerCapture) {
    try {
      descriptor.node.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures for nodes that do not support it.
    }
  }

  gesture.pressTimer = window.setTimeout(() => {
    if (state.gesture !== gesture || gesture.mode !== "pending") return;
    beginListDrag(gesture);
  }, 250);
}

function updateListGesture(event) {
  const gesture = state.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;

  gesture.currentX = event.clientX;
  gesture.currentY = event.clientY;

  if (gesture.mode === "pending") {
    const dx = gesture.currentX - gesture.startX;
    const dy = gesture.currentY - gesture.startY;
    if (gesture.descriptor.swipeable && dx > 10 && Math.abs(dx) > Math.abs(dy)) {
      beginListSwipe(gesture);
      updateListGesture(event);
    }
    return;
  }

  if (gesture.mode === "swipe") {
    const dx = gesture.currentX - gesture.startX;
    const width = Math.max(1, gesture.node.getBoundingClientRect().width);
    const translateX = Math.min(Math.max(0, dx), width * 0.45);
    gesture.node.style.transform = `translate3d(${translateX}px, 0, 0)`;
    gesture.threshold = Math.max(88, width * 0.28);
    event.preventDefault();
    return;
  }

  if (gesture.mode === "drag") {
    gesture.node.style.transform = `translate3d(${gesture.currentX - gesture.startX}px, ${gesture.currentY - gesture.startY}px, 0)`;
    moveDragPlaceholder(gesture);
    event.preventDefault();
  }
}

function beginListSwipe(gesture) {
  if (gesture.mode !== "pending") return;

  clearTimeout(gesture.pressTimer);
  gesture.pressTimer = null;
  gesture.mode = "swipe";
  gesture.node.classList.add("swipe-delete-active");
}

function beginListDrag(gesture) {
  if (gesture.mode !== "pending") return;

  clearTimeout(gesture.pressTimer);
  gesture.pressTimer = null;
  gesture.mode = "drag";
  gesture.parent = gesture.node.parentElement;
  if (!gesture.parent) {
    gesture.mode = "pending";
    return;
  }

  const rect = gesture.node.getBoundingClientRect();
  gesture.startRect = rect;
  gesture.placeholder = document.createElement("div");
  gesture.placeholder.className = "drag-placeholder";
  gesture.placeholder.style.height = `${rect.height}px`;
  gesture.placeholder.style.width = `${rect.width}px`;

  gesture.parent.insertBefore(gesture.placeholder, gesture.node);
  document.body.appendChild(gesture.node);
  gesture.node.classList.add("is-dragging");
  gesture.node.style.position = "fixed";
  gesture.node.style.left = `${rect.left}px`;
  gesture.node.style.top = `${rect.top}px`;
  gesture.node.style.width = `${rect.width}px`;
  gesture.node.style.height = `${rect.height}px`;
  gesture.node.style.margin = "0";
  gesture.node.style.zIndex = "1000";
  gesture.node.style.pointerEvents = "none";
  gesture.node.style.touchAction = "none";
  gesture.node.style.transform = `translate3d(${gesture.currentX - gesture.startX}px, ${gesture.currentY - gesture.startY}px, 0)`;
  moveDragPlaceholder(gesture);
}

function moveDragPlaceholder(gesture) {
  if (!gesture.placeholder || !gesture.parent) return;

  const children = Array.from(gesture.parent.children).filter(child => child !== gesture.placeholder);
  let before = null;

  for (const child of children) {
    const rect = child.getBoundingClientRect();
    if (gesture.currentY < rect.top + rect.height / 2) {
      before = child;
      break;
    }
  }

  if (before) {
    gesture.parent.insertBefore(gesture.placeholder, before);
  } else {
    gesture.parent.appendChild(gesture.placeholder);
  }
}

function finishListGesture(event) {
  const gesture = state.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;

  clearTimeout(gesture.pressTimer);
  gesture.pressTimer = null;

  if (gesture.mode === "drag") {
    finalizeDragGesture(gesture);
  } else if (gesture.mode === "swipe") {
    finalizeSwipeGesture(gesture);
  } else {
    cleanupGestureNode(gesture);
  }

  releaseGesturePointer(gesture, event.pointerId);
  state.gesture = null;
}

function cancelListGesture(event) {
  const gesture = state.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;

  clearTimeout(gesture.pressTimer);
  gesture.pressTimer = null;

  if (gesture.mode === "drag" || gesture.mode === "swipe") {
    renderList();
  }

  cleanupGestureNode(gesture);
  releaseGesturePointer(gesture, event.pointerId);
  state.gesture = null;
}

function finalizeSwipeGesture(gesture) {
  const shouldDelete = gesture.currentX - gesture.startX >= gesture.threshold;
  cleanupGestureNode(gesture);
  setClickSuppression(gesture.descriptor.kind, gesture.descriptor.id);

  if (!shouldDelete) return;

  if (gesture.descriptor.kind === "enemy") {
    deleteEnemy(gesture.descriptor.id);
    return;
  }

  if (gesture.descriptor.kind === "group" && gesture.descriptor.groupKind === "room") {
    deleteRoom(gesture.descriptor.id);
  }
}

function finalizeDragGesture(gesture) {
  if (gesture.placeholder?.parentNode) {
    gesture.placeholder.replaceWith(gesture.node);
  }

  cleanupGestureNode(gesture);
  setClickSuppression(gesture.descriptor.kind, gesture.descriptor.id);
  syncStateOrderFromDom();
  normalizeEnemyOrdinals(state.enemies);
  renderList();
  saveEnemies();
}

function cleanupGestureNode(gesture) {
  const node = gesture.node;
  node.classList.remove("swipe-delete-active", "is-dragging");
  node.style.transform = "";
  node.style.removeProperty("position");
  node.style.removeProperty("left");
  node.style.removeProperty("top");
  node.style.removeProperty("width");
  node.style.removeProperty("height");
  node.style.removeProperty("margin");
  node.style.removeProperty("z-index");
  node.style.removeProperty("pointer-events");
  node.style.removeProperty("touch-action");

  if (gesture.placeholder?.parentNode) {
    gesture.placeholder.remove();
  }

  gesture.placeholder = null;
  gesture.parent = null;
}

function releaseGesturePointer(gesture, pointerId) {
  if (gesture.node.releasePointerCapture) {
    try {
      gesture.node.releasePointerCapture(pointerId);
    } catch {
      // Ignore release failures for nodes that no longer own the pointer.
    }
  }
}

function syncStateOrderFromDom() {
  const orderedIds = [];

  for (const child of elements.list.children) {
    collectEnemyIdsFromDomNode(child, orderedIds);
  }

  const byId = new Map(state.enemies.map(enemy => [enemy.id, enemy]));
  state.enemies = orderedIds.map(id => byId.get(id)).filter(Boolean);
}

function collectEnemyIdsFromDomNode(node, orderedIds) {
  if (!(node instanceof HTMLElement)) return;

  if (node.classList.contains("enemy")) {
    orderedIds.push(node.dataset.id);
    return;
  }

  if (!node.classList.contains("enemy-group")) return;

  const rows = Array.from(node.children).find(child => child.classList?.contains("enemy-group-list"));
  if (!rows) return;

  for (const child of rows.children) {
    collectEnemyIdsFromDomNode(child, orderedIds);
  }
}

elements.list.addEventListener("click", event => {
  const button = event.target.closest("button");
  const enemyNode = event.target.closest(".enemy");
  const enemy = enemyNode ? findEnemy(enemyNode.dataset.id) : null;
  const roomGroupNode = event.target.closest('.enemy-group[data-group-kind="room"]');
  const roomGroupKey = roomGroupNode?.dataset.groupKey || null;
  const clickSuppression = state.clickSuppression;

  if (clickSuppression) {
    if (clickSuppression.kind === "enemy" && enemyNode && enemyNode.dataset.id === clickSuppression.id) {
      clearClickSuppression();
      return;
    }

    if (clickSuppression.kind === "group" && roomGroupNode && roomGroupKey === clickSuppression.id) {
      clearClickSuppression();
      return;
    }

    if (clickSuppression.kind === "group" && button && button.closest(".enemy-group")?.dataset.groupKey === clickSuppression.id) {
      clearClickSuppression();
      return;
    }
  }

  if (button && button.classList.contains("room-group-toggle")) {
    const groupNode = button.closest(".enemy-group");
    if (!groupNode) return;
    toggleRoomGroupCollapse(groupNode.dataset.groupKey);
    return;
  }

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
  const descriptor = getListInteractionDescriptor(event);
  if (!descriptor) return;

  startListGesture(event, descriptor);
});

elements.list.addEventListener("pointermove", event => {
  const gesture = state.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;

  updateListGesture(event);
});

elements.list.addEventListener("pointerup", event => {
  finishListGesture(event);
});

elements.list.addEventListener("pointercancel", event => {
  cancelListGesture(event);
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
  if (state.monsterLibraryLoading) return state.monsterLibraryLoading;

  state.monsterLibraryLoading = (async () => {
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
  })();

  return state.monsterLibraryLoading;
}

async function loadScenarioCatalog() {
  if (state.scenarioCatalogLoading) return state.scenarioCatalogLoading;

  state.scenarioCatalogLoading = (async () => {
    const files = Array.from({ length: 95 }, (_, index) => `data/Escenarios/${String(index + 1).padStart(2, "0")}.json`);
    const catalog = (await Promise.all(files.map(async file => {
      try {
        const response = await fetch(file, { cache: "force-cache" });
        if (!response.ok) return null;

        const data = await response.json();
        return {
          file,
          fileName: file.split("/").pop(),
          index: data.index ?? "",
          name: String(data.name || file.split("/").pop().replace(/\.json$/i, "")),
          data
        };
      } catch (error) {
        console.warn(`No se pudo cargar el escenario ${file}.`, error);
        return null;
      }
    }))).filter(Boolean);

    state.scenarioCatalog = catalog;
    renderScenarioSelectOptions();
  })();

  return state.scenarioCatalogLoading;
}

function renderScenarioSelectOptions() {
  if (!elements.scenarioSelect) return;

  if (state.scenarioCatalog.length === 0) {
    elements.scenarioSelect.replaceChildren(createSelectOption("Cargando escenarios...", "", true, true));
    elements.scenarioSelect.disabled = true;
    if (elements.scenarioConfirm) elements.scenarioConfirm.disabled = true;
    return;
  }

  const options = state.scenarioCatalog.map(entry => {
    const label = entry.index ? `${entry.index} - ${entry.name}` : entry.name;
    return createSelectOption(label, entry.file);
  });

  elements.scenarioSelect.replaceChildren(...options);
  elements.scenarioSelect.disabled = false;
  if (elements.scenarioConfirm) elements.scenarioConfirm.disabled = false;
}

function createSelectOption(label, value, selected = false, disabled = false) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  option.disabled = disabled;
  return option;
}

function openScenarioModal() {
  if (!elements.scenarioModal) return;

  if (state.scenarioCatalog.length === 0) {
    renderScenarioSelectOptions();
    void loadScenarioCatalog();
  }

  elements.scenarioLevel.value = elements.level.value;
  elements.scenarioPlayers.value = "4";
  if (state.scenarioCatalog.length > 0 && !elements.scenarioSelect.value) {
    elements.scenarioSelect.value = state.scenarioCatalog[0].file;
  }

  elements.scenarioModal.hidden = false;
  document.body.classList.add("scenario-modal-open");
  if (elements.scenarioConfirm) elements.scenarioConfirm.disabled = state.scenarioCatalog.length === 0;
  requestAnimationFrame(() => {
    elements.scenarioSelect.focus();
  });
}

function closeScenarioModal() {
  if (!elements.scenarioModal || elements.scenarioModal.hidden) return;

  elements.scenarioModal.hidden = true;
  document.body.classList.remove("scenario-modal-open");
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape") return;
  if (elements.scenarioModal && !elements.scenarioModal.hidden) {
    event.preventDefault();
    closeScenarioModal();
  }
}

async function importSelectedScenario() {
  const selectedScenario = state.scenarioCatalog.find(entry => entry.file === elements.scenarioSelect.value);
  if (!selectedScenario) return;

  await loadMonsterLibrary();

  const level = clamp(toInt(elements.scenarioLevel.value, 0), 0, 7);
  const players = clamp(toInt(elements.scenarioPlayers.value, 4), 2, 4);
  const importedEnemies = buildScenarioEnemies(selectedScenario.data, level, players);
  if (importedEnemies.length === 0) return;

  removeActiveScenarioEnemies();
  state.enemies.push(...importedEnemies);
  normalizeEnemyOrdinals(state.enemies);
  renderList();
  saveEnemies();
  closeScenarioModal();
}

function removeActiveScenarioEnemies() {
  const removedIds = new Set(state.enemies.filter(enemy => enemy.scenarioId).map(enemy => enemy.id));
  if (removedIds.size === 0) return;

  state.enemies = state.enemies.filter(enemy => !enemy.scenarioId);

  for (const id of removedIds) {
    clearSelectedEnemyIfNeeded(id);
    clearPendingDamage(id);
    const node = state.nodes.get(id);
    if (node) {
      node.remove();
      state.nodes.delete(id);
    }
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
  const scenarioId = enemy.scenarioId ? String(enemy.scenarioId) : null;
  const roomRef = enemy.roomRef ? String(enemy.roomRef) : null;
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
    libraryStats: enemy.libraryStats && typeof enemy.libraryStats === "object" ? enemy.libraryStats : null,
    scenarioId,
    scenarioName: enemy.scenarioName ? String(enemy.scenarioName) : null,
    roomRef,
    roomOrder: toInt(enemy.roomOrder, null),
    roomCollapsed: Boolean(enemy.roomCollapsed),
    groupCollapsed: Boolean(enemy.groupCollapsed)
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

function clearSelectedEnemyIfNeededForRoom(roomKey) {
  const selected = state.selectedEnemyId ? findEnemy(state.selectedEnemyId) : null;
  if (selected && getEnemyRoomKey(selected) === roomKey) state.selectedEnemyId = null;
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

function clearPendingDamageForRoom(roomKey) {
  const enemyIds = state.enemies
    .filter(enemy => getEnemyRoomKey(enemy) === roomKey)
    .map(enemy => enemy.id);

  for (const enemyId of enemyIds) {
    clearPendingDamage(enemyId);
  }
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

function buildScenarioEnemies(scenario, level, players) {
  const scenarioId = `scenario-${String(scenario.index || scenario.name || "custom").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const scenarioName = String(scenario.name || "Escenario");
  const rooms = Array.isArray(scenario.rooms) ? scenario.rooms : [];
  const enemies = [];

  rooms.forEach((room, roomIndex) => {
    const roomRef = String(room?.ref || `Sala ${roomIndex + 1}`).trim();
    const roomMonsters = Array.isArray(room?.monster) ? room.monster : [];
    const nextOrdinalsByGroup = new Map();

    roomMonsters.forEach((slot, slotIndex) => {
      const monsterId = String(slot?.name || "").trim();
      if (!monsterId) return;

      const monster = state.monsterLibrary.find(entry => entry.id === monsterId || normalizeName(entry.name) === normalizeName(monsterId));
      if (!monster) {
        console.warn(`No se encontró el monstruo ${monsterId} para el escenario ${scenarioName}.`);
        return;
      }

      const rank = resolveScenarioMonsterRank(slot, players);
      const stats = getScenarioMonsterStats(monster, level, rank);
      if (!stats) {
        console.warn(`No se pudieron obtener estadísticas para ${monsterId} en nivel ${level}.`);
        return;
      }

      const displayName = String(monster.name || monsterId);
      const groupKey = `${scenarioId}|${normalizeName(roomRef)}|${normalizeName(displayName)}`;
      const ordinal = (nextOrdinalsByGroup.get(groupKey) || 0) + 1;
      nextOrdinalsByGroup.set(groupKey, ordinal);

      enemies.push({
        id: `enemy-${Date.now()}-${roomIndex}-${slotIndex}-${Math.random().toString(36).slice(2)}`,
        nombre: ordinal > 1 ? `${displayName} ${ordinal}` : displayName,
        groupName: displayName,
        vida: clamp(toInt(stats.health, 1), 0, Math.max(1, toInt(stats.health, 1))),
        max: Math.max(1, toInt(stats.health, 1)),
        escudo: Math.max(0, toInt(stats.shield, 0)),
        elite: rank === "elite",
        ordinal,
        groupOrdinal: ordinal,
        groupCollapsed: false,
        level: String(level),
        monsterId: monster.id,
        libraryStats: {
          normal: monster.levels?.[String(level)]?.normal ? { ...monster.levels[String(level)].normal } : null,
          elite: monster.levels?.[String(level)]?.elite ? { ...monster.levels[String(level)].elite } : null
        },
        scenarioId,
        scenarioName,
        roomRef,
        roomOrder: roomIndex + 1,
        roomCollapsed: true,
        groupCollapsed: true
      });
    });
  });

  return enemies;
}

function resolveScenarioMonsterRank(slot, players) {
  const playersKey = `player${players}`;
  if (slot && typeof slot === "object" && slot[playersKey]) return String(slot[playersKey]).toLowerCase();
  if (slot && typeof slot === "object" && slot.type) return String(slot.type).toLowerCase();

  return "normal";
}

function getScenarioMonsterStats(monster, level, rank) {
  const selectedLevel = String(clamp(toInt(level, 0), 0, 7));
  const monsterLevel = monster?.levels?.[selectedLevel];
  if (!monsterLevel) return null;

  const stats = monsterLevel[String(rank).toLowerCase()];
  return stats && typeof stats === "object" ? stats : null;
}

function getNextEnemyNumbers(baseName, quantity) {
  const used = new Set();
  const escapedName = escapeRegExp(baseName);
  const numberedName = new RegExp(`^${escapedName}\\s+(\\d+)$`, "i");

  state.enemies.forEach(enemy => {
    if (enemy.scenarioId) return;
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
  return state.enemies.some(enemy => !enemy.scenarioId && numberedName.test(String(enemy.nombre)));
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
  showDeleteUndoSnackbar({
    kind: "enemy",
    label: snapshot.nombre,
    index,
    enemy: snapshot
  });
}

function deleteRoom(roomKey) {
  const roomEnemies = state.enemies.filter(enemy => getEnemyRoomKey(enemy) === roomKey);
  if (roomEnemies.length === 0) return;

  const firstIndex = state.enemies.findIndex(enemy => getEnemyRoomKey(enemy) === roomKey);
  const snapshot = roomEnemies.map(cloneEnemy);

  clearSelectedEnemyIfNeededForRoom(roomKey);
  clearPendingDamageForRoom(roomKey);
  hideDeleteUndoSnackbar();
  state.enemies = state.enemies.filter(enemy => getEnemyRoomKey(enemy) !== roomKey);
  renderList();
  saveEnemies();
  showDeleteUndoSnackbar({
    kind: "room",
    label: `Sala ${snapshot[0].roomRef || ""}`.trim(),
    index: firstIndex,
    roomKey,
    enemies: snapshot
  });
}

function renderList() {
  const seenIds = new Set();
  const roots = [];
  const roomGroups = new Map();
  const typeGroups = new Map();

  state.enemies.forEach(enemy => {
    let node = state.nodes.get(enemy.id);
    if (!node) {
      node = createEnemyNode(enemy.id);
      state.nodes.set(enemy.id, node);
    }

    updateEnemy(enemy);
    seenIds.add(enemy.id);

    if (enemy.scenarioId) {
      const roomGroup = ensureRoomGroup(enemy, roomGroups, roots);
      const typeGroup = ensureScenarioTypeGroup(enemy, roomGroup, typeGroups);
      typeGroup.rows.appendChild(node);
      return;
    }

    const typeGroup = ensureManualTypeGroup(enemy, typeGroups, roots);
    typeGroup.rows.appendChild(node);
  });

  elements.list.replaceChildren(...roots.map(group => group.node));

  for (const group of [...roomGroups.values(), ...typeGroups.values()]) {
    syncGroupNode(group);
  }

  for (const [id, node] of state.nodes) {
    if (seenIds.has(id)) continue;
    node.remove();
    state.nodes.delete(id);
    clearPendingDamage(id);
  }
}

function ensureRoomGroup(enemy, roomGroups, roots) {
  const key = getEnemyRoomKey(enemy);
  let group = roomGroups.get(key);
  if (!group) {
    group = createGroupNode({
      kind: "room",
      title: getEnemyRoomTitle(enemy),
      key,
      collapsed: isRoomCollapsed(key),
      showStats: false
    });
    group.typeGroups = new Map();
    roomGroups.set(key, group);
    roots.push(group);
  }

  group.sourceEnemy ??= enemy;
  group.count += 1;
  return group;
}

function ensureScenarioTypeGroup(enemy, roomGroup, typeGroups) {
  const key = getEnemyGroupKey(enemy);
  let group = typeGroups.get(key);
  if (!group) {
    group = createGroupNode({
      kind: "type",
      title: getEnemyGroupTitle(enemy),
      key,
      collapsed: isGroupCollapsed(key),
      showStats: true
    });
    typeGroups.set(key, group);
    roomGroup.rows.appendChild(group.node);
  }

  group.sourceEnemy ??= enemy;
  group.count += 1;
  return group;
}

function ensureManualTypeGroup(enemy, typeGroups, roots) {
  const key = getEnemyGroupKey(enemy);
  let group = typeGroups.get(key);
  if (!group) {
    group = createGroupNode({
      kind: "type",
      title: getEnemyGroupTitle(enemy),
      key,
      collapsed: isGroupCollapsed(key),
      showStats: true
    });
    typeGroups.set(key, group);
    roots.push(group);
  }

  group.sourceEnemy ??= enemy;
  group.count += 1;
  return group;
}

function createGroupNode({ kind, title, key, collapsed, showStats }) {
  const node = document.createElement("article");
  node.className = `enemy-group enemy-group--${kind}`;
  node.dataset.groupKey = key;
  node.dataset.groupKind = kind;

  const header = document.createElement("button");
  header.type = "button";
  header.className = `enemy-group-title ${kind === "type" ? "enemy-group-toggle" : `${kind}-group-toggle`}`;
  header.innerHTML = `
    <span class="enemy-group-indicator" aria-hidden="true"></span>
    <span class="enemy-group-title-text"></span>
    <span class="enemy-group-stats" aria-hidden="true"></span>
  `;
  header.querySelector(".enemy-group-indicator").textContent = collapsed ? "\u25ba" : "\u25bc";
  header.querySelector(".enemy-group-title-text").textContent = title;
  const statsNode = header.querySelector(".enemy-group-stats");
  statsNode.hidden = !showStats;

  const rows = document.createElement("div");
  rows.className = "enemy-group-list";

  node.append(header, rows);
  return { node, rows, header, statsNode, title, kind, collapsed, sourceEnemy: null, count: 0 };
}

function syncGroupNode(group) {
  if (!group) return;

  const indicator = group.header.querySelector(".enemy-group-indicator");
  const titleNode = group.header.querySelector(".enemy-group-title-text");
  indicator.textContent = group.collapsed ? "\u25ba" : "\u25bc";
  titleNode.textContent = group.title;
  group.header.setAttribute("aria-expanded", group.collapsed ? "false" : "true");
  group.rows.hidden = group.collapsed;

  if (group.kind === "type") {
    renderMonsterHeaderStats(group.statsNode, group.sourceEnemy);
  } else if (group.statsNode) {
    group.statsNode.replaceChildren();
    group.statsNode.hidden = true;
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

  const normalStats = getMonsterStatsForGroupHeader(enemy, false);
  const eliteStats = getMonsterStatsForGroupHeader(enemy, true);
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

function getMonsterStatsForGroupHeader(enemy, elite = false) {
  if (enemy?.scenarioId) {
    const monster = getMonsterForEnemy(enemy);
    if (!monster) return getStoredMonsterStats(enemy, elite);

    const level = String(enemy.level ?? "0");
    const rank = elite ? "elite" : "normal";
    return monster?.levels?.[level]?.[rank] || getStoredMonsterStats(enemy, elite);
  }

  return getMonsterStatsForCurrentLevel(enemy, elite);
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
  if (enemy?.scenarioId) {
    return `${normalizeName(enemy.scenarioId)}|${normalizeName(enemy.roomRef || "room")}|${normalizeName(getEnemyGroupName(enemy))}`;
  }
  return normalizeName(getEnemyGroupName(enemy));
}

function getEnemyGroupTitle(enemy) {
  return getEnemyGroupName(enemy);
}

function getEnemyRoomKey(enemy) {
  if (!enemy?.scenarioId) return null;
  return `${normalizeName(enemy.scenarioId)}|${normalizeName(enemy.roomRef || "room")}`;
}

function getEnemyRoomTitle(enemy) {
  return String(enemy?.roomRef || "Sala").trim();
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

function isRoomCollapsed(roomKey) {
  return state.enemies.some(enemy => getEnemyRoomKey(enemy) === roomKey && Boolean(enemy.roomCollapsed));
}

function setRoomCollapsed(roomKey, collapsed) {
  state.enemies.forEach(enemy => {
    if (getEnemyRoomKey(enemy) === roomKey) enemy.roomCollapsed = Boolean(collapsed);
  });
}

function toggleRoomGroupCollapse(roomKey) {
  const nextCollapsed = !isRoomCollapsed(roomKey);
  setRoomCollapsed(roomKey, nextCollapsed);
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

function showDeleteUndoSnackbar(payload) {
  if (!payload) return;

  const token = {};
  state.deleteUndo = {
    ...payload,
    token,
    timer: window.setTimeout(() => {
      if (state.deleteUndo?.token !== token) return;
      hideDeleteUndoSnackbar();
    }, 3000)
  };
  renderDeleteUndoSnackbar(payload);
}

function undoDeleteEnemy() {
  const pending = state.deleteUndo;
  if (!pending) return;

  clearTimeout(pending.timer);
  if (pending.kind === "room") {
    const index = clamp(pending.index, 0, state.enemies.length);
    const restored = Array.isArray(pending.enemies) ? pending.enemies.map(cloneEnemy) : [];
    state.enemies.splice(index, 0, ...restored);
  } else if (pending.kind === "enemy") {
    const index = clamp(pending.index, 0, state.enemies.length);
    state.enemies.splice(index, 0, cloneEnemy(pending.enemy));
  }
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

function renderDeleteUndoSnackbar(payload) {
  if (payload.kind === "room") {
    elements.snackbarMessage.textContent = `${payload.label} eliminada`;
  } else {
    elements.snackbarMessage.textContent = `${payload.label} eliminado`;
  }
  elements.snackbar.classList.add("visible");
}

function clearDeleteUndoTimer() {
  if (state.deleteUndo?.timer) {
    clearTimeout(state.deleteUndo.timer);
  }
}

function clearDeleteUndoSnackbar() {
  elements.snackbar.classList.remove("visible");
  elements.snackbarMessage.textContent = "";
}



