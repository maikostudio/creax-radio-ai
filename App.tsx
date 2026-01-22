
import React, { useState, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { VIBES, SYSTEM_PROMPT, VOICES } from './constants';
import { AdProject, AdScript, InterpretationStyle } from './types';

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

// Función para convertir AudioBuffer a WAV (para descarga)
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const bufferLen = buffer.length * blockAlign;
  const headerLen = 44;
  const totalLen = headerLen + bufferLen;
  const arrayBuffer = new ArrayBuffer(totalLen);
  const view = new DataView(arrayBuffer);
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, totalLen - 8, true);
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
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
  }
  
  return new Blob([view], { type: 'audio/wav' });
}

const App: React.FC = () => {
  const [step, setStep] = useState(0);
  const [isPro, setIsPro] = useState(false); 
  const [project, setProject] = useState<AdProject>({ 
    category: '', location: '', vibe: 'litoral', briefing: '', type: 'ads', voiceId: 'Kore' 
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<AdScript[]>([]);
  const [playingState, setPlayingState] = useState<{index: number, style: InterpretationStyle} | null>(null);
  const [audioStatus, setAudioStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioBase64, setRecordedAudioBase64] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          setRecordedAudioBase64(base64);
        };
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setError("Micrófono no detectado.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

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

      const contents: any[] = [{ parts: [{ text: prompt }] }];
      if (recordedAudioBase64) {
        contents[0].parts.push({
          inlineData: { data: recordedAudioBase64, mimeType: 'audio/webm' }
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
        config: { responseMimeType: "application/json" }
      });

      const data = JSON.parse(response.text || "{}");
      setResults(data.scripts || []);
      setStep(3);
    } catch (e) {
      setError("Error de conexión. Intentá de nuevo.");
    } finally {
      setIsGenerating(false);
    }
  };

  const renderAndDownload = async (index: number, style: InterpretationStyle) => {
    if (!isPro) return;
    setAudioStatus("Exportando Master WAV...");
    
    try {
      const script = results[index];
      const vibe = VIBES.find(v => v.id === project.vibe);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const interpretationContext = {
        vendedor: "Voz enérgica y vendedora.",
        amigable: "Voz cálida y cercana.",
        institucional: "Voz sobria y elegante."
      };

      const tts = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Actúa como locutor. Estilo: ${interpretationContext[style]}. Texto: ${script.text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: project.voiceId as any } } }
        }
      });

      const voiceData = tts.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!voiceData) throw new Error("Voz fallida");

      const musicRes = await fetch(vibe?.musicUrl || '');
      const musicArrayBuffer = await musicRes.arrayBuffer();

      // RENDERIZADO OFFLINE (Calidad Estudio)
      const offlineCtx = new OfflineAudioContext(1, 44100 * 40, 44100); 
      
      const voiceBuf = await decodeRawPcm(decodeBase64(voiceData), offlineCtx);
      const musicBuf = await offlineCtx.decodeAudioData(musicArrayBuffer);

      if (!voiceBuf || !musicBuf) return;

      const voiceSource = offlineCtx.createBufferSource();
      const musicSource = offlineCtx.createBufferSource();
      voiceSource.buffer = voiceBuf;
      musicSource.buffer = musicBuf;

      const vGain = offlineCtx.createGain();
      const mGain = offlineCtx.createGain();
      
      // Ducking en el render
      vGain.gain.setValueAtTime(1, 0);
      mGain.gain.setValueAtTime(0.15, 0);
      mGain.gain.exponentialRampToValueAtTime(0.05, 1);
      mGain.gain.exponentialRampToValueAtTime(0.15, voiceBuf.duration + 1);

      voiceSource.connect(vGain).connect(offlineCtx.destination);
      musicSource.connect(mGain).connect(offlineCtx.destination);

      voiceSource.start(0);
      musicSource.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(renderedBuffer);
      
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CREAX_${project.category.replace(/\s/g, '_')}_${style}.wav`;
      a.click();
      setAudioStatus("");
    } catch (e) {
      setError("Error al exportar.");
      setAudioStatus("");
    }
  };

  const playPreview = async (index: number, style: InterpretationStyle) => {
    if (playingState?.index === index && playingState?.style === style) {
      stopAudio();
      return;
    }
    stopAudio();
    setPlayingState({index, style});
    setAudioStatus(`Pre-escucha: ${style}`);

    try {
      const script = results[index];
      const vibe = VIBES.find(v => v.id === project.vibe);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const tts = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Voz ${style}: ${script.text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: project.voiceId as any } } }
        }
      });

      const voiceData = tts.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!voiceData) throw new Error();

      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      await ctx.resume();

      const voiceBuf = await decodeRawPcm(decodeBase64(voiceData), ctx);
      const musicRes = await fetch(vibe?.musicUrl || '');
      const musicBuf = await ctx.decodeAudioData(await musicRes.arrayBuffer());

      if (!voiceBuf) return;

      const vSource = ctx.createBufferSource();
      const mSource = ctx.createBufferSource();
      vSource.buffer = voiceBuf;
      mSource.buffer = musicBuf;
      mSource.loop = true;

      const vG = ctx.createGain();
      const mG = ctx.createGain();
      mG.gain.setValueAtTime(0.04, ctx.currentTime);

      vSource.connect(vG).connect(ctx.destination);
      mSource.connect(mG).connect(ctx.destination);

      vSource.start();
      mSource.start();
      currentSourcesRef.current = [vSource, mSource];
      vSource.onended = stopAudio;
      setAudioStatus('');
    } catch (e) {
      stopAudio();
    }
  };

  const stopAudio = () => {
    currentSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    currentSourcesRef.current = [];
    setPlayingState(null);
    setAudioStatus('');
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans p-6 selection:bg-emerald-500/30">
      <header className="max-w-6xl mx-auto flex justify-between items-center mb-10 bg-slate-900/60 backdrop-blur-xl p-6 rounded-[2.5rem] border border-white/5 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-tr from-emerald-500 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <i className="fas fa-compact-disc text-2xl text-slate-950 animate-spin-slow"></i>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase italic leading-none">
              CREAX <span className="text-emerald-400">STUDIO</span>
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase ${isPro ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-500'}`}>
                {isPro ? 'Pro User' : 'Free Tier'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
           <button 
             onClick={() => setIsPro(!isPro)}
             className={`text-[10px] font-black uppercase tracking-widest px-6 py-3 rounded-full border-2 transition-all ${isPro ? 'border-amber-500/50 text-amber-500' : 'bg-amber-500 text-slate-950 border-amber-500 hover:scale-105'}`}
           >
             {isPro ? 'Mi Cuenta Pro' : 'Vincular Cuenta'}
           </button>
           <div className="h-10 w-px bg-slate-800"></div>
           <div className="flex gap-1 bg-slate-950 p-1 rounded-full border border-slate-800">
            {['ads', 'radio_id', 'podcast'].map(t => (
              <button 
                key={t} onClick={() => setProject({...project, type: t as any})}
                className={`px-4 py-2 rounded-full text-[9px] font-black uppercase transition-all ${project.type === t ? 'bg-emerald-500 text-slate-950' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        {step === 0 && (
          <div className="grid md:grid-cols-2 gap-10 animate-in fade-in zoom-in-95">
            <div className="bg-slate-900/40 p-12 rounded-[3.5rem] border border-white/5 shadow-2xl">
              <h2 className="text-4xl font-black mb-10 italic">Nueva <span className="text-emerald-400">Sesión</span></h2>
              <div className="space-y-8">
                <input 
                  type="text" className="w-full bg-slate-950/50 border-2 border-slate-800 p-6 rounded-2xl focus:border-emerald-500 outline-none transition-all text-lg"
                  placeholder="Nombre del Cliente" value={project.category} onChange={e => setProject({...project, category: e.target.value})}
                />
                <input 
                  type="text" className="w-full bg-slate-950/50 border-2 border-slate-800 p-6 rounded-2xl focus:border-emerald-500 outline-none transition-all text-lg"
                  placeholder="Ubicación" value={project.location} onChange={e => setProject({...project, location: e.target.value})}
                />
                <button 
                  onClick={() => setStep(1)} disabled={!project.category || !project.location}
                  className="w-full bg-emerald-500 text-slate-950 font-black py-7 rounded-[2rem] shadow-xl hover:brightness-110 active:scale-95 transition-all text-xl uppercase tracking-widest"
                >
                  Configurar Estilo <i className="fas fa-arrow-right ml-2"></i>
                </button>
              </div>
            </div>
            <div className="flex flex-col justify-center space-y-8 p-10 bg-emerald-500/5 rounded-[3.5rem] border border-emerald-500/10">
               <div className="flex items-center gap-6">
                 <i className="fas fa-file-export text-3xl text-emerald-400"></i>
                 <p className="text-slate-400 text-sm">Exportación en **WAV 16-bit** con Mastering Automático.</p>
               </div>
               <div className="flex items-center gap-6">
                 <i className="fas fa-microchip text-3xl text-emerald-400"></i>
                 <p className="text-slate-400 text-sm">Procesado por **Gemini 3 Flash** para resultados en segundos.</p>
               </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-in fade-in">
            <h2 className="text-3xl font-black mb-10 text-center uppercase tracking-widest text-emerald-400 italic">Casting Vocal</h2>
            <div className="grid md:grid-cols-2 gap-10">
              <div className="space-y-4">
                {VOICES.map(v => (
                  <button 
                    key={v.id} onClick={() => setProject({...project, voiceId: v.id})}
                    className={`w-full p-8 rounded-[2rem] border-2 flex items-center justify-between transition-all ${project.voiceId === v.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'}`}
                  >
                    <div className="text-left">
                      <span className="font-black block text-xl">{v.name}</span>
                      <span className="text-[10px] text-slate-500 uppercase">{v.description}</span>
                    </div>
                    <i className={`fas ${v.gender === 'M' ? 'fa-mars' : 'fa-venus'} ${project.voiceId === v.id ? 'text-emerald-500' : 'text-slate-600'}`}></i>
                  </button>
                ))}
              </div>
              <div className="space-y-6">
                 <div className="grid grid-cols-2 gap-4">
                    {VIBES.map(v => (
                      <button 
                        key={v.id} onClick={() => setProject({...project, vibe: v.id})}
                        className={`p-10 rounded-[2.5rem] flex flex-col items-center gap-4 transition-all ${project.vibe === v.id ? 'bg-emerald-500 text-slate-950 scale-105' : 'bg-slate-900 border border-slate-800'}`}
                      >
                        <i className={`fas ${v.icon} text-3xl`}></i>
                        <span className="font-black text-[10px] uppercase">{v.name}</span>
                      </button>
                    ))}
                 </div>
                 <button onClick={() => setStep(2)} className="w-full mt-6 bg-white text-slate-950 font-black py-7 rounded-[2rem] shadow-2xl text-xl uppercase tracking-widest">
                   Escribir Idea <i className="fas fa-pen ml-2"></i>
                 </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="max-w-4xl mx-auto animate-in fade-in">
             <h2 className="text-3xl font-black mb-10 text-center uppercase text-emerald-400 italic">Briefing Creativo</h2>
             <div className="bg-slate-900/40 p-10 rounded-[3rem] border border-white/5 mb-8">
                <div className="grid md:grid-cols-[1fr_250px] gap-8">
                  <textarea 
                    rows={8} className="w-full bg-slate-950/50 border-2 border-slate-800 p-8 rounded-[2rem] focus:border-emerald-500 outline-none text-xl"
                    placeholder="Contanos tu idea o promo..."
                    value={project.briefing} onChange={e => setProject({...project, briefing: e.target.value})}
                  />
                  <button 
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`rounded-[2.5rem] flex flex-col items-center justify-center gap-4 transition-all border-4 border-dashed ${isRecording ? 'bg-red-500/10 border-red-500 text-red-500 animate-pulse' : 'bg-slate-950 border-slate-800 text-slate-600 hover:text-emerald-400'}`}
                  >
                    <i className={`fas ${isRecording ? 'fa-stop-circle' : 'fa-microphone'} text-5xl`}></i>
                    <span className="text-[10px] font-black uppercase tracking-widest">{isRecording ? 'Parar' : 'Grabar Idea'}</span>
                  </button>
                </div>
             </div>
             <div className="flex gap-6">
               <button onClick={() => setStep(1)} className="flex-1 bg-slate-900 py-7 rounded-[2rem] font-black text-slate-500 uppercase tracking-widest">Atrás</button>
               <button 
                 onClick={generateScripts} disabled={isGenerating || (!project.briefing && !recordedAudioBase64)}
                 className="flex-[2] bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-black py-7 rounded-[2rem] shadow-2xl text-xl uppercase tracking-widest disabled:opacity-30"
               >
                 {isGenerating ? <i className="fas fa-compact-disc animate-spin"></i> : "Generar Master Final"}
               </button>
             </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-10 animate-in fade-in duration-700">
            <div className="flex justify-between items-center bg-slate-900/40 p-10 rounded-[3rem] border border-white/5">
              <h2 className="text-3xl font-black italic text-emerald-400 uppercase">Campaña Generada</h2>
              <button onClick={() => setStep(0)} className="bg-slate-800 px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-widest">Nueva Sesión</button>
            </div>
            
            <div className="grid gap-10">
              {results.map((s, i) => (
                <div key={i} className="bg-slate-900/60 p-12 rounded-[4rem] border border-white/5 hover:border-emerald-500/20 transition-all group">
                  <div className="flex flex-col md:flex-row gap-12">
                    <div className="flex-1">
                      <div className="flex gap-3 mb-6">
                         <span className="px-5 py-2 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] font-black uppercase border border-emerald-500/20">{s.tone}</span>
                      </div>
                      <h3 className="text-3xl font-black mb-6">{s.title}</h3>
                      <p className="text-slate-300 text-2xl font-medium italic leading-relaxed bg-slate-950/40 p-10 rounded-[2.5rem] border border-white/5 shadow-inner">"{s.text}"</p>
                    </div>
                    
                    <div className="w-full md:w-80 flex flex-col gap-6 justify-center">
                      <div className="space-y-3">
                        <p className="text-[9px] font-black uppercase text-slate-500 text-center mb-4">Elegir Interpretación</p>
                        {(['vendedor', 'amigable', 'institucional'] as InterpretationStyle[]).map(style => (
                          <div key={style} className="flex gap-2">
                            <button 
                              onClick={() => playPreview(i, style)}
                              className={`flex-1 py-5 rounded-[1.5rem] font-black text-[11px] uppercase flex items-center justify-center gap-3 transition-all ${playingState?.index === i && playingState?.style === style ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                            >
                              <i className={`fas ${playingState?.index === i && playingState?.style === style ? 'fa-stop' : 'fa-play'}`}></i> {style}
                            </button>
                            <button 
                              disabled={!isPro}
                              onClick={() => renderAndDownload(i, style)}
                              className={`w-14 h-14 rounded-[1.5rem] flex items-center justify-center transition-all ${isPro ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-slate-900 text-slate-700'}`}
                              title="Descargar Master Pro"
                            >
                              <i className={`fas ${isPro ? 'fa-download' : 'fa-lock'}`}></i>
                            </button>
                          </div>
                        ))}
                      </div>
                      {!isPro && (
                         <p className="text-[8px] text-center text-amber-500 font-bold uppercase mt-4">Vincula tu cuenta para descargar el master WAV</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {audioStatus && (
        <div className="fixed bottom-10 right-10 bg-emerald-500 text-slate-950 px-8 py-4 rounded-2xl font-black shadow-2xl animate-in slide-in-from-right-10 flex items-center gap-4 border border-emerald-400 z-50">
           <i className="fas fa-compact-disc animate-spin text-xl"></i>
           <span className="text-xs uppercase tracking-widest">{audioStatus}</span>
        </div>
      )}

      {error && (
        <div className="fixed bottom-10 left-10 bg-red-500 text-white px-8 py-4 rounded-2xl font-black shadow-2xl animate-bounce flex items-center gap-4 z-50">
           <i className="fas fa-triangle-exclamation"></i>
           <span className="text-xs">{error}</span>
           <button onClick={() => setError(null)}><i className="fas fa-times"></i></button>
        </div>
      )}
      
      <style>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 12s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default App;
