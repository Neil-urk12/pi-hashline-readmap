import { afterEach, beforeEach, describe, expect, it } from "vitest";
import init from "../index.js";

interface Harness {
	handlers: Record<string, (event: unknown, ctx: unknown) => unknown>;
	notifications: Array<{ message: string; level: string }>;
}

function createHarness(): Harness {
	const notifications: Array<{ message: string; level: string }> = [];
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};

	try {
		init({
			registerTool() {},
			on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers[event] = handler;
			},
			events: { emit() {}, on() {} },
		} as any);
	} catch (err) {
		throw new Error(
			`init() threw in test harness: ${err instanceof Error ? err.message : String(err)}\n` +
				`registered handlers so far: ${Object.keys(handlers).join(", ") || "(none)"}`,
		);
	}

	return {
		handlers,
		get notifications() {
			return notifications;
		},
	};
}

async function fireSessionStart(harness: Harness) {
	const handler = harness.handlers["session_start"];
	if (!handler) throw new Error("session_start handler was not registered");
	const ctx = {
		ui: {
			notify(message: string, level: string) {
				harness.notifications.push({ message, level });
			},
		},
	};
	await handler({}, ctx);
}

describe("PI_HASHLINE_DEBUG session_start notification", () => {
	const originalEnv = process.env.PI_HASHLINE_DEBUG;

	beforeEach(() => {
		delete process.env.PI_HASHLINE_DEBUG;
	});
	afterEach(() => {
		if (originalEnv === undefined) delete process.env.PI_HASHLINE_DEBUG;
		else process.env.PI_HASHLINE_DEBUG = originalEnv;
	});

	it("emits no notification when PI_HASHLINE_DEBUG is unset", async () => {
		const harness = createHarness();
		await fireSessionStart(harness);
		expect(harness.notifications).toEqual([]);
	});

	it("emits a notification when PI_HASHLINE_DEBUG=1", async () => {
		process.env.PI_HASHLINE_DEBUG = "1";
		const harness = createHarness();
		await fireSessionStart(harness);
		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]).toMatchObject({
			message: expect.stringMatching(/hashline.*readmap.*active/i),
			level: "info",
		});
	});

	it("emits a notification when PI_HASHLINE_DEBUG=true", async () => {
		process.env.PI_HASHLINE_DEBUG = "true";
		const harness = createHarness();
		await fireSessionStart(harness);
		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0].level).toBe("info");
	});

	it("does not emit for unrelated values like '0' or 'yes'", async () => {
		process.env.PI_HASHLINE_DEBUG = "0";
		const harness1 = createHarness();
		await fireSessionStart(harness1);
		expect(harness1.notifications).toEqual([]);

		process.env.PI_HASHLINE_DEBUG = "yes";
		const harness2 = createHarness();
		await fireSessionStart(harness2);
		expect(harness2.notifications).toEqual([]);
	});
});
