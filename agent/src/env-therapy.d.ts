interface TherapyAgentEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  TherapyGameAgent: DurableObjectNamespace<
    import("./therapy-agent").TherapyGameAgent
  >;
  THERAPY_SESSION_SUMMARY: Workflow<import("./therapy-schemas").SessionSummary>;
}

declare namespace Cloudflare {
  interface Env extends TherapyAgentEnv {}
}

interface Env extends TherapyAgentEnv {}
