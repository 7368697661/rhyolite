export interface DagTemplate {
  id: string;
  name: string;
  category: "narrative" | "technical";
  description: string;
  nodes: Array<{
    tempId: string;
    title: string;
    nodeType: string;
    content: string;
    color: string;
    positionX: number;
    positionY: number;
  }>;
  edges: Array<{
    sourceTempId: string;
    targetTempId: string;
    label: string;
  }>;
}

export const builtInTemplates: DagTemplate[] = [
  {
    id: "three-act-structure",
    name: "Three-Act Structure",
    category: "narrative",
    description:
      "Classic screenplay structure: Setup, Confrontation, Resolution with key turning points.",
    nodes: [
      {
        tempId: "act1-setup",
        title: "Act I — Setup",
        nodeType: "Act",
        content: "Introduce the world, characters, and status quo.",
        color: "#7c3aed",
        positionX: 200,
        positionY: 0,
      },
      {
        tempId: "inciting-incident",
        title: "Inciting Incident",
        nodeType: "Turning Point",
        content: "The event that disrupts the status quo and launches the story.",
        color: "#8b5cf6",
        positionX: 180,
        positionY: 200,
      },
      {
        tempId: "act2-conflict",
        title: "Act II — Conflict",
        nodeType: "Act",
        content: "Rising stakes, obstacles, and character development.",
        color: "#a78bfa",
        positionX: 220,
        positionY: 400,
      },
      {
        tempId: "midpoint",
        title: "Midpoint",
        nodeType: "Turning Point",
        content: "A major revelation or reversal that raises the stakes.",
        color: "#c4b5fd",
        positionX: 160,
        positionY: 600,
      },
      {
        tempId: "act3-resolution",
        title: "Act III — Resolution",
        nodeType: "Act",
        content: "Climax and resolution of the central conflict.",
        color: "#ddd6fe",
        positionX: 200,
        positionY: 800,
      },
    ],
    edges: [
      { sourceTempId: "act1-setup", targetTempId: "inciting-incident", label: "Disrupts" },
      { sourceTempId: "inciting-incident", targetTempId: "act2-conflict", label: "Escalates" },
      { sourceTempId: "act2-conflict", targetTempId: "midpoint", label: "Shifts" },
      { sourceTempId: "midpoint", targetTempId: "act3-resolution", label: "Resolves" },
    ],
  },
  {
    id: "character-arc",
    name: "Character Arc",
    category: "narrative",
    description:
      "Tracks a character's internal transformation from status quo through catalyst to new normal.",
    nodes: [
      {
        tempId: "status-quo",
        title: "Status Quo",
        nodeType: "State",
        content: "The character's ordinary world and existing beliefs.",
        color: "#06b6d4",
        positionX: 200,
        positionY: 0,
      },
      {
        tempId: "catalyst",
        title: "Catalyst",
        nodeType: "Event",
        content: "An external event forces the character out of comfort.",
        color: "#22d3ee",
        positionX: 160,
        positionY: 200,
      },
      {
        tempId: "struggle",
        title: "Struggle",
        nodeType: "Conflict",
        content: "Internal and external resistance to change.",
        color: "#67e8f9",
        positionX: 240,
        positionY: 400,
      },
      {
        tempId: "transformation",
        title: "Transformation",
        nodeType: "Turning Point",
        content: "The character embraces a new worldview or ability.",
        color: "#a5f3fc",
        positionX: 180,
        positionY: 600,
      },
      {
        tempId: "new-normal",
        title: "New Normal",
        nodeType: "State",
        content: "The character's transformed life after the journey.",
        color: "#cffafe",
        positionX: 200,
        positionY: 800,
      },
    ],
    edges: [
      { sourceTempId: "status-quo", targetTempId: "catalyst", label: "Disrupted by" },
      { sourceTempId: "catalyst", targetTempId: "struggle", label: "Triggers" },
      { sourceTempId: "struggle", targetTempId: "transformation", label: "Leads to" },
      { sourceTempId: "transformation", targetTempId: "new-normal", label: "Establishes" },
    ],
  },
  {
    id: "research-methodology",
    name: "Research Methodology",
    category: "technical",
    description:
      "Standard research pipeline from hypothesis through data collection to conclusion.",
    nodes: [
      {
        tempId: "hypothesis",
        title: "Hypothesis",
        nodeType: "Premise",
        content: "State the research question or hypothesis.",
        color: "#f59e0b",
        positionX: 200,
        positionY: 0,
      },
      {
        tempId: "lit-review",
        title: "Literature Review",
        nodeType: "Research",
        content: "Survey existing work and identify gaps.",
        color: "#fbbf24",
        positionX: 160,
        positionY: 200,
      },
      {
        tempId: "methodology",
        title: "Methodology",
        nodeType: "Process",
        content: "Define the experimental or analytical approach.",
        color: "#fcd34d",
        positionX: 240,
        positionY: 400,
      },
      {
        tempId: "data-collection",
        title: "Data Collection",
        nodeType: "Process",
        content: "Gather data according to methodology.",
        color: "#fde68a",
        positionX: 180,
        positionY: 600,
      },
      {
        tempId: "analysis",
        title: "Analysis",
        nodeType: "Process",
        content: "Analyze the collected data for patterns and significance.",
        color: "#fef3c7",
        positionX: 220,
        positionY: 800,
      },
      {
        tempId: "conclusion",
        title: "Conclusion",
        nodeType: "Result",
        content: "Summarize findings and state whether the hypothesis is supported.",
        color: "#fffbeb",
        positionX: 200,
        positionY: 1000,
      },
    ],
    edges: [
      { sourceTempId: "hypothesis", targetTempId: "lit-review", label: "Informs" },
      { sourceTempId: "lit-review", targetTempId: "methodology", label: "Shapes" },
      { sourceTempId: "methodology", targetTempId: "data-collection", label: "Guides" },
      { sourceTempId: "data-collection", targetTempId: "analysis", label: "Feeds" },
      { sourceTempId: "analysis", targetTempId: "conclusion", label: "Supports" },
    ],
  },
  {
    id: "argument-chain",
    name: "Argument Chain",
    category: "technical",
    description:
      "Structured argumentation with premises, evidence, counterarguments, and conclusion.",
    nodes: [
      {
        tempId: "premise-a",
        title: "Premise A",
        nodeType: "Premise",
        content: "First foundational claim.",
        color: "#ef4444",
        positionX: 100,
        positionY: 0,
      },
      {
        tempId: "premise-b",
        title: "Premise B",
        nodeType: "Premise",
        content: "Second foundational claim.",
        color: "#f87171",
        positionX: 300,
        positionY: 0,
      },
      {
        tempId: "evidence",
        title: "Supporting Evidence",
        nodeType: "Evidence",
        content: "Data, citations, or examples backing the premises.",
        color: "#fca5a5",
        positionX: 200,
        positionY: 200,
      },
      {
        tempId: "counterargument",
        title: "Counterargument",
        nodeType: "Rebuttal",
        content: "Strongest objection to the argument.",
        color: "#fecaca",
        positionX: 120,
        positionY: 400,
      },
      {
        tempId: "rebuttal",
        title: "Rebuttal",
        nodeType: "Rebuttal",
        content: "Response addressing the counterargument.",
        color: "#fee2e2",
        positionX: 280,
        positionY: 400,
      },
      {
        tempId: "conclusion",
        title: "Conclusion",
        nodeType: "Result",
        content: "Final synthesis and takeaway.",
        color: "#fef2f2",
        positionX: 200,
        positionY: 600,
      },
    ],
    edges: [
      { sourceTempId: "premise-a", targetTempId: "evidence", label: "Supported by" },
      { sourceTempId: "premise-b", targetTempId: "evidence", label: "Supported by" },
      { sourceTempId: "evidence", targetTempId: "counterargument", label: "Challenged by" },
      { sourceTempId: "counterargument", targetTempId: "rebuttal", label: "Addressed by" },
      { sourceTempId: "rebuttal", targetTempId: "conclusion", label: "Leads to" },
    ],
  },
  {
    id: "cause-effect-analysis",
    name: "Cause-Effect Analysis",
    category: "technical",
    description:
      "Traces root causes through contributing factors to intermediate and final effects.",
    nodes: [
      {
        tempId: "root-cause",
        title: "Root Cause",
        nodeType: "Cause",
        content: "The fundamental underlying cause.",
        color: "#10b981",
        positionX: 200,
        positionY: 0,
      },
      {
        tempId: "factor-a",
        title: "Contributing Factor A",
        nodeType: "Factor",
        content: "First contributing factor branching from the root cause.",
        color: "#34d399",
        positionX: 80,
        positionY: 200,
      },
      {
        tempId: "factor-b",
        title: "Contributing Factor B",
        nodeType: "Factor",
        content: "Second contributing factor branching from the root cause.",
        color: "#6ee7b7",
        positionX: 320,
        positionY: 200,
      },
      {
        tempId: "intermediate-effect",
        title: "Intermediate Effect",
        nodeType: "Effect",
        content: "The combined intermediate outcome of contributing factors.",
        color: "#a7f3d0",
        positionX: 200,
        positionY: 400,
      },
      {
        tempId: "final-effect",
        title: "Final Effect",
        nodeType: "Effect",
        content: "The ultimate resulting outcome.",
        color: "#d1fae5",
        positionX: 200,
        positionY: 600,
      },
    ],
    edges: [
      { sourceTempId: "root-cause", targetTempId: "factor-a", label: "Contributes" },
      { sourceTempId: "root-cause", targetTempId: "factor-b", label: "Contributes" },
      { sourceTempId: "factor-a", targetTempId: "intermediate-effect", label: "Produces" },
      { sourceTempId: "factor-b", targetTempId: "intermediate-effect", label: "Produces" },
      { sourceTempId: "intermediate-effect", targetTempId: "final-effect", label: "Results in" },
    ],
  },
];
