export type SpeakerRole = "owner" | "guest";

export interface SpeakerProfile {
  slug: string;
  displayName: string;
  role: SpeakerRole;
  memorySummary: string;
  greetingStyle: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpeakerResolveResult {
  profile: SpeakerProfile;
  messagePrefix: string;
  instructionsAddon: string;
  mapped: boolean;
}
