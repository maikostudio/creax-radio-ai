
import { Vibe, VoiceProfile } from './types';

export const SYSTEM_PROMPT = `Actúa como un Productor Senior de Audio y Director Creativo. 
Tu tarea es generar 3 propuestas de guion de nivel profesional para el formato: {type}.

DIRECTRICES DE CALIDAD:
- IMPACTO: Los primeros 3 segundos deben captar la atención.
- EMOCIÓN: Usar un lenguaje que conecte con la sensibilidad de {location}.
- PROSODIA: Escribir pensando en el ritmo respiratorio de un locutor real.
- FORMATO: Evitar clichés. Si es Podcast, busca profundidad. Si es ID de Radio, busca potencia sonora.

DATOS DEL PROYECTO:
Tipo: {type}
Rubro: {category}
Ubicación: {location}
Instrucciones: {briefing}
Estilo de Música: {vibe}

Devolvé un JSON con este formato:
{
  "scripts": [
    { 
      "title": "Nombre", 
      "text": "Texto para leer (máximo 40 segundos)", 
      "sfx": "FX de sonido sugeridos", 
      "tone": "Instrucciones de emoción (ej: Cálido, Vendedor, Urgente)",
      "energy": "high" 
    }
  ]
}`;

export const VIBES: Vibe[] = [
  { id: 'litoral', name: 'Folclore / Calidez', icon: 'fa-guitar', musicUrl: 'https://assets.mixkit.co/music/preview/mixkit-acoustic-guitar-chill-out-120.mp3', color: 'bg-emerald-700' },
  { id: 'urban', name: 'Urbano / Moderno', icon: 'fa-city', musicUrl: 'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3', color: 'bg-indigo-600' },
  { id: 'epic', name: 'Épico / Cine', icon: 'fa-film', musicUrl: 'https://assets.mixkit.co/music/preview/mixkit-climbing-the-mountain-120.mp3', color: 'bg-red-700' },
  { id: 'news', name: 'Informativo', icon: 'fa-broadcast-tower', musicUrl: 'https://assets.mixkit.co/music/preview/mixkit-global-reporting-120.mp3', color: 'bg-slate-800' }
];

export const VOICES: VoiceProfile[] = [
  { id: 'Kore', name: 'Kore (Institucional)', gender: 'M', description: 'Voz madura, confiable y profunda.' },
  { id: 'Puck', name: 'Puck (Juvenil)', gender: 'F', description: 'Enérgica, brillante y cercana.' },
  { id: 'Charon', name: 'Charon (Relator)', gender: 'M', description: 'Narrativo, pausado, ideal para cuentos.' },
  { id: 'Fenrir', name: 'Fenrir (Potente)', gender: 'M', description: 'Bajos profundos, ideal para IDs de radio.' }
];
