
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { VIBES, SYSTEM_PROMPT } from './constants';
import { AdProject, AdScript } from './types';

// Helpers para procesamiento de audio raw de Gemini TTS
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={`bg-white/90 backdrop-blur-2xl p-8 md:p-14 rounded-[4rem] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.08)] border border-white/50 ${className}`}>
    {children}
  </div>
);

const App: React.FC = () => {
  const [step, setStep] = useState(0);
  const [project, setProject] = useState<AdProject>({ category: '', location: '', vibe: 'litoral', briefing: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [results, setResults] = useState<AdScript[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const loadingMessages = [
    "Sintonizando la frecuencia del Litoral...",
    "Buscando la calidez de nuestras provincias...",
    "Ajustando el tono federal...",
    "Mezclando con sonidos de nuestra tierra...",
    "Escuchando tu propuesta regional...",
    "Casi listo, aguardanos un momento..."
  ];

  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
      }, 3000);
    } else {
      setLoadingMessageIndex(0);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(',')[1];
          setAudioBase64(base64data);
        };
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError("No se pudo acceder al micrófono. Por favor permití el acceso.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const generateScripts = async () => {
    // IMPORTANTE: El usuario debe renombrar 'Gemini' a 'API_KEY' en Vercel.
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      setError("Error de Configuración: En el panel de Vercel, renombrá la variable 'Gemini' a 'API_KEY'.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    const ai = new GoogleGenAI({ apiKey });
    
    const finalPrompt = SYSTEM_PROMPT
      .replace('{category}', project.category)
      .replace('{location}', project.location)
      .replace('{briefing}', project.briefing || "Escuchá el audio para la idea.")
      .replace('{vibe}', project.vibe);

    try {
      const parts: any[] = [{ text: finalPrompt }];
      if (audioBase64) parts.push({ inlineData: { data: audioBase64, mimeType: 'audio/webm' } });

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scripts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    text: { type: Type.STRING },
                    sfx: { type: Type.STRING },
                    tone: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      });

      const parsed = JSON.parse(response.text || "{}");
      setResults(parsed.scripts || []);
      setStep(3);
    } catch (err) {
      setError("Error al conectar con el motor creativo. Verificá tu API Key.");
    } finally {
      setIsGenerating(false);
    }
  };

  const stopAllAudio = () => {
    currentSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    currentSourcesRef.current = [];
    setPlayingIndex(null);
    setIsGeneratingAudio(false);
  };

  const playDemo = async (index: number) => {
    if (playingIndex === index) {
      stopAllAudio();
      return;
    }

    stopAllAudio();
    setIsGeneratingAudio(true);
    setPlayingIndex(index);

    const apiKey = process.env.API_KEY;
    if (!apiKey) return;

    try {
      const script = results[index];
      const vibeData = VIBES.find(v => v.id === project.vibe);
      const ai = new GoogleGenAI({ apiKey });

      // 1. Generar Voz con Gemini TTS
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Lee este guion de radio con un ${script.tone}: ${script.text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
        }
      });

      const voiceBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!voiceBase64) throw new Error("No se pudo generar la voz.");

      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      // 2. Cargar Música y Voz
      const [musicRes, voiceData] = await Promise.all([
        fetch(vibeData?.musicUrl || ''),
        decodeAudioData(decodeBase64(voiceBase64), ctx)
      ]);
      const musicBuffer = await ctx.decodeAudioData(await musicRes.arrayBuffer());

      // 3. Configurar Nodos
      const voiceSource = ctx.createBufferSource();
      voiceSource.buffer = voiceData;
      
      const musicSource = ctx.createBufferSource();
      musicSource.buffer = musicBuffer;
      musicSource.loop = true;

      const musicGain = ctx.createGain();
      musicGain.gain.setValueAtTime(0.08, ctx.currentTime); // Música bajita para que se entienda la voz

      const voiceGain = ctx.createGain();
      voiceGain.gain.setValueAtTime(1.0, ctx.currentTime);

      voiceSource.connect(voiceGain).connect(ctx.destination);
      musicSource.connect(musicGain).connect(ctx.destination);

      setIsGeneratingAudio(false);
      voiceSource.start();
      musicSource.start();

      currentSourcesRef.current = [voiceSource, musicSource];
      
      voiceSource.onended = () => {
        musicGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2);
        setTimeout(stopAllAudio, 2000);
      };

    } catch (e) {
      console.error(e);
      setError("Error al generar la maqueta de audio.");
      stopAllAudio();
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-emerald-100">
      <nav className="p-8 max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setStep(0)}>
          <div className="w-14 h-14 bg-gradient-to-tr from-emerald-700 to-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-200 group-hover:rotate-6 transition-transform">
            <i className="fas fa-radio text-2xl"></i>
          </div>
          <h1 className="text-3xl font-black italic tracking-tighter uppercase">CREAX <span className="text-emerald-600">IA</span></h1>
        </div>
        <div className="hidden md:flex items-center gap-2 bg-white px-5 py-2.5 rounded-full text-[10px] font-black uppercase border border-slate-200 shadow-sm text-slate-400">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
          Estudio Federal v3.8
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {error && (
          <Card className="mb-8 !p-8 border-red-100 bg-red-50/50">
            <div className="flex items-center gap-4 text-red-700">
              <i className="fas fa-circle-exclamation text-3xl"></i>
              <div>
                <p className="font-black text-xl leading-tight">Acción Requerida</p>
                <p className="font-medium opacity-80 text-sm mt-1">{error}</p>
              </div>
            </div>
            <button onClick={() => setError(null)} className="mt-4 text-red-600 font-black text-xs uppercase tracking-widest border-b-2 border-red-200 pb-1">Entendido</button>
          </Card>
        )}

        {step === 0 && (
          <Card className="animate-in fade-in slide-in-from-bottom-10 duration-1000">
            <div className="mb-12 text-center">
              <h2 className="text-6xl font-black mb-6 leading-[1.1] tracking-tight">Publicidad <br/><span className="text-emerald-600">Federal y Nuestra</span></h2>
              <p className="text-slate-400 font-medium text-xl">Creatividad del NEA impulsada por IA multimodal.</p>
            </div>
            <div className="grid md:grid-cols-2 gap-8 mb-8">
              <input 
                type="text" placeholder="Ej: Supermercado El Litoral..."
                className="w-full p-6 bg-slate-50 border-2 border-transparent focus:border-emerald-600 focus:bg-white rounded-3xl outline-none transition-all text-lg font-bold shadow-sm"
                value={project.category} onChange={e => setProject({...project, category: e.target.value})}
              />
              <input 
                type="text" placeholder="Ej: Posadas, Misiones..."
                className="w-full p-6 bg-slate-50 border-2 border-transparent focus:border-emerald-600 focus:bg-white rounded-3xl outline-none transition-all text-lg font-bold shadow-sm"
                value={project.location} onChange={e => setProject({...project, location: e.target.value})}
              />
            </div>
            <button 
              onClick={() => setStep(1)} disabled={!project.category || !project.location}
              className="w-full bg-emerald-600 text-white font-black py-8 rounded-[2.5rem] shadow-[0_25px_50px_-12px_rgba(5,150,105,0.4)] hover:shadow-emerald-500/50 hover:-translate-y-1 transition-all text-2xl disabled:opacity-50"
            >
              Configurar Estilo <i className="fas fa-arrow-right ml-2 text-sm"></i>
            </button>
          </Card>
        )}

        {step === 1 && (
          <Card className="animate-in zoom-in-95 duration-500">
            <h2 className="text-4xl font-black mb-12 text-center italic tracking-tight">Elegí la <span className="text-emerald-600">Impronta</span></h2>
            <div className="grid grid-cols-2 gap-6 mb-12">
              {VIBES.map(v => (
                <button
                  key={v.id} onClick={() => setProject({...project, vibe: v.id})}
                  className={`p-10 rounded-[3rem] border-4 transition-all flex flex-col items-center gap-4 group ${project.vibe === v.id ? 'border-emerald-600 bg-emerald-50/50 scale-105' : 'border-transparent bg-slate-100/50 hover:bg-white shadow-emerald-100 hover:shadow-2xl'}`}
                >
                  <div className={`w-20 h-20 rounded-[2rem] ${v.color} text-white flex items-center justify-center text-4xl shadow-2xl`}>
                    <i className={`fas ${v.icon}`}></i>
                  </div>
                  <span className="font-black text-slate-800 text-lg uppercase tracking-wider">{v.name}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-6">
               <button onClick={() => setStep(0)} className="flex-1 bg-slate-200 text-slate-600 font-black py-7 rounded-[2rem] text-xl">Volver</button>
               <button onClick={() => setStep(2)} className="flex-[2] bg-emerald-600 text-white font-black py-7 rounded-[2rem] text-xl shadow-xl">Siguiente</button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <h2 className="text-4xl font-black mb-8 text-center">Contanos tu <span className="text-emerald-600">Propuesta</span></h2>
            <div className="grid md:grid-cols-2 gap-8 mb-10">
              <textarea 
                rows={6} placeholder="Escribí tu idea..."
                className="w-full p-8 bg-slate-100/50 border-4 border-transparent focus:border-emerald-600 focus:bg-white rounded-[2.5rem] outline-none transition-all text-xl font-bold shadow-inner"
                value={project.briefing} onChange={e => setProject({...project, briefing: e.target.value})}
              />
              <div className="flex-1 bg-slate-50 border-4 border-dashed border-slate-200 rounded-[2.5rem] flex flex-col items-center justify-center p-8">
                {audioBase64 ? (
                  <div className="text-center animate-in zoom-in-50">
                    <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-4"><i className="fas fa-check"></i></div>
                    <span className="font-black text-emerald-800 text-[10px] uppercase">Audio listo</span>
                    <button onClick={() => setAudioBase64(null)} className="block mt-2 text-red-500 font-black text-[10px] uppercase">Borrar</button>
                  </div>
                ) : (
                  <button 
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`w-28 h-28 rounded-full flex items-center justify-center text-4xl shadow-2xl transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-emerald-600 text-white'}`}
                  >
                    <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'}`}></i>
                  </button>
                )}
                {!audioBase64 && !isRecording && <span className="mt-4 font-black text-slate-400 text-[10px] uppercase">Hablá ahora</span>}
              </div>
            </div>
            <button 
              onClick={generateScripts} disabled={isGenerating || (!project.briefing && !audioBase64)}
              className={`w-full text-white font-black py-9 rounded-[3rem] text-3xl flex items-center justify-center gap-6 shadow-2xl transition-all ${isGenerating ? 'bg-slate-800' : 'bg-gradient-to-r from-emerald-600 to-blue-700'}`}
            >
              {isGenerating ? <span>{loadingMessages[loadingMessageIndex]}</span> : "Generar Campaña"}
            </button>
          </Card>
        )}

        {step === 3 && (
          <div className="space-y-10 animate-in fade-in duration-1000">
            <div className="flex justify-between items-center px-4">
              <h2 className="text-5xl font-black italic tracking-tighter uppercase">Guiones <span className="text-emerald-600">NEA</span></h2>
              <button onClick={() => setStep(0)} className="bg-white px-8 py-4 rounded-full font-black text-emerald-600 border-2 border-emerald-50">Nuevo</button>
            </div>
            <div className="grid gap-8">
              {results.map((s, i) => (
                <div key={i} className="bg-white/70 backdrop-blur-xl p-10 rounded-[3rem] shadow-2xl border border-white flex flex-col md:flex-row gap-10 items-center">
                  <div className="flex-1">
                    <h3 className="text-2xl font-black text-slate-800 mb-4">{s.title}</h3>
                    <p className="text-slate-600 text-2xl leading-relaxed italic font-bold">"{s.text}"</p>
                    <div className="flex gap-4 mt-6">
                      <span className="px-4 py-2 bg-slate-100 rounded-xl text-[9px] font-black text-slate-500 uppercase italic tracking-widest">{s.tone}</span>
                    </div>
                  </div>
                  <div className="w-full md:w-64 flex flex-col gap-4">
                    <button 
                      onClick={() => playDemo(i)}
                      disabled={isGeneratingAudio && playingIndex !== i}
                      className={`w-full py-7 rounded-[2rem] font-black flex items-center justify-center gap-4 transition-all text-lg shadow-xl ${playingIndex === i ? 'bg-red-500 text-white' : 'bg-slate-900 text-white hover:bg-black'}`}
                    >
                      {isGeneratingAudio && playingIndex === i ? (
                        <i className="fas fa-circle-notch animate-spin"></i>
                      ) : (
                        <i className={`fas ${playingIndex === i ? 'fa-stop' : 'fa-play-circle'}`}></i>
                      )}
                      {playingIndex === i ? 'Parar' : 'Escuchar Locutor'}
                    </button>
                    <button className="w-full py-7 bg-emerald-600 text-white rounded-[2rem] font-black text-lg shadow-xl hover:scale-105 transition-transform">
                      <i className="fas fa-download mr-2"></i> Descargar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
