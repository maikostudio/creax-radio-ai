
export type ProductionType = 'ads' | 'radio_id' | 'podcast' | 'narration';
export type InterpretationStyle = 'vendedor' | 'amigable' | 'institucional';
export type AppView = 'studio' | 'admin_dashboard' | 'billing_settings';

export interface AdScript {
  id: string;
  title: string;
  text: string;
  sfx: string;
  tone: string;
  energy: 'low' | 'mid' | 'high';
  interpretations: InterpretationStyle[];
  createdAt: number;
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

export interface AdminConfig {
  merchantEmail: string;
  currency: string;
  stripeKey: string;
  mercadoPagoKey: string;
  subscriptionPrice: number;
}

export interface SavedProduction extends AdScript {
  client: string;
  location: string;
  type: string;
}
