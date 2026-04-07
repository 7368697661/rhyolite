import { invoke } from '@tauri-apps/api/core';
import type { FsTimeline, FsTimelineEvent } from '../agents/fs-db';

export async function resolveTimelineScope(projectId: string, documentId: string | null, timelineId: string | null): Promise<{data: FsTimeline, projectId: string, scopeType: string, id: string} | null> {
    if (!projectId || !timelineId) return null; // We only support timelines for now
    const tl = await invoke<FsTimeline | null>('read_timeline', { projectId, id: timelineId });
    if (!tl) return null;
    return { data: tl, projectId, scopeType: "timeline", id: timelineId };
}
export async function saveTimelineScope(projectId: string, scopeType: string, timelineId: string, data: FsTimeline) {
    await invoke('write_timeline', { projectId, timeline: data });
}
export async function findNodeScope(projectId: string, nodeId: string): Promise<{node: FsTimelineEvent, data: FsTimeline, projectId: string, scopeType: string, id: string} | null> {
    const timelines = await invoke<FsTimeline[]>('list_timelines', { projectId });
    for (const tl of timelines) {
        const node = tl.events.find(e => e.id === nodeId);
        if (node) {
            return { node, data: tl, projectId, scopeType: "timeline", id: tl.id };
        }
    }
    return null;
}
