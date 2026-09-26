/* Phase 4 — API cascade verification */
const BASE = "http://localhost:3000/api/v1";

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()).data;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? " | " + detail : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? " | " + detail : ""}`); }
}

(async () => {
  // 1. systems list
  const systems = await get("/education-systems");
  check("systems count = 3", systems.length === 3);
  check("no SECONDARY_GENERAL system", !systems.some((s) => s.code === "SECONDARY_GENERAL"));
  const general = systems.find((s) => s.code === "EDUCATION_GENERAL");
  check("GENERAL has exactly 2 stages", general.stages.length === 2, general.stages.map((s) => s.code).join(","));

  // 2. grades under SECONDARY
  const secondaryStage = general.stages.find((s) => s.code === "SECONDARY");
  const grades = await get(`/stages/${secondaryStage.id}/grades`);
  check("SECONDARY stage returns exactly 3 grades", grades.length === 3, grades.map((g) => g.code).join(","));

  // 3. tracks per grade
  for (const code of ["SEC_1", "SEC_2", "SEC_3"]) {
    const g = grades.find((x) => x.code === code);
    const tracks = await get(`/grades/${g.id}/tracks`);
    const expected = code === "SEC_1" ? 0 : 3;
    check(`${code} exposes ${expected} tracks`, tracks.length === expected, tracks.map((t) => t.code).join(",") || "(none)");
  }

  // 4. subjects per grade+track (each SEC_2 track)
  const sec2 = grades.find((g) => g.code === "SEC_2");
  for (const suffix of ["SCIENCE", "MATH", "LITERARY"]) {
    const tracks = await get(`/grades/${sec2.id}/tracks`);
    const t = tracks.find((x) => x.code.endsWith(suffix));
    if (!t) { check(`subjects for SEC_2:${suffix}`, false, "track missing"); continue; }
    const subjects = await get(`/grades/${sec2.id}/subjects?trackId=${t.id}`);
    const ids = new Set(subjects.map((s) => s.id));
    check(`SEC_2:${suffix} subjects have no duplicates`, subjects.length === ids.size, `${subjects.length} rows`);
  }

  // 5. course targets endpoint for the published course
  const courseId = "f47ee0e1-fe4d-4d66-bf1c-fa7dfb4da420";
  const targets = await get(`/courses/${courseId}/targets`);
  const seen = new Set(targets.map((t) => `${t.gradeId}|${t.trackId || ""}`));
  check("course targets contain no duplicate (grade,track)", targets.length === seen.size, JSON.stringify(seen.size) + " unique");
})()
  .catch((e) => { console.error("ERROR:", e.message); fail++; })
  .finally(() => {
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
