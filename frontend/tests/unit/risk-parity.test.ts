import { describe, expect, it } from "vitest";
import cases from "../../../shared/fixtures/risk_cases.json";
import { score } from "@/services/risk/engine";
import type { ScreeningInput } from "@/models/types/risk";

/** The phone's offline score must equal the server's audit score, case for case. */
describe("risk engine parity with the Python engine", () => {
  it.each((cases as { input: ScreeningInput; output: unknown }[]).map((c, i) => [i, c] as const))("case %i", (_, c) => {
    expect(JSON.parse(JSON.stringify(score(c.input)))).toEqual(c.output);
  });
});
