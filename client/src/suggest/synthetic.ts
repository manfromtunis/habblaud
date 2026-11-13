import type { PublicAgent, PublicFeed } from "../../../shared/demo/public";

export function createSyntheticAgent(
  ideaId: number | string,
  product: string,
  label: string
): PublicAgent {
  return {
    id: `suggest-${ideaId}`,
    parent: null,
    product,
    state: "running",
    provider: "AI agent",
    since: new Date().toISOString(),
    label,
  };
}

export function mergeSyntheticAgent(
  feed: PublicFeed,
  synthetic: PublicAgent | null
): PublicFeed {
  if (!synthetic) return feed;
  const exists = feed.agents.some((a) => a.id === synthetic.id);
  const nextAgents = exists
    ? feed.agents.map((a) => (a.id === synthetic.id ? synthetic : a))
    : [...feed.agents, synthetic];

  return {
    ...feed,
    agents: nextAgents,
  };
}
