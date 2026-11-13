export type IdeaStatus = "under-review" | "planned" | "building" | "done" | "declined";

export interface Idea {
  id: number | string;
  product: string;
  text: string;
  status: IdeaStatus | string;
  votes: number;
  created_at?: string;
  mine?: boolean;
  public?: boolean;
}

export interface VoteTokenPayload {
  product: string;
  uid: string;
  exp: number;
}
