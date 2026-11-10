// Einfache Logiktests ohne Browser oder externe npm-Pakete.
// Start im Projektordner: node tests/navigation.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const listenerStart = source.indexOf('document.getElementById("app").addEventListener("submit"');
assert(listenerStart > 0, "App-Einstiegspunkt nicht gefunden");

const context = vm.createContext({
  crypto: webcrypto,
  structuredClone,
  Date,
  console,
  confirm: () => true,
  alert: (message) => { throw new Error(message); },
  navigator: {},
  document: {},
});
vm.runInContext(source.slice(0, listenerStart), context);

const api = vm.runInContext(`
  const memory = { plans: structuredClone(examplePlans), sessions: [], sets: [], planVersions: [] };
  getOne = async (store, id) => structuredClone(memory[store].find((item) => item.id === id));
  getAll = async (store) => structuredClone(memory[store]);
  putOne = async (store, item) => {
    const index = memory[store].findIndex((old) => old.id === item.id);
    if (index < 0) memory[store].push(structuredClone(item));
    else memory[store][index] = structuredClone(item);
  };
  saveSetAndSession = async (set, session) => {
    await putOne("sets", set);
    await putOne("sessions", session);
  };
  database = { transaction: () => {
    const transaction = {
      objectStore: (name) => ({
        put: (item) => {
          const index = memory[name].findIndex((old) => old.id === item.id);
          if (index < 0) memory[name].push(structuredClone(item));
          else memory[name][index] = structuredClone(item);
        },
        add: (item) => memory[name].push(structuredClone(item)),
        clear: () => { memory[name] = []; },
      }),
    };
    Promise.resolve().then(() => transaction.oncomplete?.());
    return transaction;
  } };
  render = async () => {};
  download = (name, content) => { globalThis.downloadedBackup = { name, content }; };
  globalThis.testApi = { memory, state, startWorkout, saveCurrentSet, stepSet,
    selectExercise, updatePending, workoutScreen, markExerciseSkipped,
    endExerciseEarly, reactivateExercise, saveDirectWeight, saveDirectReps,
    summaryScreen, progressionSuggestion, moreScreen, aboutScreen, settingsScreen,
    ensurePlanVersions, savePlanRevision, plansScreen, exportJson, importJson,
    getBackup: () => globalThis.downloadedBackup };
  globalThis.testApi;
`, context);

(async () => {
  await api.startWorkout("plan-a");
  assert.equal(api.state.activeSession.setIndex, 0);
  assert(api.workoutScreen(api.state.activeSession.planSnapshot, api.state.activeSession, [], api.memory.sessions).includes("Übung ausfallen lassen"));
  assert(api.workoutScreen(api.state.activeSession.planSnapshot, api.state.activeSession, [], api.memory.sessions).includes("ⓘ"));
  await api.updatePending("weight", 1);
  await api.saveCurrentSet();
  assert.equal(api.memory.sets.length, 1);
  assert.equal(api.state.activeSession.setIndex, 1);
  const pauseView = api.workoutScreen(api.state.activeSession.planSnapshot, api.state.activeSession, api.memory.sets, api.memory.sessions);
  assert(pauseView.includes("Pause beenden"));
  assert(pauseView.includes("+30 Sek."));

  await api.stepSet(-1);
  assert.equal(api.state.activeSession.setIndex, 0);
  assert.equal(api.state.activeSession.pending.weight, 2.5);
  const existingView = api.workoutScreen(api.memory.plans[0], api.state.activeSession, api.memory.sets);
  assert(existingView.includes("Satz aktualisieren"));
  assert(existingView.includes("Weiter →"));

  await api.stepSet(1);
  await api.stepSet(1);
  assert.equal(api.state.activeSession.setIndex, 2);
  await api.saveCurrentSet();
  assert.equal(api.state.activeSession.exerciseIndex, 1);
  assert.equal(JSON.stringify(api.memory.sets.map((set) => set.setNumber).sort()), "[1,3]");

  await api.selectExercise(0);
  assert.equal(api.state.activeSession.setIndex, 1, "Springe zum ersten nicht gespeicherten Satz");
  await api.saveCurrentSet();
  assert.equal(api.memory.sets.length, 3);
  assert.equal(api.state.activeSession.setIndex, 2);

  await api.updatePending("reps", 1);
  await api.saveCurrentSet();
  assert.equal(api.memory.sets.length, 3, "Bereits gespeicherter Satz darf nicht dupliziert werden");
  assert.equal(api.memory.sets.find((set) => set.setNumber === 3).reps, 9);
  assert.equal(api.state.activeSession.exerciseIndex, 1);

  await api.stepSet(-1);
  assert.equal(api.state.activeSession.exerciseIndex, 0);
  assert.equal(api.state.activeSession.setIndex, 2);
  const initialPlanName = api.state.activeSession.planSnapshot.exercises[0].name;
  await api.ensurePlanVersions();
  assert.equal(api.memory.planVersions.length, 2);
  const changedPlan = structuredClone(api.memory.plans[0]);
  changedPlan.exercises[0].name = "Eine neue Übung";
  await api.savePlanRevision(changedPlan);
  assert.equal(api.memory.plans[0].version, 2);
  assert.equal(api.memory.planVersions.length, 3);
  assert(api.plansScreen(api.memory.plans, api.memory.planVersions).includes("Version 2"));
  assert.equal(api.state.activeSession.planSnapshot.exercises[0].name, initialPlanName, "Aktive Einheit nutzt Schnappschuss");

  await api.selectExercise(1);
  await api.markExerciseSkipped("Gerät besetzt");
  assert.equal(api.state.activeSession.skippedExercises["a-lat"].reason, "Gerät besetzt");
  assert.equal(api.state.activeSession.exerciseIndex, 2);
  await api.selectExercise(1);
  const skippedView = api.workoutScreen(api.state.activeSession.planSnapshot, api.state.activeSession, api.memory.sets, api.memory.sessions);
  assert(skippedView.includes("Übung ausgefallen"));
  await api.reactivateExercise();
  assert.equal(api.state.activeSession.skippedExercises["a-lat"], undefined);

  await api.saveDirectWeight("42,5");
  assert.equal(api.state.activeSession.pending.weight, 42.5);
  await api.saveDirectReps("14");
  assert.equal(api.state.activeSession.pending.reps, 14);
  await assert.rejects(api.saveDirectReps("14,5"), /Bitte ganze Wiederholungen/);
  assert.equal(api.state.activeSession.pending.reps, 14, "Nur ganze Wiederholungen zulässig");
  assert(api.workoutScreen(api.state.activeSession.planSnapshot, api.state.activeSession, api.memory.sets, api.memory.sessions).includes('data-field="reps"'));
  assert(api.moreScreen().includes("Daten & Backup"));
  assert(api.aboutScreen().includes("Jörg Kloweit"));
  assert(api.settingsScreen().includes("Pausentimer automatisch"));

  await api.selectExercise(0);
  await api.markExerciseSkipped("Zeitmangel");
  assert.equal(api.state.activeSession.skippedExercises["a-chest"], undefined, "Vollständige Übung kann nicht nachträglich ausfallen");
  await api.selectExercise(1);
  await api.saveCurrentSet();
  await api.endExerciseEarly("Schmerzen/Beschwerden");
  assert.equal(api.state.activeSession.endedExercises["a-lat"].reason, "Schmerzen/Beschwerden");
  const endedOverview = api.summaryScreen(api.state.activeSession.planSnapshot, api.state.activeSession, api.memory.sets);
  assert(endedOverview.includes("Vorzeitig beendet"));
  await api.selectExercise(1);
  assert(api.workoutScreen(api.state.activeSession.planSnapshot, api.state.activeSession, api.memory.sets).includes("Übung fortsetzen"));
  await api.reactivateExercise();
  assert.equal(api.state.activeSession.endedExercises["a-lat"], undefined);

  const overview = api.summaryScreen(api.state.activeSession.planSnapshot, api.state.activeSession, api.memory.sets);
  assert(overview.includes("Trotzdem abschließen"));
  assert(overview.includes("Rudern sitzend"));

  const sourceExercise = api.state.activeSession.planSnapshot.exercises[0];
  const lastSession = { id: "old", startedAt: "2026-11-09T12:00:00Z", finishedAt: "2026-11-09T13:00:00Z" };
  const progressionSets = [1, 2, 3].map((setNumber) => ({ sessionId: "old", exerciseId: sourceExercise.id, setNumber, weight: 60, reps: 12 }));
  assert.equal(api.progressionSuggestion(sourceExercise, { id: "new" }, progressionSets, [lastSession]), 62.5);
  progressionSets[1].reps = 11;
  assert.equal(api.progressionSuggestion(sourceExercise, { id: "new" }, progressionSets, [lastSession]), null);

  await api.exportJson();
  const backup = JSON.parse(api.getBackup().content);
  assert.equal(backup.version, 2);
  assert.equal(backup.planVersions.length, 3);
  const countBeforeImport = api.memory.sets.length;
  api.memory.sets.length = 0;
  await api.importJson({ text: async () => JSON.stringify(backup) });
  assert.equal(api.memory.sets.length, countBeforeImport);
  assert.equal(api.memory.planVersions.length, 3);

  const legacy = { ...backup, version: 1 };
  delete legacy.planVersions;
  await api.importJson({ text: async () => JSON.stringify(legacy) });
  assert.equal(api.memory.sets.length, countBeforeImport);
  assert.equal(api.memory.planVersions.length, 2);
  console.log("Navigation, Planversionen, Ausfall/Teilabbruch, Zahleneingaben, Abschluss, Mehr-Menü, Progression und Backup: OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
