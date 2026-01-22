
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { VIBES, SYSTEM_PROMPT, VOICES } from './constants';
import { AdProject, AdScript, InterpretationStyle, AppView, AdminConfig, SavedProduction } from './types';

// Extendemos window para las funciones de AI Studio
// Fix: Use the standard AIStudio interface for window augmentation to avoid modifier conflicts
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio: AIStudio;
  }
}

// Utilidades de Audio Master
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

async function decodeRawPcm(data: Uint8Array, ctx: AudioContext | OfflineAudioContext): Promise<AudioBuffer | null> {
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

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const blockAlign = numChannels * (bitDepth / 8);
  const bufferLen = buffer.length * blockAlign;
  const headerLen = 44;
  const arrayBuffer = new ArrayBuffer(headerLen + bufferLen);
  const view = new DataView(arrayBuffer);
  const writeString = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + bufferLen, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, bufferLen, true);
  const offset = 44;
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>('studio');
  const [isPro, setIsPro] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  
  const [step, setStep] = useState(0);
  const [project, setProject] = useState<AdProject>({ category: '', location: '', vibe: 'litoral', briefing: '', type: 'ads', voiceId: 'Kore' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<AdScript[]>([]);
  const [audioStatus, setAudioStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const [history, setHistory] = useState<SavedProduction[]>([]);
  const [adminConfig, setAdminConfig] = useState<AdminConfig>({
    merchantEmail: 'admin@creax.studio',
    currency: 'USD',
    stripeKey: '',
    mercadoPagoKey: '',
    subscriptionPrice: 19.99
  });

  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioBase64, setRecordedAudioBase64] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const currentSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => {
    const checkKey = async () => {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasKey(selected);
    };
    checkKey();
    const saved = localStorage.getItem('creax_history');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  const handleLinkKey = async () => {
    await window.aistudio.openSelectKey();
    setHasKey(true);
  };

  const saveProduction = (scripts: AdScript[]) => {
    const newItems: SavedProduction[] = scripts.map(s => ({
      ...s,
      client: project.category,
      location: project.location,
      type: project.type,
      createdAt: Date.now()
    }));
    const updatedHistory = [...newItems, ...history].slice(0, 50);
    setHistory(updatedHistory);
    localStorage.setItem('creax_history', JSON.stringify(updatedHistory));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const reader = new FileReader();
        reader.readAsDataURL(new Blob(chunks, { type: 'audio/webm' }));
        reader.onloadend = () => setRecordedAudioBase64((reader.result as string).split(',')[1]);
      };
      recorder.start();
      setIsRecording(true);
    } catch (e) { setError("No se detectó el micrófono."); }
  };

  const generateScripts = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      // Siempre crear una nueva instancia para capturar la última API KEY vinculada
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = SYSTEM_PROMPT
        .replace(/{type}/g, project.type)
        .replace(/{category}/g, project.category)
        .replace(/{location}/g, project.location)
        .replace(/{briefing}/g, project.briefing)
        .replace(/{vibe}/g, project.vibe);

      const contents: any[] = [{ parts: [{ text: prompt }] }];
      if (recordedAudioBase64) contents[0].parts.push({ inlineData: { data: recordedAudioBase64, mimeType: 'audio/webm' } });

      const res = await ai.models.generateContent({ 
        model: "gemini-3-pro-preview", // Usamos Pro para máxima potencia creativa
        contents, 
        config: { responseMimeType: "application/json" } 
      });

      const data = JSON.parse(res.text || "{}");
      const scriptsWithId = (data.scripts || []).map((s: any) => ({ ...s, id: Math.random().toString(36).substr(2, 9), createdAt: Date.now() }));
      setResults(scriptsWithId);
      saveProduction(scriptsWithId);
      setStep(3);
    } catch (e: any) { 
      if (e.message?.includes("Requested entity was not found")) {
        setError("Error de vinculación. Por favor, selecciona tu API Key de nuevo.");
        setHasKey(false);
      } else {
        setError("Error en la conexión con el motor de IA. Reintenta en unos segundos.");
      }
    }
    finally { setIsGenerating(false); }
  };

  const renderAndDownload = async (script: AdScript, style: InterpretationStyle) => {
    if (!isPro) return;
    setAudioStatus("Mastering...");
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const tts = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Actúa como un locutor de radio. Estilo: ${style}. Texto: ${script.text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: project.voiceId as any } } }
        }
      });
      const voiceData = tts.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!voiceData) throw new Error();

      const vibe = VIBES.find(v => v.id === project.vibe);
      const musicRes = await fetch(vibe?.musicUrl || '');
      const offlineCtx = new OfflineAudioContext(1, 44100 * 35, 44100);
      const voiceBuf = await decodeRawPcm(decodeBase64(voiceData), offlineCtx);
      const musicBuf = await offlineCtx.decodeAudioData(await musicRes.arrayBuffer());

      if (!voiceBuf || !musicBuf) return;
      const vSrc = offlineCtx.createBufferSource();
      const mSrc = offlineCtx.createBufferSource();
      vSrc.buffer = voiceBuf; mSrc.buffer = musicBuf;
      const vG = offlineCtx.createGain(); const mG = offlineCtx.createGain();
      
      // Ducking Master
      mG.gain.setValueAtTime(0.12, 0); 
      mG.gain.exponentialRampToValueAtTime(0.05, 0.8);
      mG.gain.setValueAtTime(0.05, voiceBuf.duration - 0.5);
      mG.gain.exponentialRampToValueAtTime(0.12, voiceBuf.duration);
      
      vSrc.connect(vG).connect(offlineCtx.destination);
      mSrc.connect(mG).connect(offlineCtx.destination);
      vSrc.start(0); mSrc.start(0);
      const rendered = await offlineCtx.startRendering();
      const blob = audioBufferToWav(rendered);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `CREAX_MASTER_${project.category.replace(/\s/g, '_')}.wav`;
      link.click();
    } catch (e) { setError("Error al procesar el audio master."); }
    finally { setAudioStatus(""); }
  };

  return (
    <div className="flex h-screen bg-[#020617] text-slate-100 overflow-hidden font-sans">
      {/* SIDEBAR NAVIGATION */}
      <aside className="w-72 bg-slate-900/50 backdrop-blur-3xl border-r border-white/5 flex flex-col p-8 z-50">
        <div className="flex items-center gap-4 mb-14">
          <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <i className="fas fa-compact-disc text-slate-950 text-xl animate-spin-slow"></i>
          </div>
          <h1 className="text-xl font-black tracking-tighter italic">CREAX <span className="text-emerald-400 block text-[10px] tracking-[0.4em] not-italic">STUDIO</span></h1>
        </div>

        <nav className="flex-1 space-y-4">
          <button 
            onClick={() => setCurrentView('studio')}
            className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${currentView === 'studio' ? 'bg-emerald-500 text-slate-950 shadow-xl shadow-emerald-500/10' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
          >
            <i className="fas fa-layer-group"></i> Laboratorio
          </button>
          
          <div className="pt-8 pb-4">
            <p className="text-[9px] font-black uppercase text-slate-700 tracking-[0.2em] ml-6 mb-4">Administración</p>
            <button 
              onClick={() => setCurrentView('admin_dashboard')}
              className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${currentView === 'admin_dashboard' ? 'bg-emerald-500 text-slate-950 shadow-xl shadow-emerald-500/10' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
            >
              <i className="fas fa-chart-line"></i> Dashboard
            </button>
            <button 
              onClick={() => setCurrentView('billing_settings')}
              className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${currentView === 'billing_settings' ? 'bg-emerald-500 text-slate-950 shadow-xl shadow-emerald-500/10' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
            >
              <i className="fas fa-credit-card"></i> Pagos & PRO
            </button>
          </div>
        </nav>

        <div className="pt-10 border-t border-white/5 space-y-3">
           {!hasKey && (
             <button onClick={handleLinkKey} className="w-full bg-red-500/10 text-red-500 border border-red-500/20 p-4 rounded-2xl text-[10px] font-black uppercase hover:bg-red-500/20 transition-all">
                <i className="fas fa-key mr-2"></i> Vincular API Key
             </button>
           )}
           <div className={`p-5 rounded-3xl border ${isPro ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-800/40 border-slate-700'}`}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                <i className={`fas ${isPro ? 'fa-crown text-amber-500' : 'fa-user text-slate-500'}`}></i> 
                {isPro ? 'Plan Master' : 'Plan Free'}
              </p>
              <button onClick={() => setIsPro(!isPro)} className="text-[8px] font-black uppercase text-emerald-400 hover:underline">Cambiar Estado</button>
           </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto relative bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.05),transparent_50%)]">
        
        {currentView === 'studio' && (
          <div className="p-12 max-w-6xl mx-auto">
            {!hasKey && (
              <div className="mb-12 bg-amber-500/10 border border-amber-500/20 p-8 rounded-[2rem] flex items-center justify-between">
                <div>
                   <h3 className="font-black text-amber-500 uppercase italic">Motor de IA Desconectado</h3>
                   <p className="text-slate-400 text-sm">Debes vincular tu cuenta de Google AI Studio para usar los modelos Pro.</p>
                </div>
                <button onClick={handleLinkKey} className="bg-amber-500 text-slate-950 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 transition-all">Vincular Ahora</button>
              </div>
            )}

            {step === 0 && (
              <div className="max-w-3xl mx-auto py-12 animate-in fade-in zoom-in-95 duration-500">
                <h2 className="text-5xl font-black mb-4 italic tracking-tighter">Inicia una <span className="text-emerald-400">Sesión.</span></h2>
                <p className="text-slate-500 text-lg mb-12">Configura los datos del cliente para empezar la producción de audio.</p>
                <div className="bg-slate-900/40 p-12 rounded-[3.5rem] border border-white/5 shadow-2xl space-y-10">
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-4">Cliente / Rubro</label>
                      <input 
                        type="text" className="w-full bg-slate-950 border-2 border-slate-800 p-6 rounded-2xl focus:border-emerald-500 outline-none transition-all text-xl"
                        placeholder="Ej: McDonald's" value={project.category} onChange={e => setProject({...project, category: e.target.value})}
                      />
                    </div>
                    <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-4">Localidad</label>
                      <input 
                        type="text" className="w-full bg-slate-950 border-2 border-slate-800 p-6 rounded-2xl focus:border-emerald-500 outline-none transition-all text-xl"
                        placeholder="Ej: Buenos Aires" value={project.location} onChange={e => setProject({...project, location: e.target.value})}
                      />
                    </div>
                  </div>
                  <button 
                    onClick={() => setStep(1)} 
                    disabled={!project.category || !hasKey} 
                    className="w-full bg-emerald-500 text-slate-950 font-black py-8 rounded-[2rem] text-xl uppercase tracking-widest shadow-2xl shadow-emerald-500/20 hover:scale-[1.02] transition-all disabled:opacity-30"
                  >
                    Configurar Estilos
                  </button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="animate-in fade-in duration-500">
                <div className="flex items-center justify-between mb-12">
                   <h2 className="text-4xl font-black italic">Curaduría <span className="text-emerald-400">Artística</span></h2>
                   <button onClick={() => setStep(0)} className="text-slate-500 font-bold hover:text-white"><i className="fas fa-chevron-left mr-2"></i> Atrás</button>
                </div>
                <div className="grid lg:grid-cols-2 gap-12">
                  <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-6 tracking-widest">Seleccionar Talento Vocal</p>
                    {VOICES.map(v => (
                      <button 
                        key={v.id} onClick={() => setProject({...project, voiceId: v.id})}
                        className={`w-full p-8 rounded-[2.5rem] border-2 flex items-center justify-between transition-all ${project.voiceId === v.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'}`}
                      >
                        <div className="text-left">
                          <span className="text-2xl font-black block">{v.name}</span>
                          <span className="text-[10px] text-slate-500 font-bold uppercase">{v.description}</span>
                        </div>
                        <i className={`fas ${v.gender === 'M' ? 'fa-mars' : 'fa-venus'} text-2xl ${project.voiceId === v.id ? 'text-emerald-500' : 'text-slate-800'}`}></i>
                      </button>
                    ))}
                  </div>
                  <div className="space-y-8">
                     <p className="text-[10px] font-black uppercase text-slate-600 mb-6 tracking-widest">Identidad Sonora (BG Music)</p>
                     <div className="grid grid-cols-2 gap-6">
                        {VIBES.map(v => (
                          <button 
                            key={v.id} onClick={() => setProject({...project, vibe: v.id})}
                            className={`p-12 rounded-[3rem] flex flex-col items-center gap-6 transition-all ${project.vibe === v.id ? 'bg-emerald-500 text-slate-950 shadow-2xl scale-105' : 'bg-slate-900/60 border border-slate-800 hover:bg-slate-800'}`}
                          >
                            <i className={`fas ${v.icon} text-4xl`}></i>
                            <span className="font-black text-xs uppercase tracking-widest">{v.name}</span>
                          </button>
                        ))}
                     </div>
                     <button onClick={() => setStep(2)} className="w-full bg-white text-slate-950 font-black py-8 rounded-[2rem] text-xl uppercase tracking-[0.2em] shadow-2xl hover:brightness-110 transition-all">Redactar Brief</button>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
               <div className="max-w-4xl mx-auto animate-in fade-in zoom-in-95">
                  <h2 className="text-4xl font-black mb-12 italic text-center uppercase tracking-widest text-emerald-400">Briefing Creativo</h2>
                  <div className="bg-slate-900/60 p-12 rounded-[4rem] border border-white/5 shadow-2xl">
                     <div className="grid md:grid-cols-[1fr_300px] gap-10">
                        <textarea 
                          rows={8} className="w-full bg-slate-950 border-2 border-slate-800 p-10 rounded-[2.5rem] focus:border-emerald-500 outline-none text-2xl font-medium"
                          placeholder="Describe la idea central o pega los puntos clave de la promo..."
                          value={project.briefing} onChange={e => setProject({...project, briefing: e.target.value})}
                        />
                        <button 
                          onClick={isRecording ? () => { mediaRecorderRef.current?.stop(); setIsRecording(false); } : startRecording}
                          className={`rounded-[3.5rem] flex flex-col items-center justify-center gap-6 transition-all border-4 border-dashed ${isRecording ? 'bg-red-500/10 border-red-500 text-red-500 animate-pulse' : 'bg-slate-950 border-slate-800 text-slate-700 hover:text-emerald-400'}`}
                        >
                          <i className={`fas ${isRecording ? 'fa-stop-circle' : 'fa-microphone-lines'} text-6xl`}></i>
                          <span className="text-[10px] font-black uppercase tracking-[0.3em]">{isRecording ? 'Detener' : 'Grabar Idea'}</span>
                        </button>
                     </div>
                     <div className="flex gap-8 mt-12">
                        <button onClick={() => setStep(1)} className="flex-1 bg-slate-900 py-8 rounded-[2rem] font-black text-slate-500 hover:text-white transition-all uppercase text-sm tracking-widest">Casting</button>
                        <button 
                          onClick={generateScripts} disabled={isGenerating || !hasKey}
                          className="flex-[2] bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-black py-8 rounded-[2rem] text-xl uppercase tracking-widest shadow-2xl disabled:opacity-30"
                        >
                          {isGenerating ? <i className="fas fa-compact-disc animate-spin"></i> : "Generar Producción"}
                        </button>
                     </div>
                  </div>
               </div>
            )}

            {step === 3 && (
               <div className="space-y-12 animate-in fade-in duration-700">
                  <div className="flex justify-between items-center bg-slate-900/40 p-10 rounded-[3rem] border border-white/5">
                     <h2 className="text-3xl font-black italic uppercase tracking-tighter">Propuestas <span className="text-emerald-400">Aprobadas</span></h2>
                     <button onClick={() => setStep(0)} className="bg-emerald-500 text-slate-950 px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-widest">Nueva Sesión</button>
                  </div>
                  <div className="grid gap-12">
                    {results.map((s) => (
                      <div key={s.id} className="bg-slate-900/60 p-16 rounded-[4.5rem] border border-white/5 relative overflow-hidden group">
                         <div className="flex flex-col lg:flex-row gap-16 relative z-10">
                            <div className="flex-1">
                               <div className="flex gap-4 mb-8">
                                  <span className="px-6 py-2 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-500/20">{s.tone}</span>
                                  <span className="px-6 py-2 bg-slate-800 text-slate-500 rounded-full text-[10px] font-black uppercase tracking-widest">{project.type}</span>
                               </div>
                               <h3 className="text-4xl font-black mb-10 tracking-tighter group-hover:text-emerald-400 transition-colors">{s.title}</h3>
                               <p className="text-slate-300 text-3xl font-medium italic leading-relaxed bg-slate-950/40 p-14 rounded-[3.5rem] border border-white/5 shadow-inner leading-relaxed">"{s.text}"</p>
                               <p className="mt-10 text-[10px] font-black uppercase text-slate-600 tracking-widest flex items-center gap-3">
                                  <i className="fas fa-magic text-emerald-500"></i> SFX Recomendados: {s.sfx}
                               </p>
                            </div>
                            <div className="w-full lg:w-96 flex flex-col gap-8 justify-center">
                               <div className="bg-slate-950/80 p-8 rounded-[3rem] border border-white/5">
                                  <p className="text-[10px] font-black uppercase text-slate-600 text-center mb-8 tracking-[0.3em]">Casting de Master</p>
                                  {(['vendedor', 'amigable', 'institucional'] as InterpretationStyle[]).map(style => (
                                    <div key={style} className="flex gap-4 mb-4">
                                       <button className="flex-1 py-5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-black text-[11px] uppercase tracking-widest transition-all">Preview {style}</button>
                                       <button 
                                         onClick={() => renderAndDownload(s, style)}
                                         disabled={!isPro}
                                         className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${isPro ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-slate-900 text-slate-700 cursor-not-allowed'}`}
                                       >
                                         <i className={`fas ${isPro ? 'fa-download' : 'fa-lock'}`}></i>
                                       </button>
                                    </div>
                                  ))}
                                  {!isPro && (
                                    <div className="mt-8 p-6 bg-amber-500/5 rounded-3xl border border-amber-500/20 text-center">
                                       <p className="text-[9px] font-black uppercase text-amber-500 leading-relaxed">Versión Free activa: Suscríbete para descargar masters en WAV.</p>
                                    </div>
                                  )}
                               </div>
                            </div>
                         </div>
                      </div>
                    ))}
                  </div>
               </div>
            )}
          </div>
        )}

        {currentView === 'admin_dashboard' && (
          <div className="p-16 max-w-6xl mx-auto animate-in slide-in-from-bottom-10">
             <div className="flex justify-between items-end mb-16">
                <div>
                   <h2 className="text-6xl font-black italic tracking-tighter">Command <span className="text-emerald-400">Center.</span></h2>
                   <p className="text-slate-500 text-xl mt-4">Historial de producciones y métricas del estudio.</p>
                </div>
                <div className="flex gap-6">
                   <div className="bg-slate-900/60 p-8 rounded-[2rem] border border-white/5 text-center min-w-[200px]">
                      <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Total Producciones</p>
                      <span className="text-4xl font-black">{history.length}</span>
                   </div>
                </div>
             </div>

             <div className="bg-slate-900/40 rounded-[3rem] border border-white/5 overflow-hidden">
                <table className="w-full text-left">
                   <thead className="bg-slate-950/50">
                      <tr>
                         <th className="px-10 py-6 text-[10px] font-black uppercase text-slate-500 tracking-widest">Fecha</th>
                         <th className="px-10 py-6 text-[10px] font-black uppercase text-slate-500 tracking-widest">Cliente / Título</th>
                         <th className="px-10 py-6 text-[10px] font-black uppercase text-slate-500 tracking-widest">Tipo</th>
                         <th className="px-10 py-6 text-[10px] font-black uppercase text-slate-500 tracking-widest">Acciones</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                      {history.length === 0 ? (
                        <tr><td colSpan={4} className="px-10 py-20 text-center text-slate-600 font-bold uppercase text-xs">No hay producciones registradas aún.</td></tr>
                      ) : (
                        history.map((h, i) => (
                          <tr key={i} className="hover:bg-white/5 transition-colors">
                            <td className="px-10 py-6 text-sm text-slate-400 font-medium">{new Date(h.createdAt).toLocaleDateString()}</td>
                            <td className="px-10 py-6">
                               <p className="font-black text-lg">{h.client}</p>
                               <p className="text-[10px] text-slate-500 uppercase">{h.title}</p>
                            </td>
                            <td className="px-10 py-6">
                               <span className="px-4 py-1.5 bg-slate-800 rounded-full text-[9px] font-black uppercase text-slate-400">{h.type}</span>
                            </td>
                            <td className="px-10 py-6">
                               <button className="text-emerald-400 font-black text-[10px] uppercase hover:underline">Ver Guion</button>
                            </td>
                          </tr>
                        ))
                      )}
                   </tbody>
                </table>
             </div>
          </div>
        )}

        {currentView === 'billing_settings' && (
           <div className="p-16 max-w-4xl mx-auto animate-in slide-in-from-bottom-10">
              <h2 className="text-5xl font-black italic mb-12">Panel de <span className="text-emerald-400">Cobros.</span></h2>
              
              <div className="grid gap-8">
                 <div className="bg-slate-900/40 p-12 rounded-[3.5rem] border border-white/5 space-y-8">
                    <h3 className="text-xl font-black uppercase tracking-widest text-slate-400 flex items-center gap-4">
                       <i className="fas fa-plug text-emerald-500"></i> Pasarelas Digitales
                    </h3>
                    <div className="space-y-6">
                       <div className="space-y-3">
                          <label className="text-[10px] font-black uppercase text-slate-600 ml-4">Email Principal de Cobros (PayPal / Admin)</label>
                          <input 
                            type="email" className="w-full bg-slate-950 border-2 border-slate-800 p-6 rounded-2xl focus:border-emerald-500 outline-none"
                            value={adminConfig.merchantEmail} onChange={e => setAdminConfig({...adminConfig, merchantEmail: e.target.value})}
                          />
                       </div>
                    </div>
                 </div>

                 <div className="bg-amber-500/10 p-10 rounded-[3rem] border border-amber-500/20 flex items-center gap-8">
                    <div className="w-20 h-20 bg-amber-500 rounded-full flex items-center justify-center text-slate-950 text-3xl">
                       <i className="fas fa-shield-halved"></i>
                    </div>
                    <div className="flex-1">
                       <h4 className="font-black text-xl uppercase italic mb-2">Seguridad de Transacción</h4>
                       <p className="text-slate-400 text-sm leading-relaxed">Los pagos Pro se procesan mediante tokens encriptados. Los fondos se dirigen directamente a la cuenta configurada arriba.</p>
                    </div>
                    <button className="bg-amber-500 text-slate-950 px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-widest hover:brightness-110 transition-all">Guardar Cambios</button>
                 </div>
              </div>
           </div>
        )}
      </main>

      {audioStatus && (
        <div className="fixed bottom-10 right-10 bg-emerald-500 text-slate-950 px-8 py-4 rounded-2xl font-black shadow-2xl animate-in slide-in-from-right-10 flex items-center gap-4 border border-emerald-400 z-[100]">
           <i className="fas fa-compact-disc animate-spin text-xl"></i>
           <span className="text-xs uppercase tracking-widest">{audioStatus}</span>
        </div>
      )}

      {error && (
        <div className="fixed bottom-10 left-10 bg-red-500 text-white px-8 py-4 rounded-2xl font-black shadow-2xl animate-bounce flex items-center gap-4 z-[100]">
           <i className="fas fa-triangle-exclamation"></i>
           <span className="text-xs">{error}</span>
           <button onClick={() => setError(null)}><i className="fas fa-times"></i></button>
        </div>
      )}

      <style>{`
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 12s linear infinite; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>
    </div>
  );
};

export default App;
