
export type ProductionType = 'ads' | 'radio_id' | 'podcast' | 'narration';
export type InterpretationStyle = 'vendedor' | 'amigable' | 'institucional';

export interface AdScript {
  id: string;
  title: string;
  text: string;
  sfx: string;
  tone: string;
  energy: 'low' | 'mid' | 'high';
  interpretations: InterpretationStyle[];
}

export interface AdProject {
  category: string;
  location: string;
  vibe: string;
  briefing: string;
  type: ProductionType;
  voiceId: string;
}

export interface Vibe {
  id: string;
  name: string;
  icon: string;
  musicUrl: string;
  color: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  gender: 'M' | 'F';
  description: string;
}
