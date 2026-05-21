const STORAGE_KEY = "goals-tracker-v1";

const NOTIFICATIONS_KEY = "goals-notifications-enabled";

const LAST_OPEN_KEY = "goals-notifications-last-open";



/** @typedef {{ id: string, title: string, deadline: string, createdAt: string, completed: boolean, completedAt: string | null }} Goal */



/** @type {Goal[]} */

let goals = [];

let filter = "active";

let editingId = null;

let tickTimer = null;

/** @type {ReturnType<typeof setTimeout>[]} */

let reminderTimeouts = [];

let serviceWorkerRegistration = null;



const form = document.getElementById("goal-form");

const titleInput = document.getElementById("goal-title");

const dateInput = document.getElementById("goal-date");

const timeInput = document.getElementById("goal-time");

const formError = document.getElementById("form-error");

const goalsList = document.getElementById("goals-list");

const emptyState = document.getElementById("empty-state");

const statsEl = document.getElementById("stats");

const enableNotificationsBtn = document.getElementById("enable-notifications");

const testNotificationBtn = document.getElementById("test-notification");

const notificationStatusEl = document.getElementById("notification-status");

const notificationPlanEl = document.getElementById("notification-plan");



init();



function init() {

  loadGoals();

  setDefaultDateTime();

  form.addEventListener("submit", onSubmit);

  goalsList.addEventListener("click", onListClick);



  document.querySelectorAll(".filter__btn").forEach((btn) => {

    btn.addEventListener("click", () => {

      filter = btn.dataset.filter;

      document.querySelectorAll(".filter__btn").forEach((b) => {

        b.classList.toggle("filter__btn--active", b === btn);

      });

      render();

    });

  });



  startTicker();

  render();

  setupPwa();

  setupNotificationsUi();

  document.addEventListener("visibilitychange", () => {

    if (document.visibilityState === "visible") {

      checkMissedReminders();

      scheduleReminders();

      markAppOpened();

    }

  });

  markAppOpened();

  checkMissedReminders();

}



function setDefaultDateTime() {

  const now = new Date();

  now.setDate(now.getDate() + 7);

  dateInput.value = formatDateInput(now);

  timeInput.value = "12:00";

}



function formatDateInput(d) {

  const y = d.getFullYear();

  const m = String(d.getMonth() + 1).padStart(2, "0");

  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;

}



function formatTimeInput(d) {

  const h = String(d.getHours()).padStart(2, "0");

  const m = String(d.getMinutes()).padStart(2, "0");

  return `${h}:${m}`;

}



function parseDeadlineFromInputs(date, time) {

  if (!date || !time) {

    return { deadline: null, error: "Укажите дату и время." };

  }



  const deadline = new Date(`${date}T${time}`);

  if (Number.isNaN(deadline.getTime())) {

    return { deadline: null, error: "Некорректная дата или время." };

  }



  if (deadline.getTime() <= Date.now()) {

    return { deadline: null, error: "Новый дедлайн должен быть в будущем." };

  }



  return { deadline, error: null };

}



function getEditDeadlineDefaults(goal) {

  const current = new Date(goal.deadline);

  const status = getStatus(goal);



  if (status === "overdue") {

    const suggested = new Date();

    suggested.setDate(suggested.getDate() + 7);

    suggested.setHours(12, 0, 0, 0);

    return {

      date: formatDateInput(suggested),

      time: formatTimeInput(suggested),

    };

  }



  return {

    date: formatDateInput(current),

    time: formatTimeInput(current),

  };

}



function loadGoals() {

  try {

    const raw = localStorage.getItem(STORAGE_KEY);

    goals = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(goals)) goals = [];

  } catch {

    goals = [];

  }

  migrateGoals();

}



function inferCreatedAt(goal) {

  if (/^\d{10,13}$/.test(String(goal.id))) {

    const ms = String(goal.id).length > 13 ? parseInt(String(goal.id).slice(0, 13), 10) : parseInt(goal.id, 10);

    const d = new Date(ms);

    if (!Number.isNaN(d.getTime()) && d.getTime() > 0 && d.getTime() <= Date.now()) {

      return d.toISOString();

    }

  }

  return null;

}



function migrateGoals() {

  let changed = false;

  const fallback = new Date().toISOString();

  for (const goal of goals) {

    if (!goal.createdAt) {

      goal.createdAt = inferCreatedAt(goal) || fallback;

      changed = true;

    }

  }

  if (changed) saveGoals();

}



function saveGoals() {

  localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));

  scheduleReminders();

}



function onSubmit(e) {

  e.preventDefault();

  hideFormError();



  const title = titleInput.value.trim();

  const date = dateInput.value;

  const time = timeInput.value;



  if (!title) {

    showFormError("Введите название цели.");

    titleInput.focus();

    return;

  }



  const parsed = parseDeadlineFromInputs(date, time);

  if (parsed.error) {

    showFormError(parsed.error === "Укажите дату и время." ? "Укажите дату и время достижения." : parsed.error);

    return;

  }



  const deadline = parsed.deadline;



  goals.unshift({

    id: crypto.randomUUID(),

    title,

    deadline: deadline.toISOString(),

    createdAt: new Date().toISOString(),

    completed: false,

    completedAt: null,

  });



  saveGoals();

  form.reset();

  setDefaultDateTime();

  filter = "active";

  document.querySelector('[data-filter="active"]')?.classList.add("filter__btn--active");

  document.querySelectorAll('.filter__btn:not([data-filter="active"])').forEach((b) => {

    b.classList.remove("filter__btn--active");

  });

  render();

}



function showFormError(msg) {

  formError.textContent = msg;

  formError.hidden = false;

}



function hideFormError() {

  formError.hidden = true;

  formError.textContent = "";

}



function onListClick(e) {

  const btn = e.target.closest("[data-action]");

  if (!btn) return;



  const id = btn.closest("[data-id]")?.dataset.id;

  if (!id) return;



  const action = btn.dataset.action;

  if (action === "complete") completeGoal(id);

  if (action === "delete") deleteGoal(id);

  if (action === "restore") restoreGoal(id);

  if (action === "edit-deadline") startEditDeadline(id);

  if (action === "save-deadline") saveDeadline(id, btn.closest("[data-id]"));

  if (action === "cancel-edit") cancelEditDeadline();

}



function completeGoal(id) {

  const goal = goals.find((g) => g.id === id);

  if (!goal || goal.completed) return;

  goal.completed = true;

  goal.completedAt = new Date().toISOString();

  saveGoals();

  render();

}



function restoreGoal(id) {

  const goal = goals.find((g) => g.id === id);

  if (!goal) return;

  goal.completed = false;

  goal.completedAt = null;

  saveGoals();

  render();

}



function deleteGoal(id) {

  if (editingId === id) editingId = null;

  goals = goals.filter((g) => g.id !== id);

  saveGoals();

  render();

}



function startEditDeadline(id) {

  const goal = goals.find((g) => g.id === id);

  if (!goal || goal.completed) return;

  editingId = id;

  render();

}



function cancelEditDeadline() {

  editingId = null;

  render();

}



function saveDeadline(id, cardEl) {

  const goal = goals.find((g) => g.id === id);

  if (!goal || goal.completed || !cardEl) return;



  const date = cardEl.querySelector("[data-edit-date]")?.value;

  const time = cardEl.querySelector("[data-edit-time]")?.value;

  const errorEl = cardEl.querySelector("[data-edit-error]");

  const parsed = parseDeadlineFromInputs(date, time);



  if (parsed.error) {

    if (errorEl) {

      errorEl.textContent = parsed.error;

      errorEl.hidden = false;

    }

    return;

  }



  goal.deadline = parsed.deadline.toISOString();

  editingId = null;

  saveGoals();

  render();

}



function getStatus(goal) {

  if (goal.completed) return "completed";

  const diff = new Date(goal.deadline).getTime() - Date.now();

  if (diff <= 0) return "overdue";

  return "upcoming";

}



function getCountdown(deadlineIso) {

  const diff = Math.max(0, new Date(deadlineIso).getTime() - Date.now());

  const totalSec = Math.floor(diff / 1000);

  const days = Math.floor(totalSec / 86400);

  const hours = Math.floor((totalSec % 86400) / 3600);

  const minutes = Math.floor((totalSec % 3600) / 60);

  const seconds = totalSec % 60;

  return { days, hours, minutes, seconds };

}



function formatDeadline(iso) {

  return new Date(iso).toLocaleString("ru-RU", {

    day: "numeric",

    month: "long",

    year: "numeric",

    hour: "2-digit",

    minute: "2-digit",

  });

}



function pad(n) {

  return String(n).padStart(2, "0");

}



function formatDurationRu(ms) {

  const totalSec = Math.max(0, Math.floor(ms / 1000));

  const days = Math.floor(totalSec / 86400);

  const hours = Math.floor((totalSec % 86400) / 3600);

  const minutes = Math.floor((totalSec % 3600) / 60);

  const parts = [];

  if (days > 0) parts.push(`${days} д`);

  if (hours > 0 || days > 0) parts.push(`${hours} ч`);

  parts.push(`${minutes} м`);

  return parts.join(" ");

}



function getTimelineMetrics(goal) {

  const start = new Date(goal.createdAt).getTime();

  const end = new Date(goal.deadline).getTime();

  const total = Math.max(end - start, 1);

  const now = goal.completed && goal.completedAt ? new Date(goal.completedAt).getTime() : Date.now();

  const elapsed = now - start;

  const remaining = end - now;

  const overdue = !goal.completed && remaining <= 0;



  let elapsedPct = (elapsed / total) * 100;

  if (overdue) elapsedPct = 100;

  else elapsedPct = Math.min(100, Math.max(0, elapsedPct));



  const remainingPct = overdue ? 0 : Math.max(0, 100 - elapsedPct);



  let remainingLabel;

  if (goal.completed) remainingLabel = "Завершено";

  else if (overdue) remainingLabel = "Просрочено";

  else remainingLabel = `Осталось: ${formatDurationRu(remaining)}`;



  return {

    elapsedPct,

    remainingPct,

    markerPct: elapsedPct,

    overdue,

    elapsedLabel: `Прошло: ${formatDurationRu(Math.max(0, Math.min(elapsed, total)))}`,

    remainingLabel,

    percentLabel: overdue ? "100%" : `${Math.round(elapsedPct)}%`,

  };

}



function buildTimelineHtml(goal, status) {

  const m = getTimelineMetrics(goal);

  const remainingText = goal.completed ? "Завершено" : m.overdue ? "Просрочено" : m.remainingLabel;



  return `

    <div class="goal-timeline goal-timeline--${status}" data-timeline aria-label="Временная шкала цели">

      <div class="goal-timeline__labels">

        <span data-tl-elapsed>${m.elapsedLabel}</span>

        <span data-tl-remaining>${remainingText}</span>

      </div>

      <div class="goal-timeline__track">

        <div class="goal-timeline__elapsed" data-tl-bar-elapsed style="width: ${m.elapsedPct}%"></div>

        <div class="goal-timeline__remaining" data-tl-bar-remaining style="left: ${m.elapsedPct}%; width: ${m.remainingPct}%"></div>

        <div class="goal-timeline__marker" data-tl-marker style="left: ${m.markerPct}%"></div>

      </div>

      <div class="goal-timeline__ends">

        <span data-tl-percent>${m.percentLabel}</span>

        <span>Дедлайн</span>

      </div>

    </div>

  `;

}



function applyTimelineMetrics(el, goal) {

  const status = getStatus(goal);

  const m = getTimelineMetrics(goal);



  el.className = `goal-timeline goal-timeline--${status}`;



  const elapsedEl = el.querySelector("[data-tl-elapsed]");

  const remainingEl = el.querySelector("[data-tl-remaining]");

  const barElapsed = el.querySelector("[data-tl-bar-elapsed]");

  const barRemaining = el.querySelector("[data-tl-bar-remaining]");

  const marker = el.querySelector("[data-tl-marker]");

  const percent = el.querySelector("[data-tl-percent]");



  if (elapsedEl) elapsedEl.textContent = m.elapsedLabel;

  if (remainingEl) {

    remainingEl.textContent = goal.completed

      ? "Завершено"

      : m.overdue

        ? "Просрочено"

        : m.remainingLabel;

  }

  if (barElapsed) barElapsed.style.width = `${m.elapsedPct}%`;

  if (barRemaining) {

    barRemaining.style.left = `${m.elapsedPct}%`;

    barRemaining.style.width = `${m.remainingPct}%`;

  }

  if (marker) marker.style.left = `${m.markerPct}%`;

  if (percent) percent.textContent = m.percentLabel;

}



function filteredGoals() {

  return goals.filter((g) => {

    if (filter === "completed") return g.completed;

    if (filter === "active") return !g.completed;

    return true;

  });

}



function renderStats() {

  const active = goals.filter((g) => !g.completed).length;

  const overdue = goals.filter((g) => !g.completed && getStatus(g) === "overdue").length;

  const done = goals.filter((g) => g.completed).length;



  statsEl.innerHTML = `

    <span class="stat-pill">Активных: <strong>${active}</strong></span>

    <span class="stat-pill">Просрочено: <strong>${overdue}</strong></span>

    <span class="stat-pill">Выполнено: <strong>${done}</strong></span>

  `;

}



function render() {

  renderStats();

  const list = filteredGoals();

  goalsList.innerHTML = "";



  if (list.length === 0) {

    emptyState.hidden = false;

    const messages = {

      active: "Нет активных целей. Добавьте новую цель ниже.",

      completed: "Пока нет выполненных целей.",

      all: "Пока нет целей. Добавьте первую цель ниже.",

    };

    emptyState.textContent = messages[filter] || messages.all;

    return;

  }



  emptyState.hidden = true;



  for (const goal of list) {

    const status = getStatus(goal);

    const li = document.createElement("li");

    li.className = `goal-card goal-card--${status}`;

    li.dataset.id = goal.id;



    const badgeLabels = {

      upcoming: "До дедлайна",

      overdue: "Просрочено",

      completed: "Выполнено",

    };



    let countdownHtml = "";

    if (!goal.completed) {

      const c = getCountdown(goal.deadline);

      countdownHtml = `

        <div class="countdown" aria-label="Обратный отсчёт">

          <div class="countdown__unit"><span class="countdown__value" data-unit="days">${c.days}</span><span class="countdown__label">дней</span></div>

          <div class="countdown__unit"><span class="countdown__value" data-unit="hours">${pad(c.hours)}</span><span class="countdown__label">часов</span></div>

          <div class="countdown__unit"><span class="countdown__value" data-unit="minutes">${pad(c.minutes)}</span><span class="countdown__label">минут</span></div>

          <div class="countdown__unit"><span class="countdown__value" data-unit="seconds">${pad(c.seconds)}</span><span class="countdown__label">секунд</span></div>

        </div>

      `;

    }



    const isEditing = editingId === goal.id;

    const editDefaults = isEditing ? getEditDeadlineDefaults(goal) : null;



    const editPanel = isEditing

      ? `

        <div class="goal-edit" data-edit-panel>

          <p class="goal-edit__title">Новый дедлайн</p>

          <p class="goal-edit__hint">${status === "overdue" ? "Цель просрочена — выберите новую дату и время." : "Измените дату или время достижения."}</p>

          <div class="goal-edit__fields">

            <div class="form__field">

              <label class="form__label" for="edit-date-${goal.id}">Дата</label>

              <input id="edit-date-${goal.id}" type="date" class="form__input" data-edit-date value="${editDefaults.date}" />

            </div>

            <div class="form__field">

              <label class="form__label" for="edit-time-${goal.id}">Время</label>

              <input id="edit-time-${goal.id}" type="time" class="form__input" data-edit-time value="${editDefaults.time}" />

            </div>

          </div>

          <p class="goal-edit__error" data-edit-error role="alert" hidden></p>

          <div class="goal-edit__actions">

            <button type="button" class="btn btn--primary btn--compact" data-action="save-deadline">Сохранить</button>

            <button type="button" class="btn btn--ghost btn--compact" data-action="cancel-edit">Отмена</button>

          </div>

        </div>

      `

      : "";



    const actions =

      status === "completed"

        ? `

          <button type="button" class="btn btn--ghost" data-action="restore">Вернуть в активные</button>

          <button type="button" class="btn btn--danger" data-action="delete">Удалить</button>

        `

        : isEditing

          ? `

          <button type="button" class="btn btn--success" data-action="complete">Отметить выполненной</button>

          <button type="button" class="btn btn--danger" data-action="delete">Удалить</button>

        `

          : `

          <button type="button" class="btn btn--success" data-action="complete">Отметить выполненной</button>

          <button type="button" class="btn btn--danger" data-action="delete">Удалить</button>

        `;



    const deadlineRow =

      status === "completed"

        ? `<p class="goal-card__deadline">Дедлайн: ${formatDeadline(goal.deadline)}</p>`

        : isEditing

          ? `<p class="goal-card__deadline">Дедлайн: ${formatDeadline(goal.deadline)}</p>`

          : `

      <div class="goal-card__deadline-row">

        <p class="goal-card__deadline">Дедлайн: ${formatDeadline(goal.deadline)}</p>

        <button type="button" class="btn btn--accent btn--compact btn--deadline" data-action="edit-deadline">Изменить дедлайн</button>

      </div>

    `;



    li.innerHTML = `

      <div class="goal-card__top">

        <h3 class="goal-card__title">${escapeHtml(goal.title)}</h3>

        <span class="goal-card__badge">${badgeLabels[status]}</span>

      </div>

      ${deadlineRow}

      ${buildTimelineHtml(goal, status)}

      <p class="goal-card__overdue-msg">Дедлайн прошёл — цель не выполнена</p>

      <p class="goal-card__completed-msg">Цель достигнута!</p>

      ${countdownHtml}

      ${editPanel}

      <div class="goal-card__actions">${actions}</div>

    `;



    goalsList.appendChild(li);

  }

}



function updateCountdownsOnly() {

  const cards = goalsList.querySelectorAll(".goal-card--upcoming, .goal-card--overdue");

  let needsFullRender = false;



  for (const card of cards) {

    const id = card.dataset.id;

    const goal = goals.find((g) => g.id === id);

    if (!goal || goal.completed) continue;



    const status = getStatus(goal);

    const prevStatus = card.classList.contains("goal-card--overdue")

      ? "overdue"

      : card.classList.contains("goal-card--upcoming")

        ? "upcoming"

        : status;

    if (status !== prevStatus) {

      needsFullRender = true;

      break;

    }



    const c = getCountdown(goal.deadline);

    const set = (unit, val) => {

      const el = card.querySelector(`[data-unit="${unit}"]`);

      if (el) el.textContent = unit === "days" ? String(val) : pad(val);

    };

    set("days", c.days);

    set("hours", c.hours);

    set("minutes", c.minutes);

    set("seconds", c.seconds);



    const timeline = card.querySelector("[data-timeline]");

    if (timeline) applyTimelineMetrics(timeline, goal);

  }



  if (needsFullRender) {

    render();

    renderStats();

  } else {

    renderStats();

  }

}



function startTicker() {

  if (tickTimer) clearInterval(tickTimer);

  tickTimer = setInterval(() => {

    if (filter === "completed") {

      renderStats();

      return;

    }

    updateCountdownsOnly();

  }, 1000);

}



function escapeHtml(str) {

  const div = document.createElement("div");

  div.textContent = str;

  return div.innerHTML;

}



function notificationsSupported() {

  return "Notification" in window && "serviceWorker" in navigator;

}



async function setupPwa() {

  if (!("serviceWorker" in navigator)) return;

  try {

    serviceWorkerRegistration = await navigator.serviceWorker.register("sw.js");

  } catch {

    serviceWorkerRegistration = null;

  }

}



function updateNotificationStatus() {

  if (!notificationStatusEl) return;

  if (!notificationsSupported()) {

    notificationStatusEl.textContent = "Напоминания недоступны в этом браузере.";

    if (enableNotificationsBtn) enableNotificationsBtn.disabled = true;

    return;

  }



  if (localStorage.getItem(NOTIFICATIONS_KEY) === "1" && Notification.permission === "granted") {

    const planned = collectUpcomingReminders().length;

    notificationStatusEl.textContent = planned

      ? `Напоминания включены. Запланировано: ${planned}. Они придут на экран блокировки.`

      : "Напоминания включены. Добавьте активную цель с дедлайном в ближайшие 7 дней.";

    if (enableNotificationsBtn) {

      enableNotificationsBtn.textContent = "Перепланировать напоминания";

      enableNotificationsBtn.disabled = false;

    }

    if (testNotificationBtn) testNotificationBtn.hidden = false;

    renderNotificationPlan();

    return;

  }



  if (testNotificationBtn) testNotificationBtn.hidden = true;

  if (notificationPlanEl) notificationPlanEl.hidden = true;



  if (Notification.permission === "denied") {

    notificationStatusEl.textContent = "Доступ запрещён. Настройки → Уведомления → «Мои цели» → включите «Допуск уведомлений».";

    if (enableNotificationsBtn) enableNotificationsBtn.disabled = true;

    if (testNotificationBtn) testNotificationBtn.hidden = true;

    if (notificationPlanEl) notificationPlanEl.hidden = true;

    return;

  }



  notificationStatusEl.textContent = "Сначала добавьте сайт на экран «Домой», затем включите напоминания.";

  if (enableNotificationsBtn) {

    enableNotificationsBtn.textContent = "Включить напоминания";

    enableNotificationsBtn.disabled = false;

  }

}



function setupNotificationsUi() {

  updateNotificationStatus();

  enableNotificationsBtn?.addEventListener("click", async () => {

    const enabled = await requestNotifications();

    if (enabled) {

      checkMissedReminders();

      scheduleReminders();

    }

    updateNotificationStatus();

  });



  testNotificationBtn?.addEventListener("click", async () => {

    await showGoalReminder(

      { id: "test", title: "Тестовая цель" },

      "Проверка уведомлений",

      "если видите это — всё работает"

    );

    updateNotificationStatus();

  });



  if (localStorage.getItem(NOTIFICATIONS_KEY) === "1" && Notification.permission === "granted") {

    scheduleReminders();

  }

}



function markAppOpened() {

  localStorage.setItem(LAST_OPEN_KEY, String(Date.now()));

}



function getReminderDefinitions() {

  return [

    { offset: 24 * 60 * 60 * 1000, title: "Завтра дедлайн", suffix: "остался 1 день" },

    { offset: 60 * 60 * 1000, title: "Скоро дедлайн", suffix: "остался 1 час" },

    { offset: 0, title: "Дедлайн сейчас", suffix: "пора выполнить цель" },

  ];

}



function collectUpcomingReminders() {

  const now = Date.now();

  const maxDelay = 7 * 24 * 60 * 60 * 1000;

  /** @type {{ fireAt: number, goal: Goal, reminder: { title: string, suffix: string } }[]} */

  const planned = [];



  for (const goal of goals) {

    if (goal.completed) continue;

    const deadline = new Date(goal.deadline).getTime();

    for (const reminder of getReminderDefinitions()) {

      const fireAt = deadline - reminder.offset;

      const delay = fireAt - now;

      if (delay <= 0 || delay > maxDelay) continue;

      planned.push({ fireAt, goal, reminder });

    }

  }



  return planned.sort((a, b) => a.fireAt - b.fireAt);

}



function renderNotificationPlan() {

  if (!notificationPlanEl) return;

  const planned = collectUpcomingReminders();



  if (localStorage.getItem(NOTIFICATIONS_KEY) !== "1" || Notification.permission !== "granted") {

    notificationPlanEl.hidden = true;

    return;

  }



  if (planned.length === 0) {

    notificationPlanEl.hidden = false;

    notificationPlanEl.innerHTML = `

      <p class="install__plan-title">Ближайшие напоминания</p>

      <p class="install__plan-empty">Пока не запланировано. Добавьте цель с дедлайном в ближайшие 7 дней и нажмите «Перепланировать».</p>

      <p class="install__plan-note">На iPhone открывайте «Мои цели» раз в день — так напоминания не потеряются.</p>

    `;

    return;

  }



  const items = planned

    .slice(0, 5)

    .map(({ fireAt, goal, reminder }) => {

      const when = new Date(fireAt).toLocaleString("ru-RU", {

        day: "numeric",

        month: "short",

        hour: "2-digit",

        minute: "2-digit",

      });

      return `<li><strong>${escapeHtml(reminder.title)}</strong> — «${escapeHtml(goal.title)}» · ${when}</li>`;

    })

    .join("");



  notificationPlanEl.hidden = false;

  notificationPlanEl.innerHTML = `

    <p class="install__plan-title">Ближайшие напоминания</p>

    <ul class="install__plan-list">${items}</ul>

    <p class="install__plan-note">На iPhone открывайте «Мои цели» раз в день — так напоминания не потеряются.</p>

  `;

}



async function checkMissedReminders() {

  if (localStorage.getItem(NOTIFICATIONS_KEY) !== "1") return;

  if (!notificationsSupported() || Notification.permission !== "granted") return;



  const now = Date.now();

  const lastOpen = Number(localStorage.getItem(LAST_OPEN_KEY) || "0");

  if (!lastOpen) return;



  for (const goal of goals) {

    if (goal.completed) continue;

    const deadline = new Date(goal.deadline).getTime();

    for (const reminder of getReminderDefinitions()) {

      const fireAt = deadline - reminder.offset;

      if (fireAt <= lastOpen || fireAt > now) continue;

      await showGoalReminder(goal, reminder.title, reminder.suffix);

    }

  }

}



async function requestNotifications() {

  if (!notificationsSupported()) return false;



  const permission = await Notification.requestPermission();

  if (permission !== "granted") {

    updateNotificationStatus();

    return false;

  }



  localStorage.setItem(NOTIFICATIONS_KEY, "1");

  if (!serviceWorkerRegistration) await setupPwa();

  return true;

}



function clearReminderTimeouts() {

  for (const timeout of reminderTimeouts) clearTimeout(timeout);

  reminderTimeouts = [];

}



function scheduleReminders() {

  clearReminderTimeouts();

  if (localStorage.getItem(NOTIFICATIONS_KEY) !== "1") return;

  if (!notificationsSupported() || Notification.permission !== "granted") return;



  const now = Date.now();

  const maxDelay = 7 * 24 * 60 * 60 * 1000;



  for (const { fireAt, goal, reminder } of collectUpcomingReminders()) {

    const delay = fireAt - now;

    if (delay <= 0 || delay > maxDelay) continue;



    const timeout = setTimeout(() => {

      showGoalReminder(goal, reminder.title, reminder.suffix);

    }, delay);



    reminderTimeouts.push(timeout);

  }



  renderNotificationPlan();

  updateNotificationStatus();

}



async function showGoalReminder(goal, title, suffix) {

  if (Notification.permission !== "granted") return;



  const body = `«${goal.title}» — ${suffix}`;

  const options = {

    body,

    icon: "icon.svg",

    badge: "icon.svg",

    tag: `goal-${goal.id}-${title}`,

    data: { url: "./" },

  };



  try {

    const reg = serviceWorkerRegistration || (await navigator.serviceWorker.ready);

    await reg.showNotification(title, options);

  } catch {

    new Notification(title, options);

  }

}


