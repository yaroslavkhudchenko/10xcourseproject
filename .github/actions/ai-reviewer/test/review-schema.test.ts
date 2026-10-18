// The review's local check: the schema sent to the model can't carry the scores' 1-10 range, so parseReview refuses
// anything but an integer from 1 to 10 for each of them, and any answer that breaks the schema.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidReviewError, parseReview, SCORE_KEYS } from "../src/review-schema.ts";
import type { Review } from "../src/review-schema.ts";

const REVIEW: Review = {
  implementationCorrectness: 8,
  idiomaticity: 7,
  complexity: 9,
  testRiskCoverage: 6,
  documentation: 7,
  securitySafety: 10,
  verdict: "pass",
  summary: "Solid change. Add a test for the empty diff.",
};

describe("parseReview, the check every answer passes before anything reads it", () => {
  it("returns a valid review, with the fields the schema doesn't name dropped", () => {
    assert.deepEqual(parseReview({ ...REVIEW, findings: ["extra"] }), REVIEW);
  });

  it("accepts 1 and 10, the ends of the range", () => {
    assert.deepEqual(parseReview({ ...REVIEW, complexity: 1, securitySafety: 10 }), {
      ...REVIEW,
      complexity: 1,
      securitySafety: 10,
    });
  });

  for (const [why, score] of [
    ["a 0", 0],
    ["an 11", 11],
    ["a 7.5", 7.5],
  ] as const) {
    it(`refuses ${why} in each of the six scores, naming it`, () => {
      for (const key of SCORE_KEYS) {
        assert.throws(
          () => parseReview({ ...REVIEW, [key]: score }),
          (error) =>
            error instanceof InvalidReviewError && error.message === `${key} is ${score}, not an integer from 1 to 10`,
        );
      }
    });
  }

  it("refuses a review missing a field, naming it", () => {
    const { documentation: _, ...missing } = REVIEW;
    assert.throws(
      () => parseReview(missing),
      (error) => error instanceof InvalidReviewError && error.message.startsWith("documentation: "),
    );
  });

  it("refuses a verdict but pass or fail, a score that isn't a number, and an answer that isn't an object", () => {
    for (const value of [{ ...REVIEW, verdict: "maybe" }, { ...REVIEW, idiomaticity: "7" }, "pass", null]) {
      assert.throws(() => parseReview(value), InvalidReviewError);
    }
  });
});
