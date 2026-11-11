/* Trainingslog: komplett lokal, ohne Backend und ohne externe Laufzeit-Abhängigkeiten. */
const DATABASE_NAME = "trainingslog-v1";
const DATABASE_VERSION = 2;
const APP_VERSION = "0.4.1";
const APP_SETTINGS_KEY = "trainingslog-settings-v1";
const END_REASONS = ["Schmerzen/Beschwerden", "Gerät besetzt", "Zeitmangel", "Erschöpfung", "Sonstiges", "Ohne Angabe"];

// Kompakte Technik-Cues, keine Anleitungen für Anfänger. Offline im Programm enthalten.
const TECHNIQUE_HINTS = {
  "a-chest": ["Schulterblätter hinten und unten", "Brustkorb stabil halten", "Schultern nicht nach vorne ziehen"],
  "a-lat": ["Schultern unten lassen", "Zur oberen Brust ziehen", "Nicht ins Hohlkreuz schwingen"],
  "a-legs": ["Unterer Rücken bleibt am Polster", "Knie folgen den Fußspitzen", "Knie nicht durchdrücken"],
  "a-shoulders": ["Rumpf fest, kein Hohlkreuz", "Handgelenke über den Ellenbogen", "Kontrolliert ablassen"],
  "a-row": ["Rücken neutral halten", "Schulterblätter zusammenführen", "Kein Schwung aus dem Oberkörper"],
  "a-triceps": ["Ellenbogen nah am Körper", "Oberarme ruhig halten", "Nicht mit dem Oberkörper drücken"],
  "b-incline": ["Schulterblätter stabil zurück", "Handgelenke über den Ellenbogen", "Gewicht kontrolliert ablassen"],
  "b-pull": ["Schultern aktiv nach unten", "Kein Schwung", "Bewegung kontrolliert ausführen"],
  "b-legs": ["Becken fest am Sitz", "Kein Schwung aus dem Rücken", "Knie kontrolliert strecken"],
  "b-row": ["Rücken neutral", "Ellenbogen nach hinten führen", "Nicht zurücklehnen und reißen"],
  "b-lateral": ["Schultern nicht hochziehen", "Ellenbogen leicht gebeugt", "Keinen Schwung holen"],
  "b-biceps": ["Ellenbogen bleiben ruhig", "Handgelenke neutral", "Keine Schwungbewegung"],
};

const examplePlans = [
  {
    id: "plan-a", name: "Training A", focus: "Ganzkörper · Oberkörperfokus",
    exercises: [
      exercise("a-chest", "Brustpresse", 3, 8, 12, 2.5, 90),
      exercise("a-lat", "Latzug", 3, 8, 12, 2.5, 90),
      exercise("a-legs", "Beinpresse", 3, 10, 15, 5, 120),
      exercise("a-shoulders", "Schulterpresse", 3, 8, 12, 2.5, 90),
      exercise("a-row", "Rudern sitzend", 3, 8, 12, 2.5, 90),
      exercise("a-triceps", "Trizeps am Kabel", 2, 10, 15, 2.5, 75),
    ],
  },
  {
    id: "plan-b", name: "Training B", focus: "Ganzkörper · Oberkörperfokus",
    exercises: [
      exercise("b-incline", "Schrägbankdrücken", 3, 8, 12, 2.5, 90),
      exercise("b-pull", "Klimmzugmaschine", 3, 8, 12, 2.5, 90),
      exercise("b-legs", "Beinstrecker", 3, 10, 15, 2.5, 90),
      exercise("b-row", "Rudern am Kabel", 3, 8, 12, 2.5, 90),
      exercise("b-lateral", "Seitheben", 3, 12, 15, 1, 75),
      exercise("b-biceps", "Bizepscurls", 2, 10, 15, 1, 75),
    ],
  },
];

function exercise(id, name, sets, minReps, maxReps, increment, restSeconds) {
  return { id, name, sets, minReps, maxReps, increment, restSeconds, defaultWeight: 0, cues: TECHNIQUE_HINTS[id] || [] };
}

const state = {
  screen: "home", activeSession: null, selectedSession: null, editing: null,
  showTechnique: false, showNumericEditor: false, numericField: "weight", showSkipReasons: false,
  expandedVersions: null, restTimerEnabled: true, toast: "", busy: false,
};
let database;
let renderSequence = 0;

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaktion abgebrochen"));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["plans", "sessions", "sets", "planVersions"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onblocked = () => reject(new Error("Datenbank-Update blockiert. Bitte andere offene Trainingslog-Tabs schließen und neu laden."));
    req.onerror = () => reject(req.error);
  });
}

function getOne(store, key) {
  return requestAsPromise(database.transaction(store).objectStore(store).get(key));
}

function getAll(store) {
  return requestAsPromise(database.transaction(store).objectStore(store).getAll());
}

async function putOne(store, item) {
  const tx = database.transaction(store, "readwrite");
  const done = transactionComplete(tx);
  tx.objectStore(store).put(item);
  await done;
}

async function deleteOne(store, key) {
  const tx = database.transaction(store, "readwrite");
  const done = transactionComplete(tx);
  tx.objectStore(store).delete(key);
  await done;
}

async function saveSetAndSession(savedSet, session) {
  const tx = database.transaction(["sets", "sessions"], "readwrite");
  const done = transactionComplete(tx);
  tx.objectStore("sets").put(savedSet);
  tx.objectStore("sessions").put(session);
  await done;
}

async function deleteFinishedSession(sessionId) {
  const session = await getOne("sessions", sessionId);
  if (!session?.finishedAt) throw new Error("Nur abgeschlossene Trainingseinheiten können aus dem Verlauf gelöscht werden.");
  const tx = database.transaction(["sessions", "sets"], "readwrite");
  const done = transactionComplete(tx);
  const sessionStore = tx.objectStore("sessions");
  const setStore = tx.objectStore("sets");
  const cursorRequest = setStore.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    if (cursor.value.sessionId === sessionId) cursor.delete();
    cursor.continue();
  };
  sessionStore.delete(sessionId);
  await done;
}

async function seedPlans() {
  if ((await getAll("plans")).length) return;
  const tx = database.transaction("plans", "readwrite");
  const done = transactionComplete(tx);
  examplePlans.forEach((plan) => tx.objectStore("plans").put({ ...plan, version: 1, updatedAt: new Date().toISOString() }));
  await done;
}

async function ensurePlanVersions() {
  for (const original of await getAll("plans")) {
    const plan = { ...original, version: original.version || 1, updatedAt: original.updatedAt || new Date().toISOString() };
    if (!original.version) await putOne("plans", plan);
    const id = `${plan.id}:v${plan.version}`;
    if (!(await getOne("planVersions", id))) {
      await putOne("planVersions", { id, planId: plan.id, version: plan.version, createdAt: plan.updatedAt, snapshot: structuredClone(plan) });
    }
  }
}

async function savePlanRevision(changedPlan) {
  const current = await getOne("plans", changedPlan.id);
  const next = { ...changedPlan, version: (current?.version || 1) + 1, updatedAt: new Date().toISOString() };
  const revision = { id: `${next.id}:v${next.version}`, planId: next.id, version: next.version, createdAt: next.updatedAt, snapshot: structuredClone(next) };
  const tx = database.transaction(["plans", "planVersions"], "readwrite");
  const done = transactionComplete(tx);
  tx.objectStore("plans").put(next);
  tx.objectStore("planVersions").put(revision);
  await done;
  return next;
}

async function planForSession(session) {
  return session.planSnapshot || getOne("plans", session.planId);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function n(value) { return Number(value).toLocaleString("de-DE", { maximumFractionDigits: 2 }); }
function date(value) { return new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }); }
function clock(value) { return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); }
function uid() { return crypto.randomUUID(); }
function completedFor(sets, exerciseId) { return sets.filter((set) => set.exerciseId === exerciseId).length; }
function bestPrevious(sets, exerciseId, currentSessionId) {
  return sets.filter((set) => set.exerciseId === exerciseId && set.sessionId !== currentSessionId)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
}
function mostRecent(sets, exerciseId) {
  return sets.filter((set) => set.exerciseId === exerciseId)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
}
function toast(message) { state.toast = message; }
function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
function getSavedSettings() {
  try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || "{}"); }
  catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify({ restTimerEnabled: state.restTimerEnabled })); }
  catch { /* Training und Datenspeicherung funktionieren auch ohne diese Einstellung. */ }
}

function progressionSuggestion(exercise, session, allSets, allSessions) {
  const finished = allSessions.filter((entry) => entry.finishedAt && entry.id !== session.id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const lastSession = finished.find((entry) => allSets.some((set) => set.sessionId === entry.id && set.exerciseId === exercise.id));
  if (!lastSession || lastSession.skippedExercises?.[exercise.id] || lastSession.endedExercises?.[exercise.id]) return null;
  const records = allSets.filter((set) => set.sessionId === lastSession.id && set.exerciseId === exercise.id);
  if (records.length !== exercise.sets || records.some((set) => set.reps < exercise.maxReps)) return null;
  const weights = records.map((set) => set.weight);
  if (!weights.every((weight) => weight > 0 && weight === weights[0])) return null;
  return Math.round((weights[0] + exercise.increment) * 100) / 100;
}

async function startWorkout(planId) {
  const unfinished = (await getAll("sessions")).find((session) => !session.finishedAt);
  if (unfinished) {
    state.activeSession = unfinished;
    state.screen = "workout";
    toast("Dein laufendes Training wurde fortgesetzt.");
    await render();
    return;
  }
  const plan = await getOne("plans", planId);
  if (!plan || !plan.exercises.length) return;
  const previousSets = await getAll("sets");
  const last = mostRecent(previousSets, plan.exercises[0].id);
  const session = {
    id: uid(), planId, planName: plan.name, planSnapshot: structuredClone(plan),
    startedAt: new Date().toISOString(), skippedExercises: {}, endedExercises: {},
    finishedAt: null, exerciseIndex: 0, setIndex: 0, restUntil: 0,
    pending: { weight: last?.weight ?? plan.exercises[0].defaultWeight ?? 0, reps: last?.reps ?? plan.exercises[0].minReps },
  };
  await putOne("sessions", session);
  state.activeSession = session;
  state.screen = "workout";
  toast("Training gestartet – jeder Satz wird sofort gespeichert.");
  await render();
}

async function selectExercise(index) {
  const plan = await planForSession(state.activeSession);
  if (!plan.exercises[index]) return;
  const exercise = plan.exercises[index];
  const sets = (await getAll("sets")).filter((set) => set.sessionId === state.activeSession.id && set.exerciseId === exercise.id);
  const firstOpen = Array.from({ length: exercise.sets }, (_, i) => i).find((i) => !sets.some((set) => set.setNumber === i + 1));
  await setCursor(index, firstOpen ?? exercise.sets - 1);
}

async function setCursor(exerciseIndex, setIndex) {
  const session = state.activeSession;
  const plan = await planForSession(session);
  const exercise = plan.exercises[exerciseIndex];
  if (!exercise || setIndex < 0 || setIndex >= exercise.sets) return;
  const sets = await getAll("sets");
  const sameSession = sets.filter((set) => set.sessionId === session.id && set.exerciseId === exercise.id);
  const saved = sameSession.find((set) => set.setNumber === setIndex + 1);
  const previous = sameSession.filter((set) => set.setNumber < setIndex + 1).sort((a, b) => b.setNumber - a.setNumber)[0]
    ?? bestPrevious(sets, exercise.id, session.id);
  session.exerciseIndex = exerciseIndex;
  session.setIndex = setIndex;
  session.pending = {
    weight: saved?.weight ?? previous?.weight ?? exercise.defaultWeight ?? 0,
    reps: saved?.reps ?? previous?.reps ?? exercise.minReps,
  };
  state.showTechnique = false;
  state.showSkipReasons = false;
  state.showNumericEditor = false;
  await putOne("sessions", session);
  await render();
}

async function stepSet(direction) {
  const session = state.activeSession;
  const plan = await planForSession(session);
  if (session.exerciseIndex >= plan.exercises.length) {
    if (direction < 0 && plan.exercises.length) {
      const index = plan.exercises.length - 1;
      await setCursor(index, plan.exercises[index].sets - 1);
    }
    return;
  }
  const exercise = plan.exercises[session.exerciseIndex];
  const target = (session.setIndex ?? 0) + direction;
  if (target >= 0 && target < exercise.sets) return setCursor(session.exerciseIndex, target);
  const nextExerciseIndex = session.exerciseIndex + direction;
  if (nextExerciseIndex >= 0 && nextExerciseIndex < plan.exercises.length) {
    return setCursor(nextExerciseIndex, direction > 0 ? 0 : plan.exercises[nextExerciseIndex].sets - 1);
  }
  if (direction > 0) {
    session.exerciseIndex = plan.exercises.length;
    session.setIndex = 0;
    await putOne("sessions", session);
    await render();
  }
}

async function updatePending(field, delta) {
  const session = state.activeSession;
  const plan = await planForSession(session);
  const exercise = plan.exercises[session.exerciseIndex];
  if (!exercise) return;
  const current = Number(session.pending[field] || 0);
  const step = field === "weight" ? exercise.increment : 1;
  const limit = field === "weight" ? 1000 : 100;
  session.pending[field] = Math.round(clamp(current + step * delta, field === "weight" ? 0 : 1, limit) * 100) / 100;
  await putOne("sessions", session);
  await render();
}

async function saveCurrentSet() {
  const session = state.activeSession;
  const plan = await planForSession(session);
  const exercise = plan.exercises[session.exerciseIndex];
  if (!exercise) return;
  if (session.skippedExercises?.[exercise.id]) { toast("Übung zuerst wieder aktivieren."); await render(); return; }
  if (session.endedExercises?.[exercise.id]) { toast("Übung zuerst wieder fortsetzen."); await render(); return; }
  const allSets = await getAll("sets");
  const sessionSets = allSets.filter((set) => set.sessionId === session.id);
  const setNumber = (session.setIndex ?? completedFor(sessionSets, exercise.id)) + 1;
  if (setNumber > exercise.sets) return;
  const existing = sessionSets.find((set) => set.exerciseId === exercise.id && set.setNumber === setNumber);

  const savedSet = {
    id: `${session.id}:${exercise.id}:${setNumber}`, sessionId: session.id, exerciseId: exercise.id,
    exerciseName: exercise.name, planName: plan.name, setNumber,
    weight: Number(session.pending.weight), reps: Number(session.pending.reps),
    savedAt: existing?.savedAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const next = structuredClone(session);
  next.restUntil = state.restTimerEnabled && exercise.restSeconds > 0 ? Date.now() + exercise.restSeconds * 1000 : 0;
  if (setNumber < exercise.sets) {
    next.setIndex = setNumber;
    const nextSaved = sessionSets.find((set) => set.exerciseId === exercise.id && set.setNumber === setNumber + 1);
    next.pending = { weight: nextSaved?.weight ?? savedSet.weight, reps: nextSaved?.reps ?? savedSet.reps };
  } else {
    next.exerciseIndex = session.exerciseIndex + 1;
    next.setIndex = 0;
    const followingExercise = plan.exercises[next.exerciseIndex];
    if (followingExercise) {
      const prior = sessionSets.find((set) => set.exerciseId === followingExercise.id && set.setNumber === 1)
        ?? bestPrevious(allSets, followingExercise.id, session.id);
      next.pending = { weight: prior?.weight ?? followingExercise.defaultWeight ?? 0, reps: prior?.reps ?? followingExercise.minReps };
    }
  }
  await saveSetAndSession(savedSet, next);
  state.activeSession = next;
  toast(`Satz ${setNumber} ${existing ? "aktualisiert" : "gespeichert"} ✓`);
  await render();
}

async function undoLastSet() {
  const session = state.activeSession;
  const plan = await planForSession(session);
  const sets = (await getAll("sets")).filter((set) => set.sessionId === session.id)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
  if (!sets.length) return;
  const last = sets[0];
  const index = plan.exercises.findIndex((exercise) => exercise.id === last.exerciseId);
  if (index < 0) return;
  const updated = structuredClone(session);
  updated.exerciseIndex = index;
  updated.setIndex = last.setNumber - 1;
  updated.pending = { weight: last.weight, reps: last.reps };
  updated.restUntil = 0;
  if (updated.endedExercises?.[last.exerciseId]) delete updated.endedExercises[last.exerciseId];
  const tx = database.transaction(["sets", "sessions"], "readwrite");
  const done = transactionComplete(tx);
  tx.objectStore("sets").delete(last.id);
  tx.objectStore("sessions").put(updated);
  await done;
  state.activeSession = updated;
  toast("Letzten Satz rückgängig gemacht.");
  await render();
}

async function markExerciseSkipped(reason) {
  const session = state.activeSession;
  const plan = await planForSession(session);
  const exercise = plan.exercises[session.exerciseIndex];
  if (!exercise) return;
  const completed = completedFor((await getAll("sets")).filter((set) => set.sessionId === session.id), exercise.id);
  if (completed > 0) {
    state.showSkipReasons = false;
    toast(completed >= exercise.sets ? "Diese Übung ist schon vollständig absolviert." : "Bereits begonnen? Nutze ‚Übung vorzeitig beenden‘.");
    await render();
    return;
  }
  session.skippedExercises ||= {};
  session.skippedExercises[exercise.id] = { reason: reason || "Ohne Angabe", at: new Date().toISOString() };
  state.showSkipReasons = false;
  session.restUntil = 0;
  await putOne("sessions", session);
  toast(`${exercise.name} für heute ausgelassen.`);
  const nextIndex = session.exerciseIndex + 1;
  if (nextIndex < plan.exercises.length) await selectExercise(nextIndex);
  else {
    session.exerciseIndex = nextIndex;
    session.setIndex = 0;
    await putOne("sessions", session);
    await render();
  }
}

async function endExerciseEarly(reason) {
  const session = state.activeSession;
  const plan = await planForSession(session);
  const exercise = plan.exercises[session.exerciseIndex];
  if (!exercise) return;
  const count = completedFor((await getAll("sets")).filter((set) => set.sessionId === session.id), exercise.id);
  if (!count || count >= exercise.sets) {
    state.showSkipReasons = false;
    toast("Nur eine bereits begonnene, noch offene Übung lässt sich vorzeitig beenden.");
    await render();
    return;
  }
  session.endedExercises ||= {};
  session.endedExercises[exercise.id] = { reason: reason || "Ohne Angabe", at: new Date().toISOString() };
  session.restUntil = 0;
  state.showSkipReasons = false;
  await putOne("sessions", session);
  toast(`${exercise.name}: ${count} von ${exercise.sets} Sätzen gespeichert.`);
  const nextIndex = session.exerciseIndex + 1;
  if (nextIndex < plan.exercises.length) await selectExercise(nextIndex);
  else {
    session.exerciseIndex = nextIndex;
    session.setIndex = 0;
    await putOne("sessions", session);
    await render();
  }
}

async function reactivateExercise() {
  const session = state.activeSession;
  const plan = await planForSession(session);
  const exercise = plan.exercises[session.exerciseIndex];
  if (!exercise) return;
  delete session.skippedExercises?.[exercise.id];
  delete session.endedExercises?.[exercise.id];
  await putOne("sessions", session);
  toast("Übung kann wieder fortgesetzt werden.");
  await render();
}

async function saveDirectNumber(field, value) {
  if (!["weight", "reps"].includes(field)) return;
  const number = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(number) ||
      (field === "weight" && (number < 0 || number > 1000)) ||
      (field === "reps" && (!Number.isInteger(number) || number < 1 || number > 100))) {
    alert(field === "weight" ? "Bitte ein gültiges Gewicht zwischen 0 und 1000 kg eingeben." : "Bitte ganze Wiederholungen zwischen 1 und 100 eingeben.");
    return;
  }
  state.activeSession.pending[field] = field === "weight" ? Math.round(number * 100) / 100 : number;
  await putOne("sessions", state.activeSession);
  state.showNumericEditor = false;
  await render();
}
async function saveDirectWeight(value) { return saveDirectNumber("weight", value); }
async function saveDirectReps(value) { return saveDirectNumber("reps", value); }

async function finishWorkout() {
  const session = state.activeSession;
  session.finishedAt = new Date().toISOString();
  session.restUntil = 0;
  await putOne("sessions", session);
  state.activeSession = null;
  state.screen = "history";
  state.selectedSession = session.id;
  toast("Training abgeschlossen. Stark gemacht!");
  await render();
}

function topbar() {
  return `<header class="topbar"><div class="brand"><div class="brand-mark">✚</div><div><div class="brand-name">Trainingslog</div><div class="brand-sub">VERSION ${APP_VERSION} · OFFLINE</div></div></div><span class="offline-badge">● Lokal gespeichert</span></header>`;
}
function navigation() {
  const items = [["home", "⌂", "Start"], ["history", "▥", "Verlauf"], ["plans", "☷", "Pläne"], ["more", "⋯", "Mehr"]];
  return `<nav class="nav" aria-label="Hauptnavigation">${items.map(([key, icon, label]) => `<button data-act="navigate" data-screen="${key}" class="${state.screen === key || (["workout", "summary"].includes(state.screen) && key === "home") || (["data", "about", "settings", "help"].includes(state.screen) && key === "more") ? "active" : ""}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join("")}</nav>`;
}
function homeScreen(plans, sessions, sets) {
  const active = sessions.find((session) => !session.finishedAt);
  const total = sessions.filter((session) => session.finishedAt).length;
  return `<div class="eyebrow">DEIN NÄCHSTES TRAINING</div><h1 class="h1">Los geht's,<br>Jörg.</h1><p class="lead">Weniger tippen. Mehr trainieren. Alle Daten bleiben auf deinem Gerät.</p>
    ${active ? `<div class="card card-pad stack" style="margin-bottom:19px"><span class="pill pill-green">● Training läuft</span><div class="big">${escapeHtml(active.planName)}</div><div class="small muted">Begonnen am ${date(active.startedAt)} um ${clock(active.startedAt)} Uhr</div><button class="btn btn-primary btn-full" data-act="resume">Training fortsetzen →</button></div>` : ""}
    <div class="stack">${plans.map((plan, index) => `<button class="card plan-card" data-act="start" data-plan="${escapeHtml(plan.id)}"><div class="row"><span class="plan-letter">${index === 0 ? "A" : "B"}</span><span class="arrow">↗</span></div><div class="plan-name">${escapeHtml(plan.name)}</div><div class="muted small">${escapeHtml(plan.focus)} · ${plan.exercises.length} Übungen</div><div class="tag">${active ? "Laufendes Training fortsetzen" : "Training starten →"}</div></button>`).join("")}</div>
    <div class="intro-note">Die Übungen sind vorläufige Beispiele. Deinen echten A/B-Plan übernehmen wir anschließend über den Bereich „Pläne“.</div>
    <div class="row card card-pad"><div><div class="big">${total}</div><div class="muted small">abgeschlossene Trainings</div></div><div><div class="big">${sets.length}</div><div class="muted small">gespeicherte Sätze</div></div></div>`;
}

function workoutScreen(plan, session, allSets, allSessions = []) {
  if (!plan) return '<div class="empty">Dieser Trainingsplan fehlt. Prüfe deine Datensicherung.</div>';
  const sessionSets = allSets.filter((set) => set.sessionId === session.id);
  const completed = plan.exercises.reduce((sum, ex) => sum + completedFor(sessionSets, ex.id), 0);
  const planned = plan.exercises.reduce((sum, ex) => sum + ex.sets, 0);
  const exercise = plan.exercises[session.exerciseIndex];
  const overview = `<div class="overview"><div><div class="eyebrow">${escapeHtml(plan.name)} · V${plan.version || 1}</div><div class="small muted">${completed} / ${planned} Sätze gespeichert</div></div><button class="btn btn-small btn-outline-accent" data-act="show-summary">Abschluss ↗</button></div>`;
  const tabs = `<div class="exercise-selector"><div class="helper exercise-selector-label">ÜBUNGEN AUSWÄHLEN</div><div class="exercise-tabs">${plan.exercises.map((ex, index) => {
    const count = completedFor(sessionSets, ex.id), skipped = session.skippedExercises?.[ex.id], ended = session.endedExercises?.[ex.id];
    return `<button class="exercise-chip ${session.exerciseIndex === index ? "active" : ""} ${count >= ex.sets ? "complete" : ""} ${skipped || ended ? "skipped" : ""}" data-act="select-exercise" data-index="${index}" aria-label="${escapeHtml(ex.name)}">${skipped ? "–" : ended ? "◐" : count >= ex.sets ? "✓" : index + 1}</button>`;
  }).join("")}</div></div>`;
  const timer = session.restUntil ? `<section class="timer compact-timer" aria-label="Satzpause"><div class="timer-label">◷ Pause <strong class="timer-value" data-timer="${session.restUntil}">--:--</strong></div><div class="timer-actions"><button class="btn btn-small btn-secondary" data-act="extend-timer">+30 Sek.</button><button class="btn btn-small btn-ghost" data-act="stop-timer">Pause beenden</button></div></section>` : "";
  if (!exercise) return `<div class="workout-screen">${overview}${tabs}<div class="card card-pad stack workout-ended"><span class="pill pill-green">Ende des Plans</span><div class="big">Alle Übungen durchlaufen.</div><p class="small muted">${completed} von ${planned} Sätzen gespeichert.</p><button class="btn btn-primary btn-large" data-act="show-summary">Abschluss prüfen →</button><button class="btn btn-ghost" data-act="step-set" data-direction="-1">← Letzten Satz ansehen</button></div>${timer}</div>`;
  const count = completedFor(sessionSets, exercise.id);
  const setIndex = Math.min(session.setIndex ?? count, exercise.sets - 1);
  const saved = sessionSets.find((set) => set.exerciseId === exercise.id && set.setNumber === setIndex + 1);
  const skipped = session.skippedExercises?.[exercise.id], ended = session.endedExercises?.[exercise.id];
  const previous = bestPrevious(allSets, exercise.id, session.id);
  const suggestion = !count && !skipped && !ended ? progressionSuggestion(exercise, session, allSets, allSessions) : null;
  const cues = Array.isArray(exercise.cues) ? exercise.cues.filter(Boolean).slice(0, 3) : [];
  const technique = state.showTechnique ? `<div class="cues">${cues.length ? cues.map((cue) => `<div class="cue"><span class="cue-dot">●</span>${escapeHtml(cue)}</div>`).join("") : '<span class="helper">Unter „Pläne“ kannst du Hinweise hinterlegen.</span>'}</div>` : "";
  const status = skipped ? `Ausgefallen · ${escapeHtml(skipped.reason)}` : ended ? `Vorzeitig beendet: ${count}/${exercise.sets} · ${escapeHtml(ended.reason)}` : saved ? "✓ Satz gespeichert – Änderungen möglich" : previous ? `Letztes Training: ${n(previous.weight)} kg × ${previous.reps}` : "Noch kein vorheriger Trainingswert";
  const header = `<section class="card card-pad exercise-head"><div class="exercise-meta"><span class="eyebrow">ÜBUNG ${session.exerciseIndex + 1} / ${plan.exercises.length}</span><span class="pill">Satz ${setIndex + 1} / ${exercise.sets}</span></div><div class="exercise-heading"><h2 class="exercise-title">${escapeHtml(exercise.name)}</h2><button class="info-btn ${state.showTechnique ? "active" : ""}" data-act="toggle-technique" aria-label="Technikhinweise anzeigen" aria-expanded="${state.showTechnique}">ⓘ</button></div><div class="target">Zielbereich: ${exercise.minReps}–${exercise.maxReps} Wiederholungen</div>${technique}<div class="progress">${Array.from({ length: exercise.sets }, (_, i) => `<span class="${sessionSets.some((set) => set.exerciseId === exercise.id && set.setNumber === i + 1) ? "done" : i === setIndex ? "active" : ""}"></span>`).join("")}</div><div class="prior">${status}</div>${suggestion != null ? `<div class="suggestion">↗ Steigerung möglich: ${n(suggestion)} kg – nur bei sauberer Ausführung</div>` : ""}</section>`;
  const counter = (field, label, value) => `<div class="counter-card"><div class="counter-label">${label}</div><button class="counter-number" data-act="open-number" data-field="${field}" aria-label="${label.toLowerCase()} direkt eingeben"><span class="number-main">${value}${field === "weight" ? '<em>kg</em>' : ""}</span><span class="edit-hint"><span class="edit-icon" aria-hidden="true">✎</span> Direkt eingeben</span></button><div class="counter-controls"><button class="btn" data-act="decrement" data-field="${field}" aria-label="${label} verringern">−</button><button class="btn" data-act="increment" data-field="${field}" aria-label="${label} erhöhen">+</button></div></div>`;
  const secondary = `<details class="workout-more"><summary>⋯ Weitere Aktionen</summary><div class="workout-more-actions"><div class="helper">Gewichtsschritt ${n(exercise.increment)} kg · Pause ${exercise.restSeconds} Sek.</div><button class="btn btn-ghost btn-full btn-small" data-act="undo" ${sessionSets.length ? "" : "disabled"}>↶ Letzten Satz löschen</button><button class="btn btn-ghost btn-full btn-small" data-act="next-exercise">Übung später →</button>${count < exercise.sets ? `<button class="btn btn-danger-soft btn-full btn-small" data-act="open-skip">${count ? "Übung vorzeitig beenden" : "Übung ausfallen lassen"}</button>` : ""}</div></details>`;
  const controls = `<div class="grid-two workout-counters">${counter("weight", "GEWICHT", n(session.pending.weight))}${counter("reps", "WIEDERHOLUNGEN", session.pending.reps)}</div><div class="workout-controls"><button class="btn btn-primary btn-full btn-large" data-act="save-set">✓ ${saved ? "Satz aktualisieren" : "Satz speichern"}</button>${timer}<div class="actions step-actions"><button class="btn btn-secondary" data-act="step-set" data-direction="-1" ${session.exerciseIndex === 0 && setIndex === 0 ? "disabled" : ""}>← Zurück</button><button class="btn btn-secondary" data-act="step-set" data-direction="1">Weiter →</button></div></div>${secondary}`;
  const main = skipped || ended ? `<div class="card card-pad stack workout-ended"><span class="pill pill-warning">${ended ? "Übung vorzeitig beendet" : "Übung ausgefallen"}</span><p class="small muted">${ended ? `${count} von ${exercise.sets} Sätzen absolviert.` : "Kein Satz absolviert."} Grund: ${escapeHtml((ended || skipped).reason)}.</p><button class="btn btn-secondary btn-full" data-act="reactivate-exercise">Übung ${ended ? "fortsetzen" : "doch durchführen"}</button><button class="btn btn-ghost btn-full" data-act="next-exercise">Weiter zur nächsten Übung →</button></div>` : controls;
  const field = state.numericField === "reps" ? "reps" : "weight";
  const numericModal = state.showNumericEditor ? `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Zahl eingeben"><div class="row"><strong>${field === "weight" ? "Gewicht (kg)" : "Wiederholungen"} eingeben</strong><button class="btn btn-small btn-ghost" data-act="close-number">×</button></div><form id="number-form" class="stack" style="margin-top:15px"><input type="hidden" name="field" value="${field}"><label class="field">${field === "weight" ? "Kilogramm" : "Anzahl Wiederholungen"}<input id="number-input" name="number" inputmode="${field === "weight" ? "decimal" : "numeric"}" type="text" value="${field === "weight" ? n(session.pending.weight) : session.pending.reps}" required autocomplete="off"></label><button class="btn btn-primary btn-full">Übernehmen</button></form></div></div>` : "";
  const early = count > 0 && count < exercise.sets;
  const skipModal = state.showSkipReasons ? `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Übung beenden"><div class="row"><strong>${early ? `Nach ${count} von ${exercise.sets} Sätzen beenden?` : "Übung heute ausfallen lassen?"}</strong><button class="btn btn-small btn-ghost" data-act="cancel-skip">×</button></div><p class="helper">${early ? "Alle bereits gespeicherten Sätze bleiben erhalten." : "Die Übung wird als nicht absolviert gespeichert."} Wähle einen Grund:</p><div class="reason-grid">${END_REASONS.map((reason) => `<button class="btn btn-secondary" data-act="${early ? "confirm-end" : "confirm-skip"}" data-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`).join("")}</div></div></div>` : "";
  return `<div class="workout-screen">${overview}${tabs}${header}${main}</div>${numericModal}${skipModal}`;
}

function summaryScreen(plan, session, allSets) {
  const sessionSets = allSets.filter((set) => set.sessionId === session.id);
  const items = plan.exercises.map((exercise) => {
    const count = completedFor(sessionSets, exercise.id);
    const skipped = session.skippedExercises?.[exercise.id];
    const ended = session.endedExercises?.[exercise.id];
    return { exercise, count, skipped, ended, done: count >= exercise.sets };
  });
  const incomplete = items.filter((item) => !item.done && !item.skipped && !item.ended).length;
  const details = items.map((item, index) => {
    const stateClass = item.done ? "ok" : item.ended ? "partial" : item.skipped ? "skip" : "open";
    const symbol = item.done ? "✓" : item.ended ? "◐" : item.skipped ? "–" : "○";
    const status = item.ended ? ` · Vorzeitig beendet: ${escapeHtml(item.ended.reason)}` : item.skipped ? ` · Ausgefallen: ${escapeHtml(item.skipped.reason)}` : "";
    return `<button class="list-item" data-act="summary-exercise" data-index="${index}"><span class="summary-symbol ${stateClass}">${symbol}</span><div style="flex:1"><div class="list-item-title">${escapeHtml(item.exercise.name)}</div><div class="list-item-desc">${item.count}/${item.exercise.sets} Sätze${status}</div></div><span class="tag">›</span></button>`;
  }).join("");
  return `<div class="eyebrow">TRAININGSABSCHLUSS</div><h1 class="h1">Dein Training.</h1><p class="lead">Prüfe kurz, ob alle Übungen erfasst sind.</p><div class="card card-pad stack"><div class="row"><span class="strong">${escapeHtml(plan.name)}</span><span class="pill">Version ${plan.version || 1}</span></div><div class="row"><div><div class="big">${sessionSets.length}</div><div class="helper">gespeicherte Sätze</div></div><div><div class="big">${items.filter((item) => item.done).length}/${items.length}</div><div class="helper">Übungen vollständig</div></div></div></div><div class="section-title">Übungen im Überblick</div><div class="card card-pad">${details}</div>${incomplete ? `<div class="intro-note warning">${incomplete} Übung${incomplete !== 1 ? "en" : ""} noch offen. Du kannst zurückkehren oder trotzdem abschließen.</div>` : '<div class="intro-note">Alle Übungen sind abgeschlossen, ausgefallen oder bewusst vorzeitig beendet.</div>'}<div class="stack"><button class="btn btn-primary btn-full btn-large" data-act="finish-confirm">${incomplete ? "Trotzdem abschließen ✓" : "Training abschließen ✓"}</button><button class="btn btn-secondary btn-full" data-act="return-workout">← Zurück zum Training</button></div>`;
}

function progressChart(allSets, sessions) {
  if (!allSets.length) return "";
  const exercises = [...new Map(allSets.map((set) => [set.exerciseId, set.exerciseName])).entries()];
  const selected = state.progressExercise && exercises.some(([id]) => id === state.progressExercise) ? state.progressExercise : exercises[0][0];
  state.progressExercise = selected;
  const records = sessions.filter((session) => session.finishedAt).map((session) => {
    const matching = allSets.filter((set) => set.sessionId === session.id && set.exerciseId === selected);
    return matching.length ? { date: session.startedAt, weight: Math.max(...matching.map((set) => set.weight)) } : null;
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  const highest = Math.max(1, ...records.map((item) => item.weight));
  return `<section class="card card-pad" style="margin-top:19px"><div class="row"><div class="strong">Gewichtsverlauf</div><span class="pill">max. Arbeitsgewicht</span></div><label class="field" style="margin-top:12px">Übung<select id="progress-exercise">${exercises.map(([id, name]) => `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>${records.length ? `<div class="bars">${records.map((item) => `<div class="bar-col"><div class="bar-value">${n(item.weight)}</div><div class="bar" style="height:${Math.max(5, item.weight / highest * 78)}%"></div><div class="bar-label">${new Date(item.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</div></div>`).join("")}</div><p class="helper">Höchstes Gewicht je abgeschlossener Einheit (kg)</p>` : `<div class="empty">Für diese Übung gibt es noch keine abgeschlossenen Trainings.</div>`}</section>`;
}

function endedHistoryRows(session, allSets) {
  return Object.entries(session.endedExercises || {}).map(([exerciseId, ended]) => {
    const exercise = session.planSnapshot?.exercises.find((ex) => ex.id === exerciseId);
    const count = allSets.filter((set) => set.sessionId === session.id && set.exerciseId === exerciseId).length;
    return `<div class="data-row"><div><div class="small strong">${escapeHtml(exercise?.name || exerciseId)}</div><div class="tiny muted">${count}/${exercise?.sets || "?"} Sätze · Vorzeitig beendet: ${escapeHtml(ended.reason)}</div></div><span class="pill pill-warning">Teilweise</span></div>`;
  }).join("");
}

function historyScreen(sessions, allSets) {
  const finished = sessions.filter((session) => session.finishedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const selected = finished.find((session) => session.id === state.selectedSession);
const details = selected ? `<div class="card card-pad" style="margin-top:13px"><div class="row"><strong>${escapeHtml(selected.planName)} · V${selected.planSnapshot?.version || 1}</strong><span class="small muted">${date(selected.startedAt)}</span></div>${allSets.filter((set) => set.sessionId === selected.id).sort((a, b) => a.savedAt.localeCompare(b.savedAt)).map((set) => `<div class="data-row"><div><div class="small strong">${escapeHtml(set.exerciseName)} · Satz ${set.setNumber}</div><div class="tiny muted">${clock(set.savedAt)}</div></div><span class="strong small">${n(set.weight)} kg × ${set.reps}</span></div>`).join("")}${Object.entries(selected.skippedExercises || {}).map(([exerciseId, skipped]) => `<div class="data-row"><div><div class="small strong">${escapeHtml(selected.planSnapshot?.exercises.find((ex) => ex.id === exerciseId)?.name || exerciseId)}</div><div class="tiny muted">Ausgefallen: ${escapeHtml(skipped.reason)}</div></div><span class="pill pill-warning">Ausfall</span></div>`).join("")}${endedHistoryRows(selected, allSets)}<button class="btn btn-danger-soft btn-full history-delete" data-act="delete-history-session" data-id="${escapeHtml(selected.id)}">Trainingseinheit löschen</button></div>` : "";
  return `<div class="eyebrow">DEINE TRAININGSDATEN</div><h1 class="h1">Verlauf.</h1><p class="lead">Alle abgeschlossenen Einheiten und deine Entwicklung auf einen Blick.</p>
    <div class="card card-pad"><div class="row"><div><div class="big">${finished.length}</div><div class="small muted">Trainingseinheiten</div></div><div><div class="big">${allSets.length}</div><div class="small muted">gespeicherte Sätze</div></div></div></div>
    ${progressChart(allSets, sessions)}<div class="section-title">Trainingseinheiten</div><div class="card card-pad">${finished.length ? finished.map((session) => `<button class="list-item" data-act="history-detail" data-id="${escapeHtml(session.id)}"><div><div class="list-item-title">${escapeHtml(session.planName)}</div><div class="list-item-desc">${date(session.startedAt)} · ${clock(session.startedAt)} Uhr · ${allSets.filter((set) => set.sessionId === session.id).length} Sätze</div></div><span class="tag">${state.selectedSession === session.id ? "▲" : "▼"}</span></button>`).join("") : `<div class="empty">Hier erscheint nach deinem ersten Training die Historie.</div>`}</div>${details}`;
}

function plansScreen(plans, versions = []) {
  const edited = state.editing;
  return `<div class="eyebrow">FLEXIBLE TRAININGSPLÄNE</div><h1 class="h1">Pläne.</h1><p class="lead">Übungen bearbeiten, austauschen und in eine neue Reihenfolge bringen.</p>
    <div class="intro-note">Jede Planänderung erstellt automatisch eine neue Version. Vergangene Trainingseinheiten behalten ihren damaligen Plan.</div>
    ${plans.map((plan) => `<section class="card card-pad" style="margin-bottom:14px"><div class="row"><div class="big">${escapeHtml(plan.name)}</div><span class="pill">Version ${plan.version || 1}</span></div>${plan.exercises.map((ex, index) => `<div class="data-row"><div><div class="list-item-title">${index + 1}. ${escapeHtml(ex.name)}</div><div class="list-item-desc">${ex.sets} × ${ex.minReps}–${ex.maxReps} · ${n(ex.increment)} kg Schritte</div></div><div class="item-actions"><button class="btn btn-small btn-ghost" data-act="move-exercise" data-plan="${escapeHtml(plan.id)}" data-index="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Übung nach oben">↑</button><button class="btn btn-small btn-ghost" data-act="move-exercise" data-plan="${escapeHtml(plan.id)}" data-index="${index}" data-direction="1" ${index === plan.exercises.length - 1 ? "disabled" : ""} aria-label="Übung nach unten">↓</button><button class="btn btn-small btn-secondary" data-act="edit-exercise" data-plan="${escapeHtml(plan.id)}" data-exercise="${escapeHtml(ex.id)}">Ändern</button></div></div>`).join("")}<button class="btn btn-ghost btn-full" style="margin-top:13px" data-act="add-exercise" data-plan="${escapeHtml(plan.id)}">+ Übung hinzufügen</button><button class="btn btn-ghost btn-full" style="margin-top:9px" data-act="toggle-versions" data-plan="${escapeHtml(plan.id)}">${state.expandedVersions === plan.id ? "Versionen ausblenden" : "Planversionen ansehen"} (${versions.filter((version) => version.planId === plan.id).length})</button>${state.expandedVersions === plan.id ? `<div class="versions">${versions.filter((version) => version.planId === plan.id).sort((a, b) => b.version - a.version).map((version) => `<div class="data-row"><div><div class="small strong">Version ${version.version}${version.version === plan.version ? " · Aktiv" : ""}</div><div class="tiny muted">${date(version.createdAt)} · ${version.snapshot.exercises.length} Übungen</div></div>${version.version !== plan.version ? `<button class="btn btn-small btn-secondary" data-act="restore-version" data-id="${escapeHtml(version.id)}">Wiederherstellen</button>` : `<span class="tag">Aktuell</span>`}</div>`).join("")}</div>` : ""}</section>`).join("")}
    ${edited ? editForm(plans, edited) : ""}`;
}

function editForm(plans, edited) {
  const plan = plans.find((item) => item.id === edited.planId);
  if (!plan) return "";
  const ex = plan.exercises.find((item) => item.id === edited.exerciseId) || exercise("", "", 3, 8, 12, 2.5, 90);
  return `<section class="card card-pad" id="edit-panel" style="margin-top:14px"><div class="row"><div class="h2">${edited.exerciseId ? "Übung bearbeiten" : "Übung hinzufügen"}</div><button class="btn btn-ghost btn-small" data-act="cancel-edit">Schließen</button></div><form id="exercise-form" data-plan="${escapeHtml(plan.id)}" data-exercise="${escapeHtml(ex.id)}" class="form-grid">
    <label class="field full">Übungsname<input name="name" required maxlength="80" value="${escapeHtml(ex.name)}" placeholder="z. B. Brustpresse"></label>
    <label class="field">Sätze<input name="sets" type="number" min="1" max="15" required value="${ex.sets}"></label>
    <label class="field">Startgewicht (kg)<input name="defaultWeight" type="number" min="0" max="1000" step="0.25" required value="${ex.defaultWeight}"></label>
    <label class="field">Wdh. von<input name="minReps" type="number" min="1" max="100" required value="${ex.minReps}"></label>
    <label class="field">Wdh. bis<input name="maxReps" type="number" min="1" max="100" required value="${ex.maxReps}"></label>
    <label class="field">Gewichtsschritt (kg)<select name="increment">${[0.5,1,1.25,2,2.5,5,10].map((increment) => `<option value="${increment}" ${increment === ex.increment ? "selected" : ""}>${n(increment)} kg</option>`).join("")}</select></label>
    <label class="field">Pause (Sek.)<input name="restSeconds" type="number" min="0" max="600" step="15" required value="${ex.restSeconds}"></label>
    <label class="field full">Technikhinweise (maximal drei Zeilen)<textarea name="cues" rows="3" maxlength="400" placeholder="Ein kurzer Hinweis pro Zeile">${escapeHtml((ex.cues || TECHNIQUE_HINTS[ex.id] || []).join("\n"))}</textarea></label>
    ${edited.exerciseId ? `<label class="check-field full"><input type="checkbox" name="newIdentity" value="yes"><span>Als <strong>neue Übung</strong> behandeln (eigene Gewichtshistorie, z. B. beim Gerätewechsel)</span></label>` : ""}
    <button type="submit" class="btn btn-primary full">Übung speichern</button>${edited.exerciseId ? `<button type="button" class="btn btn-danger full" data-act="delete-exercise" data-plan="${escapeHtml(plan.id)}" data-exercise="${escapeHtml(ex.id)}">Übung entfernen</button>` : ""}
    </form></section>`;
}

function dataScreen(sessions, sets) {
  const completed = sessions.filter((session) => session.finishedAt).length;
  return `<div class="eyebrow">DEINE DATEN GEHÖREN DIR</div><h1 class="h1">Sichern.</h1><p class="lead">Exportiere Sätze und Ausfälle nach Excel oder sichere Pläne, Versionen und Historie vollständig.</p>
    <div class="card card-pad stack"><div class="row"><div class="big">${completed}</div><div class="small muted">abgeschlossene Einheiten</div></div><div class="row"><div class="big">${sets.length}</div><div class="small muted">gespeicherte Sätze</div></div></div>
    <div class="section-title">Export</div><div class="stack"><button class="btn btn-primary btn-full" data-act="export-csv">↓ CSV für Excel exportieren</button><button class="btn btn-secondary btn-full" data-act="export-json">↓ Vollständiges JSON-Backup</button></div>
    <div class="section-title">Wiederherstellen</div><div class="card card-pad stack"><div class="small muted">Mit einem früheren Backup kannst du Pläne und Trainingshistorie wiederherstellen.</div><button class="btn btn-ghost btn-full" data-act="choose-import">↑ JSON-Backup importieren</button><input id="backup-file" class="file-input" type="file" accept="application/json,.json"><div class="helper warning">Achtung: Ein Import ersetzt nach deiner Bestätigung alle derzeitigen Daten. Sichere sie vorher!</div></div>
    <div class="section-title">Offline-Hinweis</div><div class="intro-note">Du brauchst zum Trainieren keine Internetverbindung. iCloud Drive und OneDrive können später als freiwilliger Ablageort für exportierte Backups dienen, sind aber nicht Teil der App-Datenbank.</div>`;
}

function moreScreen() {
  const items = [
    ["data", "⇩", "Daten & Backup", "CSV, Sicherung und Wiederherstellung"],
    ["settings", "⚙", "Einstellungen", "Pausentimer und Übungsparameter"],
    ["help", "?", "Hilfe", "Kurzanleitung für das Training"],
    ["about", "ⓘ", "Über die App", "Version, Datenschutz und Credits"],
  ];
  return `<div class="eyebrow">TRAININGSLOG</div><h1 class="h1">Mehr.</h1><p class="lead">Alles Wichtige außerhalb der Trainingserfassung.</p><div class="card card-pad">${items.map(([screen, icon, title, description]) => `<button class="list-item" data-act="navigate" data-screen="${screen}"><span class="more-icon">${icon}</span><span class="more-text"><span class="list-item-title">${title}</span><span class="list-item-desc">${description}</span></span><span class="tag">›</span></button>`).join("")}</div>`;
}
function moreBack() {
  return '<button class="btn btn-small btn-ghost more-back" data-act="navigate" data-screen="more">← Mehr</button>';
}
function aboutScreen() {
  return `${moreBack()}<div class="eyebrow">ÜBER DIE APP</div><h1 class="h1">Trainingslog.</h1><div class="card card-pad stack about-card"><span class="pill pill-green">Version ${APP_VERSION} · Offline</span><div class="about-mark">✚</div><div class="big">Entwickelt für Jörg Kloweit</div><p class="small muted">Dein persönlicher Trainingsbegleiter – mit ❤️ und KI entwickelt.</p></div><div class="section-title">Privat bleibt privat</div><div class="intro-note">Alle Trainingsdaten liegen ausschließlich auf deinem Gerät. Keine Cloud, kein Tracking, kein Benutzerkonto. Exportierte Sicherungen kannst du selbst verwahren.</div>`;
}
function settingsScreen() {
  return `${moreBack()}<div class="eyebrow">DEINE EINSTELLUNGEN</div><h1 class="h1">Einstellungen.</h1><div class="card card-pad stack"><div class="row"><div><div class="strong">Pausentimer automatisch starten</div><p class="small muted settings-desc">Nach dem Speichern eines Satzes die Satzpause anzeigen.</p></div><button class="btn btn-small ${state.restTimerEnabled ? "btn-primary" : "btn-secondary"}" data-act="toggle-rest-setting" aria-pressed="${state.restTimerEnabled}">${state.restTimerEnabled ? "An" : "Aus"}</button></div></div><div class="section-title">Je Übung festlegen</div><div class="intro-note">Pausendauer und Gewichtsschritte stellst du individuell im Trainingsplan ein. So können beispielsweise Beinpresse und Seitheben unterschiedliche Pausen haben.</div><button class="btn btn-secondary btn-full" data-act="navigate" data-screen="plans">Zu den Trainingsplänen →</button>`;
}
function helpScreen() {
  return `${moreBack()}<div class="eyebrow">KURZ & KLAR</div><h1 class="h1">Hilfe.</h1><div class="card card-pad stack help-list"><div><strong>Satz speichern</strong><p class="small muted">Gewicht und Wiederholungen einstellen, dann den grünen Button drücken. Der nächste Satz wird automatisch ausgewählt.</p></div><div><strong>Zurück / Weiter</strong><p class="small muted">Damit blätterst du durch die Sätze. Nur „Satz speichern“ legt einen Eintrag ab.</p></div><div><strong>⋯ Weitere Aktionen</strong><p class="small muted">Übung ausfallen lassen, vorzeitig beenden oder zunächst überspringen. Bereits erfasste Sätze bleiben bestehen.</p></div><div><strong>ⓘ Technik</strong><p class="small muted">Zeigt kurze Hinweise zur ausgewählten Übung.</p></div><div><strong>Offline</strong><p class="small muted">Nach der ersten vollständigen Installation läuft die App auch ohne Empfang. Sichere deine Daten gelegentlich unter „Mehr → Daten & Backup“.</p></div></div>`;
}

async function render() {
  const current = ++renderSequence;
  const [plans, sessions, sets, versions] = await Promise.all([getAll("plans"), getAll("sessions"), getAll("sets"), getAll("planVersions")]);
  if (current !== renderSequence) return;
  let content;
  if (["workout", "summary"].includes(state.screen) && state.activeSession) {
    const plan = state.activeSession.planSnapshot || plans.find((item) => item.id === state.activeSession.planId);
    content = state.screen === "summary" ? summaryScreen(plan, state.activeSession, sets) : workoutScreen(plan, state.activeSession, sets, sessions);
  } else if (state.screen === "history") content = historyScreen(sessions, sets);
  else if (state.screen === "plans") content = plansScreen(plans, versions);
  else if (state.screen === "data") content = dataScreen(sessions, sets);
  else if (state.screen === "more") content = moreScreen();
  else if (state.screen === "settings") content = settingsScreen();
  else if (state.screen === "about") content = aboutScreen();
  else if (state.screen === "help") content = helpScreen();
  else content = homeScreen(plans, sessions, sets);
  document.getElementById("app").innerHTML = `<div class="shell ${state.screen === "workout" ? "workout-shell" : ""}">${topbar()}${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}<main>${content}</main></div>${navigation()}`;
  state.toast = "";
  updateTimer();
  if (state.editing) document.getElementById("edit-panel")?.scrollIntoView({ block: "nearest" });
}

function updateTimer() {
  const element = document.querySelector("[data-timer]");
  if (!element) return;
  const seconds = Math.max(0, Math.ceil((Number(element.dataset.timer) - Date.now()) / 1000));
  element.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  element.classList.toggle("timer-ended", seconds === 0);
}

async function saveExercise(form) {
  const plan = await getOne("plans", form.dataset.plan);
  if (!plan) throw new Error("Trainingsplan nicht gefunden.");
  const values = Object.fromEntries(new FormData(form));
  const originalId = form.dataset.exercise;
  const newExercise = {
    id: values.newIdentity === "yes" ? uid() : originalId || uid(), name: String(values.name).trim(),
    sets: Number(values.sets), minReps: Number(values.minReps), maxReps: Number(values.maxReps),
    defaultWeight: Number(values.defaultWeight), increment: Number(values.increment), restSeconds: Number(values.restSeconds),
    cues: String(values.cues ?? "").split(/\r?\n/).map((cue) => cue.trim().slice(0, 160)).filter(Boolean).slice(0, 3),
  };
  if (!newExercise.name || !Number.isFinite(newExercise.defaultWeight) || newExercise.minReps > newExercise.maxReps) {
    alert("Bitte Namen, Gewicht und Wiederholungsbereich prüfen."); return;
  }
  const index = plan.exercises.findIndex((ex) => ex.id === originalId);
  if (index >= 0) plan.exercises[index] = newExercise;
  else plan.exercises.push(newExercise);
  await savePlanRevision(plan);
  state.editing = null;
  toast("Übung gespeichert.");
  await render();
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function csvValue(value) {
  const string = String(value ?? "");
  return `"${string.replaceAll('"', '""')}"`;
}

async function exportCsv() {
  const sets = (await getAll("sets")).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  const sessions = await getAll("sessions");
  const lines = ["sep=;", ["Datum", "Uhrzeit", "Trainingsplan", "Übung", "Typ", "Satz", "Gewicht_kg", "Wiederholungen", "Volumen_kg", "Grund"].join(";")];
  sets.forEach((set) => lines.push([
    date(set.savedAt), clock(set.savedAt), set.planName, set.exerciseName, "Satz",
    set.setNumber, n(set.weight), set.reps, n(set.weight * set.reps), "",
  ].map(csvValue).join(";")));
  sessions.forEach((session) => Object.entries(session.skippedExercises || {}).forEach(([exerciseId, skipped]) => {
    const name = session.planSnapshot?.exercises.find((ex) => ex.id === exerciseId)?.name || exerciseId;
    lines.push([date(skipped.at), clock(skipped.at), session.planName, name, "Ausfall", "", "", "", "", skipped.reason].map(csvValue).join(";"));
  }));
  sessions.forEach((session) => Object.entries(session.endedExercises || {}).forEach(([exerciseId, ended]) => {
    const exercise = session.planSnapshot?.exercises.find((ex) => ex.id === exerciseId);
    const count = sets.filter((set) => set.sessionId === session.id && set.exerciseId === exerciseId).length;
    lines.push([date(ended.at), clock(ended.at), session.planName, exercise?.name || exerciseId, "Vorzeitig beendet", `${count}/${exercise?.sets || "?"}`, "", "", "", ended.reason].map(csvValue).join(";"));
  }));
  download(`trainingslog-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${lines.join("\r\n")}`, "text/csv;charset=utf-8");
  toast("CSV-Export erstellt."); await render();
}

async function exportJson() {
  const [plans, sessions, sets, planVersions] = await Promise.all([getAll("plans"), getAll("sessions"), getAll("sets"), getAll("planVersions")]);
  const backup = { format: "trainingslog-backup", version: 2, exportedAt: new Date().toISOString(), plans, sessions, sets, planVersions, settings: { restTimerEnabled: state.restTimerEnabled } };
  download(`trainingslog-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
  toast("Backup erstellt. Speichere es an einem sicheren Ort."); await render();
}

async function importJson(file) {
  let backup;
  try { backup = JSON.parse(await file.text()); }
  catch { alert("Diese Datei ist keine gültige JSON-Datei."); return; }
  if (backup?.format !== "trainingslog-backup" || ![1, 2].includes(backup?.version) ||
      !Array.isArray(backup.plans) || !Array.isArray(backup.sessions) || !Array.isArray(backup.sets) ||
      (backup.version === 2 && (!Array.isArray(backup.planVersions) || backup.planVersions.some((version) => !version.id || !version.planId || !Array.isArray(version.snapshot?.exercises)))) ||
      backup.plans.length !== 2 || backup.plans.some((p) => !p.id || !Array.isArray(p.exercises)) ||
      backup.sessions.some((s) => !s.id || !s.planId) || backup.sets.some((s) => !s.id || !s.sessionId || !s.exerciseId || !Number.isFinite(s.weight))) {
    alert("Das Backup-Format ist ungültig oder wird nicht unterstützt."); return;
  }
  if (!confirm(`Backup vom ${backup.exportedAt ? date(backup.exportedAt) : "unbekannten Datum"} einspielen?\n\nAlle derzeitigen Pläne und Trainingsdaten werden dadurch ERSETZT. Bitte vorher selbst ein Backup exportieren.`)) return;
  const restoredVersions = backup.version === 2 ? backup.planVersions : backup.plans.map((plan) => {
    const snapshot = { ...plan, version: plan.version || 1 };
    return { id: `${plan.id}:v${snapshot.version}`, planId: plan.id, version: snapshot.version, createdAt: backup.exportedAt || new Date().toISOString(), snapshot };
  });
  const data = { plans: backup.plans, sessions: backup.sessions, sets: backup.sets, planVersions: restoredVersions };
  const tx = database.transaction(["plans", "sessions", "sets", "planVersions"], "readwrite");
  const done = transactionComplete(tx);
  for (const name of ["plans", "sessions", "sets", "planVersions"]) {
    const store = tx.objectStore(name);
    store.clear();
    data[name].forEach((item) => store.add(item));
  }
  await done;
  await ensurePlanVersions();
  if (typeof backup.settings?.restTimerEnabled === "boolean") {
    state.restTimerEnabled = backup.settings.restTimerEnabled;
    saveSettings();
  }
  state.activeSession = await hydrateActiveSession((backup.sessions.find((session) => !session.finishedAt)) || null);
  state.selectedSession = null;
  state.screen = "home";
  toast("Backup erfolgreich wiederhergestellt.");
  await render();
}

async function hydrateActiveSession(session) {
  if (!session) return null;
  let changed = false;
  if (!session.planSnapshot) {
    const plan = await getOne("plans", session.planId);
    if (plan) { session.planSnapshot = structuredClone(plan); changed = true; }
  }
  if (!session.skippedExercises) { session.skippedExercises = {}; changed = true; }
  if (!session.endedExercises) { session.endedExercises = {}; changed = true; }
  if (!Number.isInteger(session.setIndex)) {
    const currentExercise = session.planSnapshot?.exercises[session.exerciseIndex];
    if (currentExercise) {
      const sets = (await getAll("sets")).filter((set) => set.sessionId === session.id);
      session.setIndex = Math.min(completedFor(sets, currentExercise.id), currentExercise.sets - 1);
    } else session.setIndex = 0;
    changed = true;
  }
  if (changed) await putOne("sessions", session);
  return session;
}

async function handleAction(button) {
  const act = button.dataset.act;
  switch (act) {
    case "navigate": state.screen = button.dataset.screen; state.editing = null; await render(); break;
    case "start": await startWorkout(button.dataset.plan); break;
    case "resume": state.screen = "workout"; await render(); break;
    case "increment": await updatePending(button.dataset.field, 1); break;
    case "decrement": await updatePending(button.dataset.field, -1); break;
    case "save-set": await saveCurrentSet(); break;
    case "toggle-technique": state.showTechnique = !state.showTechnique; await render(); break;
    case "open-number": state.numericField = button.dataset.field === "reps" ? "reps" : "weight"; state.showNumericEditor = true; await render(); document.getElementById("number-input")?.focus(); break;
    case "close-number": state.showNumericEditor = false; await render(); break;
    case "open-skip": state.showSkipReasons = true; await render(); break;
    case "cancel-skip": state.showSkipReasons = false; await render(); break;
    case "confirm-skip": await markExerciseSkipped(button.dataset.reason); break;
    case "confirm-end": await endExerciseEarly(button.dataset.reason); break;
    case "reactivate-exercise": await reactivateExercise(); break;
    case "show-summary": state.screen = "summary"; await render(); break;
    case "return-workout": state.screen = "workout"; await render(); break;
    case "summary-exercise": state.screen = "workout"; await selectExercise(Number(button.dataset.index)); break;
    case "finish-confirm": await finishWorkout(); break;
    case "select-exercise": await selectExercise(Number(button.dataset.index)); break;
    case "step-set": await stepSet(Number(button.dataset.direction)); break;
    case "next-exercise": {
      const plan = await planForSession(state.activeSession);
      if (state.activeSession.exerciseIndex < plan.exercises.length) {
        const nextIndex = state.activeSession.exerciseIndex + 1;
        if (nextIndex < plan.exercises.length) await selectExercise(nextIndex);
        else { state.activeSession.exerciseIndex = nextIndex; state.activeSession.setIndex = 0; await putOne("sessions", state.activeSession); await render(); }
      }
      break;
    }
    case "stop-timer": state.activeSession.restUntil = 0; await putOne("sessions", state.activeSession); await render(); break;
    case "extend-timer": state.activeSession.restUntil = Math.max(Date.now(), state.activeSession.restUntil || 0) + 30000; await putOne("sessions", state.activeSession); await render(); break;
    case "undo": await undoLastSet(); break;
    case "toggle-rest-setting": state.restTimerEnabled = !state.restTimerEnabled; saveSettings(); toast(`Pausentimer ${state.restTimerEnabled ? "aktiviert" : "deaktiviert"}.`); await render(); break;
    case "finish": state.screen = "summary"; await render(); break;
    case "history-detail": state.selectedSession = state.selectedSession === button.dataset.id ? null : button.dataset.id; await render(); break;
    case "delete-history-session": {
      const session = await getOne("sessions", button.dataset.id);
      if (!session?.finishedAt) { toast("Trainingseinheit nicht gefunden."); await render(); break; }
      if (!confirm(`Training vom ${date(session.startedAt)} endgültig löschen?\\n\\nDie Trainingseinheit und alle zugehörigen Sätze werden unwiderruflich gelöscht.\\n\\nAbbrechen = behalten · OK = endgültig löschen`)) break;
      await deleteFinishedSession(session.id);
      state.selectedSession = null;
      toast("Trainingseinheit und zugehörige Sätze gelöscht.");
      await render();
      break;
    }
    case "edit-exercise": state.editing = { planId: button.dataset.plan, exerciseId: button.dataset.exercise }; await render(); break;
    case "add-exercise": state.editing = { planId: button.dataset.plan, exerciseId: null }; await render(); break;
    case "cancel-edit": state.editing = null; await render(); break;
    case "move-exercise": {
      const plan = await getOne("plans", button.dataset.plan);
      const index = Number(button.dataset.index), nextIndex = index + Number(button.dataset.direction);
      if (nextIndex < 0 || nextIndex >= plan.exercises.length) break;
      [plan.exercises[index], plan.exercises[nextIndex]] = [plan.exercises[nextIndex], plan.exercises[index]];
      await savePlanRevision(plan); toast("Reihenfolge gespeichert – neue Planversion erstellt."); await render(); break;
    }
    case "toggle-versions": state.expandedVersions = state.expandedVersions === button.dataset.plan ? null : button.dataset.plan; await render(); break;
    case "restore-version": {
      const version = await getOne("planVersions", button.dataset.id);
      if (!version || !confirm(`Planversion ${version.version} als neue aktive Version wiederherstellen? Deine Trainingshistorie bleibt erhalten.`)) break;
      const plan = await getOne("plans", version.planId);
      await savePlanRevision({ ...plan, exercises: structuredClone(version.snapshot.exercises), focus: version.snapshot.focus });
      toast(`Planversion ${version.version} als neue Version wiederhergestellt.`); await render(); break;
    }
    case "delete-exercise": {
      if (!confirm("Übung aus dem Plan entfernen? Frühere Trainingsdaten bleiben erhalten.")) break;
      const plan = await getOne("plans", button.dataset.plan);
      if (plan.exercises.length <= 1) { alert("Jeder Plan muss mindestens eine Übung behalten."); break; }
      plan.exercises = plan.exercises.filter((ex) => ex.id !== button.dataset.exercise);
      await savePlanRevision(plan); state.editing = null; await render(); break;
    }
    case "export-csv": await exportCsv(); break;
    case "export-json": await exportJson(); break;
    case "choose-import": document.getElementById("backup-file")?.click(); break;
    default: break;
  }
}

async function initialize() {
  if (!("indexedDB" in window)) throw new Error("IndexedDB wird auf diesem Gerät nicht unterstützt.");
  const settings = getSavedSettings();
  if (typeof settings.restTimerEnabled === "boolean") state.restTimerEnabled = settings.restTimerEnabled;
  database = await openDatabase();
  await seedPlans();
  await ensurePlanVersions();
  const unfinished = (await getAll("sessions")).filter((s) => !s.finishedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
  state.activeSession = await hydrateActiveSession(unfinished);
  await render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Offline-Cache konnte nicht aktiviert werden:", error));
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

document.getElementById("app").addEventListener("submit", async (event) => {
  if (!["exercise-form", "number-form"].includes(event.target.id)) return;
  event.preventDefault();
  if (state.busy) return;
  state.busy = true;
  try {
    if (event.target.id === "number-form") {
      const form = new FormData(event.target);
      await saveDirectNumber(form.get("field"), form.get("number"));
    }
    else await saveExercise(event.target);
  }
  catch (error) { console.error(error); alert(`Speichern fehlgeschlagen: ${error.message}`); }
  finally { state.busy = false; }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-act]");
  if (!button || state.busy) return;
  state.busy = true;
  try { await handleAction(button); }
  catch (error) { console.error(error); alert(`Aktion fehlgeschlagen: ${error.message}`); }
  finally { state.busy = false; }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "progress-exercise") { state.progressExercise = event.target.value; await render(); }
  if (event.target.id === "backup-file" && event.target.files?.[0]) {
    try { await importJson(event.target.files[0]); }
    catch (error) { console.error(error); alert(`Import fehlgeschlagen: ${error.message}`); }
  }
});

setInterval(updateTimer, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateTimer(); });

initialize().catch((error) => {
  console.error(error);
  document.getElementById("app").innerHTML = `<div class="shell"><h1 class="h1">App konnte nicht gestartet werden</h1><p class="error">${escapeHtml(error.message)}</p><p>Bitte im Safari-Web-App-Fenster öffnen und ausreichend Gerätespeicher freigeben.</p></div>`;
});
