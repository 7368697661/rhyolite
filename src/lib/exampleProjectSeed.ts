/**
 * Example project seed data for onboarding.
 *
 * Creates a complete project with documents, wiki entries, a timeline,
 * and populated loreBible/storyOutline fields to demonstrate all features.
 */

import {
  generateId,
  writeProject,
  writeDocument,
  writeWikiEntry,
  writeTimeline,
  type FsProject,
  type FsDocument,
  type FsWikiEntry,
  type FsTimeline,
  type FsTimelineEvent,
  type FsEventEdge,
} from "./fs-db";

export async function createExampleProject(): Promise<string> {
  const projectId = generateId();
  const now = new Date().toISOString();

  // -- Project --
  const project: FsProject = {
    id: projectId,
    title: "The Shattered Meridian",
    loreBible: `# Core Canon — The Shattered Meridian

## The World
Aethon is a continent fractured by the Sundering — an arcane cataclysm that split reality into overlapping "meridians" (dimensional layers). Where meridians overlap, physics becomes unstable: gravity reverses, time stutters, and memories bleed between minds.

## Magic System: Resonance
Magic is performed by attuning to a meridian's frequency. Practitioners ("Tuners") use crystalline instruments to vibrate at specific harmonic signatures. Overtuning risks "meridian bleed" — permanent fusion of two layers at the tuner's location.

## Key Rules
- No one can tune more than two meridians simultaneously without catastrophic bleed.
- The Pale Meridian (death/entropy) can be sensed but never safely tuned.
- Artifacts from before the Sundering resonate with ALL meridians and are extremely dangerous.

## Factions
- **The Conservatory**: Academic tuners who map and catalog meridian frequencies. Politically neutral but hoarding knowledge.
- **The Shardborn**: People born in bleed zones who can naturally perceive multiple meridians. Feared and discriminated against.
- **The Silence**: A secretive group that wants to collapse all meridians back into one reality, regardless of the cost.`,
    storyOutline: `# Story Outline — The Shattered Meridian

## Act I: Dissonance
- Introduce Kael, a Conservatory apprentice who discovers she's secretly Shardborn.
- Her mentor Vareth assigns her to catalog a newly discovered bleed zone.
- In the bleed zone, she accidentally tunes the Pale Meridian and survives — which should be impossible.
- The Silence takes notice.

## Act II: Harmonics
- Kael flees the Conservatory when her nature is exposed.
- She meets Orrin, a Shardborn smuggler who navigates bleed zones for a living.
- Together they discover that a pre-Sundering artifact ("the Fulcrum") is resonating again.
- The Silence is trying to use the Fulcrum to collapse all meridians.
- Kael realizes her ability to tune the Pale Meridian is the key to either stabilizing or destroying the Fulcrum.

## Act III: Resolution
- Confrontation at the Fulcrum site, which exists across all meridians simultaneously.
- Kael must choose: collapse the meridians (ending bleed zones but destroying Shardborn identity) or stabilize them (preserving the fractured world but leaving it vulnerable).
- She finds a third path — partial reunification that heals the most dangerous bleeds while preserving beneficial ones.
- Vareth is revealed as a Silence agent. Final confrontation. Kael wins by tuning three meridians at once (previously thought fatal).`,
    createdAt: now,
    updatedAt: now,
  };
  await writeProject(project);

  // -- Documents (Crystals) --
  const doc1: FsDocument = {
    id: generateId(),
    title: "Chapter 1 — The Frequency of Forgetting",
    content: `The tuning fork hummed in Kael's hand, its note pure enough to taste — copper and ozone on the back of her tongue. She held it steady, eyes closed, letting the vibration map the contours of the bleed zone ahead.

"Frequency stable," she murmured into her notation crystal. "Consistent with Meridian Terce, upper harmonic register. No anomalous resonance detected."

A lie. There was something else in the static — a low, subsonic presence that made her molars ache. She'd been sensing it for weeks now, this phantom frequency beneath every meridian she tested. Always present. Always just below the threshold of proper measurement.

She'd stopped mentioning it in her reports after Vareth's response: "Auditory artifacts are common in prolonged tuning sessions. Take a rest day, apprentice."

But Kael didn't think rest would fix this. The frequency wasn't in her ears. It was in her bones.`,
    projectId,
    folderId: null,
    orderIndex: 0,
    createdAt: now,
    updatedAt: now,
  };

  const doc2: FsDocument = {
    id: generateId(),
    title: "Chapter 2 — Bleed Zone Cartography",
    content: `The bleed zone started abruptly, as they always did — one step on solid ground, the next in a place where the light came from the wrong direction and shadows pooled upward along walls.

Kael marked the boundary with resonance chalk, the pale blue line glowing faintly as it reacted to the dimensional overlap. Standard procedure. Map the edges first, then spiral inward.

"Boundary extends roughly three hundred meters north-northeast," she recorded. "Visual distortion level: moderate. Gravity displacement: minor — approximately 0.3g lateral pull. Temporal variance: within standard parameters."

She checked her chronometer against the reference crystal. The two were still synchronized. Good. In heavy bleed zones, time could stutter — you'd walk in for what felt like an hour and come out a week later, or worse, a week earlier.`,
    projectId,
    folderId: null,
    orderIndex: 1,
    createdAt: now,
    updatedAt: now,
  };

  const doc3: FsDocument = {
    id: generateId(),
    title: "Worldbuilding Notes — Resonance Mechanics",
    content: `# Resonance Mechanics — Working Notes

## How Tuning Works
1. Tuner holds a crystalline resonance instrument (fork, chime, lens, etc.)
2. Attunes their perception to a specific meridian's harmonic signature
3. Can then interact with that meridian's physics layer

## Costs and Limits
- Physical fatigue proportional to time spent tuned
- "Harmonic hangover" after prolonged sessions — disorientation, synesthesia
- Maximum safe tuning: 2 meridians simultaneously
- Exceeding limit → meridian bleed (permanent dimensional overlap at location)

## Known Meridians
| Meridian | Domain | Harmonic Signature |
|----------|--------|--------------------|
| Prime | Baseline reality | A-440 reference |
| Terce | Gravity/mass | Low register, felt more than heard |
| Quinte | Light/energy | High register, visible as color shifts |
| Pale | Entropy/death | Sub-audible, sensed as dread |
| Void | Unknown | Pre-Sundering only |

## Open Questions
- What happens if someone tunes the Void meridian?
- Are there more meridians than the known five?
- Is the Sundering reversible?`,
    projectId,
    folderId: null,
    orderIndex: 2,
    createdAt: now,
    updatedAt: now,
  };

  await writeDocument(doc1);
  await writeDocument(doc2);
  await writeDocument(doc3);

  // -- Wiki Entries (Artifacts) --
  const wiki1: FsWikiEntry = {
    id: generateId(),
    title: "Kael",
    content: `## Kael Denn

**Role:** Protagonist, Conservatory apprentice  
**Age:** 23  
**Affiliation:** The Conservatory (initially)

### Background
Raised in the Conservatory as an orphan, believed to be the child of two tuners killed in a bleed event. Actually Shardborn — born in a bleed zone, able to perceive multiple meridians natively.

### Abilities
- Natural multi-meridian perception (hidden)
- Exceptional tuning precision
- Unique ability to sense and survive the Pale Meridian

### Arc
Moves from obedient apprentice → fugitive → reluctant hero who must reconcile her dual nature (Conservatory training vs. Shardborn identity).

### Key Relationships
- **Vareth**: Mentor and father figure. Secretly a Silence agent.
- **Orrin**: Shardborn smuggler. Love interest. Teaches her to embrace her nature.`,
    projectId,
    folderId: null,
    aliases: "Kael Denn, the apprentice",
    createdAt: now,
    updatedAt: now,
  };

  const wiki2: FsWikiEntry = {
    id: generateId(),
    title: "Vareth",
    content: `## Master Vareth

**Role:** Antagonist (revealed), Kael's mentor  
**Age:** 58  
**Affiliation:** The Conservatory (public), The Silence (secret)

### Background
One of the Conservatory's most respected tuners. Brilliant researcher who mapped three previously unknown bleed zones. Secretly joined the Silence after his family was killed in a catastrophic bleed event.

### Motivation
Genuinely believes collapsing all meridians back to a single reality would prevent further suffering. Sees his betrayal of Kael as a necessary sacrifice.

### Key Detail
He assigned Kael to the bleed zone specifically because he suspected she was Shardborn and wanted to test whether she could sense the Fulcrum's resonance.`,
    projectId,
    folderId: null,
    aliases: "Master Vareth, the mentor",
    createdAt: now,
    updatedAt: now,
  };

  const wiki3: FsWikiEntry = {
    id: generateId(),
    title: "Orrin",
    content: `## Orrin Shade

**Role:** Deuteragonist, Shardborn smuggler  
**Age:** 27  
**Affiliation:** Independent (Shardborn community)

### Background
Born and raised in the Bleedways — a network of stable bleed zones used as smuggling routes. Expert navigator of dimensional overlaps.

### Abilities
- Innate bleed zone navigation
- Can "feel" meridian boundaries like a sixth sense
- Street-smart and resourceful

### Personality
Sardonic, distrustful of institutions. Deeply protective of the Shardborn community. His cynicism masks genuine idealism about Shardborn rights.`,
    projectId,
    folderId: null,
    aliases: "Orrin Shade",
    createdAt: now,
    updatedAt: now,
  };

  const wiki4: FsWikiEntry = {
    id: generateId(),
    title: "The Fulcrum",
    content: `## The Fulcrum

**Type:** Pre-Sundering artifact  
**Location:** Unknown (exists across all meridians simultaneously)

### Description
A massive crystalline structure that predates the Sundering. It resonates with all known meridians simultaneously — something no modern tuner can achieve. The Silence believes it was the original instrument used to create the meridians, and that it can be used to reverse the process.

### Properties
- Resonates with all five known meridians
- Exists in a superposition across all dimensional layers
- Can only be fully perceived by someone who can tune the Pale Meridian
- Proximity causes involuntary multi-meridian perception in all tuners

### Danger
If activated without precise harmonic control, it could trigger a second Sundering — or worse, collapse all meridians into the Pale (entropy/death).`,
    projectId,
    folderId: null,
    aliases: "the Fulcrum, Fulcrum artifact",
    createdAt: now,
    updatedAt: now,
  };

  const wiki5: FsWikiEntry = {
    id: generateId(),
    title: "The Conservatory",
    content: `## The Conservatory

**Type:** Faction/institution  
**Alignment:** Neutral (knowledge-hoarding)

### Overview
The preeminent institution for the study and practice of resonance tuning. Located in the Spire of Harmonics, a massive tower built on the most stable ground on the continent (minimal meridian interference).

### Structure
- **Grand Tuner**: Head of the institution
- **Masters**: Senior researchers and teachers
- **Apprentices**: Students in multi-year training programs
- **Archivists**: Maintain the massive library of meridian frequencies

### Philosophy
Knowledge of meridians should be carefully controlled to prevent catastrophic bleed events. This makes them powerful but also secretive and elitist. They discriminate against Shardborn, viewing their natural abilities as "uncontrolled" and dangerous.`,
    projectId,
    folderId: null,
    aliases: "Conservatory, the Spire",
    createdAt: now,
    updatedAt: now,
  };

  await writeWikiEntry(wiki1);
  await writeWikiEntry(wiki2);
  await writeWikiEntry(wiki3);
  await writeWikiEntry(wiki4);
  await writeWikiEntry(wiki5);

  // -- Timeline --
  const timelineId = generateId();

  const ev1: FsTimelineEvent = {
    id: generateId(), title: "The Sundering", summary: "Arcane cataclysm splits reality into overlapping meridians",
    content: "The catastrophic event that fractured Aethon's single reality into multiple overlapping dimensional layers. Cause unknown. Killed approximately 40% of the population and created the first bleed zones.",
    nodeType: "Event", passFullContent: false, color: "#7c3aed", referenceType: null, referenceId: null,
    positionX: 0, positionY: 100, timelineId, documentId: null, tags: [],
  };

  const ev2: FsTimelineEvent = {
    id: generateId(), title: "Conservatory Founded", summary: "Tuners organize to study and control resonance",
    content: "In the aftermath of the Sundering, surviving tuners establish the Conservatory to systematically study the meridians and prevent further catastrophic bleed events.",
    nodeType: "Event", passFullContent: false, color: "#6366f1", referenceType: null, referenceId: null,
    positionX: 250, positionY: 100, timelineId, documentId: null, tags: [wiki5.id],
  };

  const ev3: FsTimelineEvent = {
    id: generateId(), title: "Kael Born in Bleed Zone", summary: "Kael is born during a bleed event, becomes Shardborn",
    content: "Kael is born during a catastrophic bleed event that kills her parents. She is secretly Shardborn — able to naturally perceive multiple meridians. Taken in by the Conservatory as an orphan.",
    nodeType: "Event", passFullContent: false, color: "#8b5cf6", referenceType: null, referenceId: null,
    positionX: 500, positionY: 100, timelineId, documentId: null, tags: [wiki1.id],
  };

  const ev4: FsTimelineEvent = {
    id: generateId(), title: "Kael Discovers Pale Meridian", summary: "During a routine survey, Kael accidentally tunes the Pale Meridian",
    content: "While mapping a bleed zone, Kael accidentally attunes to the Pale Meridian — the meridian of entropy and death. She survives, which should be impossible. This event triggers the main plot.",
    nodeType: "Event", passFullContent: false, color: "#a78bfa", referenceType: "document", referenceId: doc1.id,
    positionX: 750, positionY: 100, timelineId, documentId: null, tags: [wiki1.id],
  };

  const ev5: FsTimelineEvent = {
    id: generateId(), title: "Flight from Conservatory", summary: "Kael's Shardborn nature exposed; she flees",
    content: "When Kael's secret Shardborn abilities are exposed, she is forced to flee the Conservatory. She encounters Orrin in the Bleedways and they form an uneasy alliance.",
    nodeType: "Event", passFullContent: false, color: "#c084fc", referenceType: null, referenceId: null,
    positionX: 1000, positionY: 100, timelineId, documentId: null, tags: [wiki1.id, wiki3.id],
  };

  const ev6: FsTimelineEvent = {
    id: generateId(), title: "The Fulcrum Awakens", summary: "Pre-Sundering artifact begins resonating across all meridians",
    content: "The Fulcrum — a pre-Sundering artifact — begins resonating again after millennia of dormancy. Both the Silence and the Conservatory race to find it. Kael's Pale Meridian ability is the key to locating it.",
    nodeType: "Event", passFullContent: false, color: "#e879f9", referenceType: null, referenceId: null,
    positionX: 1250, positionY: 100, timelineId, documentId: null, tags: [wiki4.id],
  };

  const edges: FsEventEdge[] = [
    { id: generateId(), sourceId: ev1.id, targetId: ev2.id, label: "aftermath" },
    { id: generateId(), sourceId: ev2.id, targetId: ev3.id, label: "decades later" },
    { id: generateId(), sourceId: ev3.id, targetId: ev4.id, label: "23 years later" },
    { id: generateId(), sourceId: ev4.id, targetId: ev5.id, label: "days later" },
    { id: generateId(), sourceId: ev5.id, targetId: ev6.id, label: "weeks later" },
  ];

  const timeline: FsTimeline = {
    id: timelineId,
    title: "Main Story Timeline",
    projectId,
    events: [ev1, ev2, ev3, ev4, ev5, ev6],
    edges,
    createdAt: now,
    updatedAt: now,
  };
  await writeTimeline(timeline);

  return projectId;
}
