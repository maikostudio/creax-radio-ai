
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { VIBES, SYSTEM_PROMPT, VOICES } from './constants';
import { AdProject, AdScript, ProductionType } from './types';

// Utilidades de Audio
function decodeBase64(base64: string) {
  try {
    const binaryString = atob(base64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.error("Base64 Error", e);
    return new Uint8Array(0);
  }
}

async function decodeRawPcm(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer | null> {
  if (!data.length) return null;
  const bufferView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const l = data.byteLength / 2;
  const audioBuffer = ctx.createBuffer(1, l, 24000);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < l; i++) {
    channelData[i] = bufferView.getInt16(i * 2, true) / 32768.0;
  }
  return audioBuffer;
}

const App: React.FC = () => {
  const [step, setStep] = useState(0);
  const [project, setProject] = useState<AdProject>({ 
    category: '', location: '', vibe: 'litoral', briefing: '', type: 'ads', voiceId: 'Kore' 
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<AdScript[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [audioStatus, setAudioStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const generateScripts = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = SYSTEM_PROMPT
        .replace(/{type}/g, project.type)
        .replace(/{category}/g, project.category)
        .replace(/{location}/g, project.location)
        .replace(/{briefing}/g, project.briefing)
        .replace(/{vibe}/g, project.vibe);

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });

      const data = JSON.parse(response.text || "{}");
      setResults(data.scripts || []);
      setStep(3);
    } catch (e) {
      setError("Error en la conexión con el estudio.");
    } finally {
      setIsGenerating(false);
    }
  };

  const playStudioProduction = async (index: number) => {
    if (playingIndex === index) {
      stopAudio();
      return;
    }
    stopAudio();
    setPlayingIndex(index);
    setAudioStatus('Procesando Mix...');

    try {
      const script = results[index];
      const vibe = VIBES.find(v => v.id === project.vibe);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // TTS Profesional
      const tts = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Actúa como un locutor profesional. Tono: ${script.tone}. Guion: ${script.text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: project.voiceId as any } } }
        }
      });

      const voiceData = tts.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!voiceData) throw new Error("Voz fallida");

      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      await ctx.resume();

      const voiceBuf = await decodeRawPcm(decodeBase64(voiceData), ctx);
      const musicRes = await fetch(vibe?.musicUrl || '');
      const musicBuf = await ctx.decodeAudioData(await musicRes.arrayBuffer());

      if (!voiceBuf) return;

      // Master Nodes
      const voiceSource = ctx.createBufferSource();
      const musicSource = ctx.createBufferSource();
      const voiceGain = ctx.createGain();
      const musicGain = ctx.createGain();

      voiceSource.buffer = voiceBuf;
      musicSource.buffer = musicBuf;
      musicSource.loop = true;

      // DINÁMICA DE ESTUDIO (Ducking)
      musicGain.gain.setValueAtTime(0.2, ctx.currentTime);
      // Bajamos música cuando empieza la voz
      musicGain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 1);
      voiceGain.gain.setValueAtTime(1.2, ctx.currentTime);

      voiceSource.connect(voiceGain).connect(ctx.destination);
      musicSource.connect(musicGain).connect(ctx.destination);

      voiceSource.start();
      musicSource.start();
      currentSourcesRef.current = [voiceSource, musicSource];

      voiceSource.onended = () => {
        musicGain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 1.5);
        setTimeout(stopAudio, 2500);
      };

      setAudioStatus('');
    } catch (e) {
      setError("Error en el renderizado de audio.");
      stopAudio();
    }
  };

  const stopAudio = () => {
    currentSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    currentSourcesRef.current = [];
    setPlayingIndex(null);
    setAudioStatus('');
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 font-sans p-6">
      {/* HEADER ESTILO ESTUDIO */}
      <header className="max-w-6xl mx-auto flex justify-between items-center mb-12 bg-slate-800/50 p-6 rounded-3xl border border-slate-700 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <i className="fas fa-sliders text-xl text-slate-900"></i>
          </div>
          <h1 className="text-2xl font-black tracking-tighter uppercase italic">
            CREAX <span className="text-emerald-500">PRO STUDIO</span>
          </h1>
        </div>
        <div className="flex gap-4">
          {['ads', 'radio_id', 'podcast'].map(t => (
            <button 
              key={t} onClick={() => setProject({...project, type: t as any})}
              className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${project.type === t ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-400'}`}
            >
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        {step === 0 && (
          <div className="grid md:grid-cols-2 gap-10 animate-in fade-in slide-in-from-bottom-10">
            <div className="bg-slate-800/30 p-10 rounded-[3rem] border border-slate-700 shadow-inner">
              <h2 className="text-4xl font-black mb-8">Nueva <span className="text-emerald-500">Producción</span></h2>
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase font-black text-slate-500 mb-2 block ml-2">Cliente / Rubro</label>
                  <input 
                    type="text" className="w-full bg-slate-900 border-2 border-slate-700 p-5 rounded-2xl focus:border-emerald-500 outline-none transition-all"
                    placeholder="Ej: Automotora San Juan" value={project.category} onChange={e => setProject({...project, category: e.target.value})}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-black text-slate-500 mb-2 block ml-2">Mercado / Ciudad</label>
                  <input 
                    type="text" className="w-full bg-slate-900 border-2 border-slate-700 p-5 rounded-2xl focus:border-emerald-500 outline-none transition-all"
                    placeholder="Ej: Corrientes Capital" value={project.location} onChange={e => setProject({...project, location: e.target.value})}
                  />
                </div>
                <button 
                  onClick={() => setStep(1)} disabled={!project.category || !project.location}
                  className="w-full bg-emerald-500 text-slate-900 font-black py-6 rounded-2xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all text-lg"
                >
                  Configurar Sonido <i className="fas fa-chevron-right ml-2"></i>
                </button>
              </div>
            </div>
            <div className="hidden md:flex flex-col justify-center text-slate-500 space-y-6 border-l border-slate-800 pl-10">
              <div className="flex items-center gap-4">
                <i className="fas fa-check-circle text-emerald-500"></i>
                <p>Mastering automático con Ducking inteligente.</p>
              </div>
              <div className="flex items-center gap-4">
                <i className="fas fa-check-circle text-emerald-500"></i>
                <p>Escritura creativa optimizada para locución humana.</p>
              </div>
              <div className="flex items-center gap-4">
                <i className="fas fa-check-circle text-emerald-500"></i>
                <p>Procesamiento de audio en la nube (Vertex Ready).</p>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-in zoom-in-95">
            <h2 className="text-3xl font-black mb-10 text-center uppercase tracking-widest italic text-emerald-500">Selección de Voces y Clima</h2>
            <div className="grid md:grid-cols-2 gap-10">
              <div className="space-y-4">
                <p className="font-black text-[10px] uppercase text-slate-500 ml-4 mb-4">Perfiles de Locución</p>
                {VOICES.map(v => (
                  <button 
                    key={v.id} onClick={() => setProject({...project, voiceId: v.id})}
                    className={`w-full p-6 rounded-2xl border-2 flex items-center justify-between transition-all ${project.voiceId === v.id ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10' : 'border-slate-800 bg-slate-800/50 hover:bg-slate-800'}`}
                  >
                    <div className="text-left">
                      <span className="font-black block text-lg">{v.name}</span>
                      <span className="text-[10px] text-slate-400">{v.description}</span>
                    </div>
                    <i className={`fas ${v.gender === 'M' ? 'fa-mars' : 'fa-venus'} ${project.voiceId === v.id ? 'text-emerald-500' : 'text-slate-600'}`}></i>
                  </button>
                ))}
              </div>
              <div className="space-y-4">
                 <p className="font-black text-[10px] uppercase text-slate-500 ml-4 mb-4">Background / Clima</p>
                 <div className="grid grid-cols-2 gap-4">
                    {VIBES.map(v => (
                      <button 
                        key={v.id} onClick={() => setProject({...project, vibe: v.id})}
                        className={`p-6 rounded-2xl flex flex-col items-center gap-3 transition-all ${project.vibe === v.id ? 'bg-emerald-500 text-slate-900 shadow-xl' : 'bg-slate-800 hover:bg-slate-700'}`}
                      >
                        <i className={`fas ${v.icon} text-2xl`}></i>
                        <span className="font-black text-[10px] uppercase">{v.name}</span>
                      </button>
                    ))}
                 </div>
                 <button onClick={() => setStep(2)} className="w-full mt-10 bg-slate-100 text-slate-900 font-black py-6 rounded-2xl shadow-xl hover:bg-white transition-all text-lg">
                    Cargar Briefing <i className="fas fa-microphone ml-2"></i>
                 </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="max-w-3xl mx-auto animate-in fade-in">
             <h2 className="text-3xl font-black mb-8 text-center uppercase tracking-widest text-emerald-500 italic">Briefing de Producción</h2>
             <textarea 
               rows={8} className="w-full bg-slate-800 border-2 border-slate-700 p-8 rounded-[2rem] focus:border-emerald-500 outline-none transition-all text-xl font-medium shadow-2xl mb-8"
               placeholder="Escribí los puntos clave, ofertas o la historia que querés contar..."
               value={project.briefing} onChange={e => setProject({...project, briefing: e.target.value})}
             />
             <div className="flex gap-4">
               <button onClick={() => setStep(1)} className="flex-1 bg-slate-800 py-6 rounded-2xl font-black text-slate-400">ATRÁS</button>
               <button 
                 onClick={generateScripts} disabled={isGenerating || !project.briefing}
                 className="flex-[2] bg-emerald-500 text-slate-900 font-black py-6 rounded-2xl shadow-2xl hover:scale-[1.02] transition-all text-xl disabled:opacity-30"
               >
                 {isGenerating ? <i className="fas fa-circle-notch animate-spin"></i> : "GENERAR MASTER"}
               </button>
             </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-12 animate-in fade-in duration-700">
            <div className="flex justify-between items-center">
              <h2 className="text-4xl font-black italic text-emerald-500">PROYECTOS GENERADOS</h2>
              <button onClick={() => setStep(0)} className="bg-slate-800 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-700">Nuevo Inicio</button>
            </div>
            <div className="grid gap-8">
              {results.map((s, i) => (
                <div key={i} className="bg-slate-800/50 p-10 rounded-[2.5rem] border border-slate-700 hover:border-emerald-500/50 transition-all flex flex-col md:flex-row gap-10">
                  <div className="flex-1">
                    <div className="flex gap-3 mb-4">
                       <span className="px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-md text-[8px] font-black uppercase tracking-widest">{s.tone}</span>
                       <span className="px-3 py-1 bg-slate-700 text-slate-400 rounded-md text-[8px] font-black uppercase tracking-widest">{project.type}</span>
                    </div>
                    <h3 className="text-2xl font-black mb-4">{s.title}</h3>
                    <p className="text-slate-400 text-xl font-medium italic leading-relaxed">"{s.text}"</p>
                    <div className="mt-6 flex items-center gap-4 text-slate-500 text-[10px] font-bold">
                       <i className="fas fa-wave-square text-emerald-500"></i>
                       <span>SFX SUGERIDO: {s.sfx}</span>
                    </div>
                  </div>
                  <div className="w-full md:w-60 flex flex-col gap-4">
                    <button 
                      onClick={() => playStudioProduction(i)}
                      className={`w-full py-6 rounded-2xl font-black flex flex-col items-center justify-center gap-2 transition-all shadow-xl ${playingIndex === i ? 'bg-red-500 text-white' : 'bg-white text-slate-900 hover:bg-slate-100'}`}
                    >
                      {audioStatus && playingIndex === i ? (
                        <>
                          <i className="fas fa-spinner animate-spin"></i>
                          <span className="text-[8px] uppercase">{audioStatus}</span>
                        </>
                      ) : (
                        <>
                          <i className={`fas ${playingIndex === i ? 'fa-stop' : 'fa-play'}`}></i>
                          <span>{playingIndex === i ? 'Detener' : 'Preview Pro'}</span>
                        </>
                      )}
                    </button>
                    <button className="w-full py-4 bg-slate-700 text-slate-300 rounded-xl font-black text-xs uppercase hover:bg-slate-600">
                      Exportar WAV
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {error && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-red-500 text-white px-8 py-4 rounded-full font-black shadow-2xl animate-bounce">
          <i className="fas fa-exclamation-triangle mr-2"></i> {error}
        </div>
      )}
    </div>
  );
};

export default App;
