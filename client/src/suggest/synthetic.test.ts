import { describe, it, expect } from "vitest";
import { createSyntheticAgent, mergeSyntheticAgent } from "./synthetic";
import type { PublicFeed, PublicAgent } from "../../../shared/demo/public";

describe("synthetic agent logic", () => {
  it("creates a synthetic agent with correct id and initial state", () => {
    const agent = createSyntheticAgent(42, "alpha", "Got it. I received your suggestion and I will take care of it.");
    expect(agent.id).toBe("suggest-42");
    expect(agent.product).toBe("alpha");
    expect(agent.state).toBe("running");
    expect(agent.label).toContain("Got it.");
  });

  it("merges synthetic agent into an empty feed", () => {
    const feed: PublicFeed = {
      builtAt: "2026-11-12T12:00:00Z",
      products: { alpha: { name: "Alpha" } },
      agents: [],
    };
    const synthetic = createSyntheticAgent(1, "alpha", "Starting");
    const merged = mergeSyntheticAgent(feed, synthetic);

    expect(merged.agents).toHaveLength(1);
    expect(merged.agents[0].id).toBe("suggest-1");
  });

  it("merges synthetic agent alongside existing agents", () => {
    const existing: PublicAgent = {
      id: "agent-1",
      parent: null,
      product: "alpha",
      state: "idle",
      provider: "claude",
      label: "Sleeping",
    };
    const feed: PublicFeed = {
      builtAt: "2026-11-12T12:00:00Z",
      products: { alpha: { name: "Alpha" } },
      agents: [existing],
    };

    const synthetic = createSyntheticAgent(2, "alpha", "Working");
    const merged = mergeSyntheticAgent(feed, synthetic);

    expect(merged.agents).toHaveLength(2);
    expect(merged.agents.map((a) => a.id)).toEqual(["agent-1", "suggest-2"]);
  });

  it("updates existing synthetic agent instead of duplicating", () => {
    const initial = createSyntheticAgent(2, "alpha", "Label 1");
    const feed: PublicFeed = {
      builtAt: "2026-11-12T12:00:00Z",
      products: { alpha: { name: "Alpha" } },
      agents: [initial],
    };

    const updated = { ...initial, label: "Label 2" };
    const merged = mergeSyntheticAgent(feed, updated);

    expect(merged.agents).toHaveLength(1);
    expect(merged.agents[0].label).toBe("Label 2");
  });

  it("returns feed unchanged if synthetic agent is null", () => {
    const feed: PublicFeed = {
      builtAt: "2026-11-12T12:00:00Z",
      products: { alpha: { name: "Alpha" } },
      agents: [],
    };
    expect(mergeSyntheticAgent(feed, null)).toBe(feed);
  });
});
