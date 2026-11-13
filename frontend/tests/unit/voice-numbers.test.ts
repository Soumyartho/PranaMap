import { describe, expect, it } from "vitest";
import { extractNumbers, parseBloodPressure, parseYesNo } from "@/services/voice/numbers";

describe("spoken numbers", () => {
  it("reads digits in all three scripts", () => {
    expect(extractNumbers("152")).toEqual([152]);
    expect(extractNumbers("१५२")).toEqual([152]);
    expect(extractNumbers("১৫২")).toEqual([152]);
  });

  it("reads English number words and decimals", () => {
    expect(extractNumbers("one hundred and fifty two")).toEqual([152]);
    expect(extractNumbers("ninety-four")).toEqual([94]);
    expect(extractNumbers("eleven point five")).toEqual([11.5]);
    expect(extractNumbers("११ दशमलव ५")).toEqual([11.5]);
  });

  it("reads blood pressure in the ways people say it", () => {
    expect(parseBloodPressure("150 over 95")).toEqual([150, 95]);
    expect(parseBloodPressure("150/95")).toEqual([150, 95]);
    expect(parseBloodPressure("१५० बटा ९५")).toEqual([150, 95]);
    expect(parseBloodPressure("১৫০ বাই ৯৫")).toEqual([150, 95]);
    expect(parseBloodPressure("one hundred forty by ninety")).toEqual([140, 90]);
    expect(parseBloodPressure("150")).toBeNull();
  });

  it("reads Hindi number words, including the colloquial forms", () => {
    expect(extractNumbers("अट्ठानवे")).toEqual([98]);
    expect(extractNumbers("अठानवे")).toEqual([98]); // as IndicConformer spells it
    expect(extractNumbers("एक सौ पचास")).toEqual([150]);
    expect(extractNumbers("डेढ़ सौ")).toEqual([150]);
    expect(extractNumbers("साढ़े ग्यारह")).toEqual([11.5]);
    expect(extractNumbers("पाँच")).toEqual([5]); // chandrabindu spelling
    expect(extractNumbers("छियानबे")).toEqual([96]); // बे spelling
    expect(parseBloodPressure("एक सौ पचास बटा पचानवे")).toEqual([150, 95]);
    expect(parseBloodPressure("एक सौ चालीस बाय नब्बे")).toEqual([140, 90]);
  });

  it("reads Bengali number words, including the colloquial forms", () => {
    expect(extractNumbers("আটানব্বই")).toEqual([98]);
    expect(extractNumbers("একশো পঞ্চাশ")).toEqual([150]);
    expect(extractNumbers("দেড়শো")).toEqual([150]);
    expect(extractNumbers("সাড়ে এগারো")).toEqual([11.5]);
    expect(extractNumbers("উনত্রিশ")).toEqual([29]); // উ / ঊ spelling
    expect(extractNumbers("পচানব্বই")).toEqual([95]); // without chandrabindu
    expect(parseBloodPressure("একশো পঞ্চাশ বাই পঁচানব্বই")).toEqual([150, 95]);
    expect(parseBloodPressure("একশো চল্লিশ ওভার নব্বই")).toEqual([140, 90]);
  });

  it("keeps separate numbers apart", () => {
    expect(extractNumbers("one hundred fifty ninety five")).toEqual([150, 95]);
    expect(extractNumbers("ninety five eighty")).toEqual([95, 80]);
    expect(extractNumbers("एक सौ बीस अस्सी")).toEqual([120, 80]);
  });

  it("reads yes and no", () => {
    expect(parseYesNo("haan")).toBe(true);
    expect(parseYesNo("हां")).toBe(true);
    expect(parseYesNo("না")).toBe(false);
    expect(parseYesNo("maybe")).toBeNull();
  });
});
