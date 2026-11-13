import { describe, expect, it } from "vitest";
import ref from "../../../backend/tests/fixtures/who_cvd_stata_reference.json";
import { tenYearRisk, type Calibration } from "@/services/risk/whoCvd";

type Row = { age: number; sex: "male" | "female"; sbp: number; bmi: number; smoking: boolean; calibration: Calibration; expected: number };

/** The phone's WHO 2019 model must reproduce WHO's reference Stata implementation too. */
describe("WHO 2019 non-lab CVD model", () => {
  it.each((ref.rows as Row[]).map((r, i) => [i, r] as const))("reference %i", (_, r) => {
    expect(tenYearRisk(r.age, r.sex, r.sbp, r.bmi, r.smoking, r.calibration)).toBeCloseTo(r.expected, 6);
  });
});
