import assert from "node:assert/strict";
import test from "node:test";
import { patchSentence, patchSystemPrompt } from "../src/omp.ts";

const OFFENDING_SENTENCE =
	"RFC 2119: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. `NEVER` = `MUST NOT`; `AVOID` = `SHOULD NOT`.";
const REPLACED_SENTENCE =
	"Guidelines: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. NEVER means MUST NOT; AVOID means SHOULD NOT.";

test("patches only the exact RFC 2119 normative sentence", () => {
	assert.equal(patchSentence(OFFENDING_SENTENCE), REPLACED_SENTENCE);

	const fullPrompt = `You are an agent.\n${OFFENDING_SENTENCE}\nFollow instructions carefully.`;
	const expectedPrompt = `You are an agent.\n${REPLACED_SENTENCE}\nFollow instructions carefully.`;
	assert.equal(patchSentence(fullPrompt), expectedPrompt);

	const otherRfc = "RFC 2119 defines keywords for use in RFCs to indicate requirement levels.";
	assert.equal(patchSentence(otherRfc), otherRfc);

	const arbitrary = "MUST and NEVER can appear in normal sentences without triggering rewrite.";
	assert.equal(patchSentence(arbitrary), arbitrary);
});

test("handles segmented system prompts preserving string array structure", () => {
	assert.equal(patchSystemPrompt(undefined), undefined);

	assert.equal(patchSystemPrompt(OFFENDING_SENTENCE), REPLACED_SENTENCE);

	const segments = [
		"Segment 1: Base instructions",
		OFFENDING_SENTENCE,
		"Segment 3: Native tool rules",
	];
	const patched = patchSystemPrompt(segments);
	assert.ok(Array.isArray(patched));
	assert.equal(patched.length, 3);
	assert.equal(patched[0], "Segment 1: Base instructions");
	assert.equal(patched[1], REPLACED_SENTENCE);
	assert.equal(patched[2], "Segment 3: Native tool rules");
});
