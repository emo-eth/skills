import assert from "node:assert/strict";
import test from "node:test";
import { isAdvisorContext, patchSentence, patchSystemPrompt } from "../src/omp.ts";

const MAIN_SENTENCE =
	"RFC 2119: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. `NEVER` = `MUST NOT`; `AVOID` = `SHOULD NOT`.";
const ADVISOR_SENTENCE =
	"RFC 2119: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. `NEVER`=`MUST NOT`; `AVOID`=`SHOULD NOT`.";
const LIVE_SENTENCE =
	"RFC 2119: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. `NEVER` = `MUST NOT`.";

const REPLACED_SENTENCE =
	"Guidelines: MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. NEVER means MUST NOT; AVOID means SHOULD NOT.";

test("patches main agent, advisor, and live RFC 2119 variants", () => {
	assert.equal(patchSentence(MAIN_SENTENCE), REPLACED_SENTENCE);
	assert.equal(patchSentence(ADVISOR_SENTENCE), REPLACED_SENTENCE);
	assert.equal(patchSentence(LIVE_SENTENCE), REPLACED_SENTENCE);

	const fullPrompt = `You are an agent.\n${MAIN_SENTENCE}\nFollow instructions carefully.`;
	const expectedPrompt = `You are an agent.\n${REPLACED_SENTENCE}\nFollow instructions carefully.`;
	assert.equal(patchSentence(fullPrompt), expectedPrompt);

	const advisorPrompt = `<system-conventions>\n${ADVISOR_SENTENCE}\n</system-conventions>`;
	const expectedAdvisorPrompt = `<system-conventions>\n${REPLACED_SENTENCE}\n</system-conventions>`;
	assert.equal(patchSentence(advisorPrompt), expectedAdvisorPrompt);

	const otherRfc = "RFC 2119 defines keywords for use in RFCs to indicate requirement levels.";
	assert.equal(patchSentence(otherRfc), otherRfc);

	const arbitrary = "MUST and NEVER can appear in normal sentences without triggering rewrite.";
	assert.equal(patchSentence(arbitrary), arbitrary);
});

test("handles segmented system prompts preserving string array structure", () => {
	assert.equal(patchSystemPrompt(undefined), undefined);

	assert.equal(patchSystemPrompt(MAIN_SENTENCE), REPLACED_SENTENCE);
	assert.equal(patchSystemPrompt(ADVISOR_SENTENCE), REPLACED_SENTENCE);

	const segments = [
		"Segment 1: Base instructions",
		ADVISOR_SENTENCE,
		"Segment 3: Native tool rules",
	];
	const patched = patchSystemPrompt(segments);
	assert.ok(Array.isArray(patched));
	assert.equal(patched.length, 3);
	assert.equal(patched[0], "Segment 1: Base instructions");
	assert.equal(patched[1], REPLACED_SENTENCE);
	assert.equal(patched[2], "Segment 3: Native tool rules");
});

test("detects advisor context by tools or prompt markers", () => {
	assert.equal(isAdvisorContext({ messages: [] }), false);
	assert.equal(isAdvisorContext({ messages: [], tools: [{ name: "read", description: "", parameters: {} as any }] }), false);
	assert.equal(isAdvisorContext({ messages: [], tools: [{ name: "advise", description: "", parameters: {} as any }] }), true);

	assert.equal(
		isAdvisorContext({
			messages: [],
			systemPrompt: ["User, code-quality, robustness advocate; peer-shadow main agent."],
		}),
		true,
	);

	assert.equal(
		isAdvisorContext({
			messages: [],
			systemPrompt: "User, code-quality, robustness advocate; peer-shadow main agent." as any,
		}),
		true,
	);

	assert.equal(
		isAdvisorContext({
			messages: [],
			systemPrompt: ["Some prefix", "peer-shadow main agent", "Some suffix"],
		}),
		true,
	);
});
