export type GemNode = {
    id: string;
    parentId: string | null;
    text: string;
    children: GemNode[];
};
