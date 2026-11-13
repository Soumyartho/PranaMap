import { describe, expect, it } from "vitest";
import routingCases from "../../../shared/fixtures/routing_cases.json";
import chatCases from "../../../shared/fixtures/chat_cases.json";
import { parseLocal, route, type FacilityLite } from "@/services/routing";
import { answer, type Lang } from "@/services/chat";

type RoutingCase = {
  facilities: FacilityLite[];
  lat: number;
  lon: number;
  needs: string[];
  urgency: string;
  at_local: string;
  max_travel_minutes: number;
  output: unknown;
};

describe("offline routing matches the server", () => {
  it.each((routingCases as RoutingCase[]).map((c, i) => [i, c] as const))("case %i", (_, c) => {
    const out = route(c.facilities, c.lat, c.lon, c.needs, c.urgency, parseLocal(c.at_local), c.max_travel_minutes);
    expect(out).toEqual(c.output);
  });
});

describe("offline chatbot matches the server", () => {
  it.each((chatCases as { message: string; lang: Lang; output: unknown }[]).map((c) => [c.message, c] as const))("%s", (_, c) => {
    expect(answer(c.message, c.lang)).toEqual(c.output);
  });
});
